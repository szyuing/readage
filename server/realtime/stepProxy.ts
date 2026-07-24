import type { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

const PROXY_PATH = '/api/realtime/step';

function getStepApiKey(): string | undefined {
  return process.env.STEP_API_KEY || process.env.STEPFUN_API_KEY;
}

/** Step Plan realtime: wss://api.stepfun.com/step_plan/v1/realtime */
export function getStepRealtimeUpstreamUrl(model: string): string {
  const base =
    process.env.STEP_REALTIME_URL ||
    process.env.STEP_WS_BASE ||
    'wss://api.stepfun.com/step_plan/v1/realtime';
  const cleaned = base.replace(/\?.*$/, '').replace(/\/$/, '');
  return `${cleaned}?model=${encodeURIComponent(model)}`;
}

export function isStepRealtimeConfigured(): boolean {
  return Boolean(getStepApiKey());
}

export function getStepRealtimePublicConfig() {
  return {
    ok: true,
    configured: isStepRealtimeConfigured(),
    model: process.env.STEP_REALTIME_MODEL || 'stepaudio-2.5-realtime',
    voice: process.env.STEP_VOICE || 'linjiajiejie',
    wsPath: PROXY_PATH,
    sampleRate: Number(process.env.STEP_PCM_SAMPLE_RATE || 24000),
    planBase: process.env.STEP_BASE_URL || 'https://api.stepfun.com/step_plan/v1',
  };
}

function eventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultOralInstructions(extra?: string): string {
  const base = `You are a warm, patient English oral practice partner for Chinese learners of English.
Goals: natural conversation, gentle corrections only when needed, short turns, high emotional intelligence.
Speak mainly in clear intermediate English. Use brief Chinese only when a word is truly hard.
Prefer questions that keep the learner talking. Allow light laughs or soft tone when natural.
Never lecture for long; one idea + one follow-up question per turn.
This is free oral practice (no article required) unless the user pastes article context.
Always reply with voice when modalities include audio.`;
  return extra ? `${base}\n\n${extra}` : base;
}

function normalizeSessionUpdate(raw: {
  type?: string;
  session?: Record<string, unknown>;
  event_id?: string;
}): string {
  const voice = process.env.STEP_VOICE || 'linjiajiejie';
  const clientSession = raw.session || {};
  const session: Record<string, unknown> = {
    modalities: ['text', 'audio'],
    input_audio_format: 'pcm16',
    output_audio_format: 'pcm16',
    voice,
    instructions: defaultOralInstructions(),
    turn_detection: {
      type: 'server_vad',
      prefix_padding_ms: 300,
      // slightly longer silence so short pauses don't cut mid-sentence
      silence_duration_ms: Number(process.env.STEP_VAD_SILENCE_MS || 800),
      // lower threshold = easier to wake on quiet mics (0-5000, default 2500)
      energy_awakeness_threshold: Number(process.env.STEP_VAD_ENERGY || 1200),
    },
    ...clientSession,
  };
  session.modalities = session.modalities || ['text', 'audio'];
  session.input_audio_format = session.input_audio_format || 'pcm16';
  session.output_audio_format = session.output_audio_format || 'pcm16';
  session.voice = session.voice || voice;

  return JSON.stringify({
    event_id: raw.event_id || eventId(),
    type: 'session.update',
    session,
  });
}

/**
 * Browser cannot set Authorization on WebSocket; proxy adds STEP_API_KEY
 * and relays JSON events to StepFun Realtime.
 */
export function attachStepRealtimeProxy(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    const pathOnly = url.split('?')[0];
    if (pathOnly !== PROXY_PATH) return;

    wss.handleUpgrade(req, socket, head, (client) => {
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (client: WebSocket, _req: IncomingMessage) => {
    const apiKey = getStepApiKey();
    if (!apiKey) {
      client.send(
        JSON.stringify({
          type: 'error',
          event_id: eventId(),
          error: {
            type: 'invalid_request_error',
            code: 'STEP_API_KEY_MISSING',
            message: 'Server missing STEP_API_KEY. Add it to .env and restart.',
          },
        })
      );
      client.close(1011, 'STEP_API_KEY missing');
      return;
    }

    const model = process.env.STEP_REALTIME_MODEL || 'stepaudio-2.5-realtime';
    const upstreamUrl = getStepRealtimeUpstreamUrl(model);
    console.log('[step-realtime] client connected →', upstreamUrl);

    // Queue browser messages until upstream is open (fixes race: session.update dropped)
    const pending: RawData[] = [];
    let upstreamOpen = false;

    let upstream: WebSocket;
    try {
      upstream = new WebSocket(upstreamUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      client.send(
        JSON.stringify({
          type: 'error',
          event_id: eventId(),
          error: { type: 'server_error', code: 'UPSTREAM_CONNECT_FAILED', message },
        })
      );
      client.close();
      return;
    }

    const closeBoth = (code?: number, reason?: string) => {
      try {
        if (client.readyState === WebSocket.OPEN) client.close(code, reason);
      } catch {
        /* ignore */
      }
      try {
        if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason);
      } catch {
        /* ignore */
      }
    };

    const forwardToUpstream = (data: RawData, isBinary: boolean) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      if (isBinary) {
        upstream.send(data, { binary: true });
        return;
      }
      try {
        const text = data.toString();
        const msg = JSON.parse(text) as {
          type?: string;
          session?: Record<string, unknown>;
          event_id?: string;
        };
        if (msg.type === 'session.update') {
          const normalized = normalizeSessionUpdate(msg);
          console.log('[step-realtime] → session.update');
          upstream.send(normalized);
          return;
        }
        if (msg.type && msg.type !== 'input_audio_buffer.append') {
          console.log('[step-realtime] →', msg.type);
        }
        upstream.send(text);
      } catch {
        upstream.send(data.toString());
      }
    };

    upstream.on('open', () => {
      upstreamOpen = true;
      console.log('[step-realtime] upstream open');
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: 'proxy.ready',
            event_id: eventId(),
            model,
            voice: process.env.STEP_VOICE || 'linjiajiejie',
            sampleRate: Number(process.env.STEP_PCM_SAMPLE_RATE || 24000),
          })
        );
      }
      // Flush queued messages in order
      while (pending.length) {
        const item = pending.shift()!;
        forwardToUpstream(item, false);
      }
    });

    upstream.on('message', (data, isBinary) => {
      if (client.readyState !== WebSocket.OPEN) return;
      if (!isBinary) {
        try {
          const ev = JSON.parse(data.toString()) as { type?: string; error?: { message?: string } };
          if (ev.type && ev.type !== 'response.audio.delta') {
            console.log('[step-realtime] ←', ev.type, ev.error?.message || '');
          }
        } catch {
          /* ignore */
        }
        client.send(data.toString());
      } else {
        client.send(data, { binary: true });
      }
    });

    upstream.on('error', (err) => {
      console.error('[step-realtime] upstream error', err.message);
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: 'error',
            event_id: eventId(),
            error: {
              type: 'server_error',
              code: 'UPSTREAM_ERROR',
              message: err.message,
            },
          })
        );
      }
    });

    upstream.on('close', (code, reason) => {
      console.log('[step-realtime] upstream closed', code, reason.toString());
      upstreamOpen = false;
      closeBoth(code, reason.toString());
    });

    client.on('message', (data, isBinary) => {
      if (!upstreamOpen || upstream.readyState !== WebSocket.OPEN) {
        // Only queue non-binary / small control; still queue audio as string frames
        pending.push(data);
        if (pending.length > 200) pending.shift();
        return;
      }
      forwardToUpstream(data, isBinary);
    });

    client.on('error', (err) => {
      console.error('[step-realtime] client error', err.message);
    });

    client.on('close', () => {
      console.log('[step-realtime] client closed');
      try {
        if (upstream.readyState === WebSocket.OPEN) upstream.close();
      } catch {
        /* ignore */
      }
    });
  });

  console.log(`[step-realtime] proxy armed at ws://…${PROXY_PATH}`);
  return wss;
}
