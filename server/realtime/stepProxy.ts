import { timingSafeEqual } from 'crypto';
import type { Server as HttpServer, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';

const PROXY_PATH = '/api/realtime/step';
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_MAX_QUEUE_BYTES = 1024 * 1024;
const DEFAULT_MAX_QUEUE_MESSAGES = 100;
const DEFAULT_MAX_CONNECTIONS = 8;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_SESSION_MS = 15 * 60_000;
const DEFAULT_HEARTBEAT_MS = 30_000;
const MAX_INPUT_TEXT_CHARS = 8_000;
const MAX_AUDIO_BASE64_CHARS = 192 * 1024;

const policyTokens = new WeakMap<SensitiveApiPolicy, string>();

export interface SensitiveApiPolicy {
  required: boolean;
  configured: boolean;
  enabled: boolean;
}

export interface SensitiveApiPolicyInput {
  nodeEnv?: string;
  host?: string;
  token?: string;
}

export interface RequestCredentials {
  headers?: Record<string, string | string[] | undefined>;
  url?: string;
}

export function isLoopbackHost(host: string | undefined): boolean {
  const normalized = (host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  return normalized === '127.0.0.1' || normalized === 'localhost' || normalized === '::1';
}

export function getConfiguredSharedApiToken(): string | undefined {
  const token = process.env.APP_API_TOKEN || process.env.API_SHARED_TOKEN;
  return token?.trim() || undefined;
}

export function getSensitiveApiPolicy(input: SensitiveApiPolicyInput = {}): SensitiveApiPolicy {
  const host = input.host || process.env.HOST || '127.0.0.1';
  const nodeEnv = input.nodeEnv || process.env.NODE_ENV || 'development';
  const hasTokenOverride = Object.prototype.hasOwnProperty.call(input, 'token');
  const token = hasTokenOverride ? input.token?.trim() : getConfiguredSharedApiToken();
  const required = nodeEnv === 'production' || !isLoopbackHost(host);
  const policy: SensitiveApiPolicy = {
    required,
    configured: Boolean(token),
    enabled: !required || Boolean(token),
  };
  if (token) policyTokens.set(policy, token);
  return policy;
}

function headerValue(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
  return Array.isArray(entry) ? entry[0] : entry;
}

function requestCredential(request: RequestCredentials): string | undefined {
  const authorization = headerValue(request.headers, 'authorization');
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7).trim();

  const headerToken = headerValue(request.headers, 'x-api-token')?.trim();
  if (headerToken) return headerToken;

  const protocols = headerValue(request.headers, 'sec-websocket-protocol')
    ?.split(',')
    .map((value) => value.trim());
  const tokenProtocol = protocols?.find((value) => value.startsWith('english-ai-token.'));
  if (tokenProtocol) {
    try {
      return decodeURIComponent(tokenProtocol.slice('english-ai-token.'.length));
    } catch {
      return undefined;
    }
  }

  if (request.url) {
    try {
      return new URL(request.url, 'http://localhost').searchParams.get('token')?.trim() || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function tokensEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export function authorizeSensitiveRequest(
  request: RequestCredentials,
  policy = getSensitiveApiPolicy()
): boolean {
  if (!policy.required) return true;
  if (!policy.enabled) return false;
  const expected = policyTokens.get(policy) || getConfiguredSharedApiToken();
  const actual = requestCredential(request);
  return Boolean(expected && actual && tokensEqual(actual, expected));
}

export interface RealtimeOriginOptions {
  allowedOrigins: string[];
  host: string;
  port: number;
  publicMode: boolean;
}

export function getAllowedOrigins(): string[] {
  return (process.env.APP_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

export function isAllowedRealtimeOrigin(
  origin: string | undefined,
  options: RealtimeOriginOptions
): boolean {
  if (!origin) return true;
  const normalized = origin.replace(/\/$/, '');
  if (options.allowedOrigins.includes(normalized)) return true;
  if (options.publicMode) return false;
  const localOrigins = new Set([
    `http://localhost:${options.port}`,
    `http://127.0.0.1:${options.port}`,
    `https://localhost:${options.port}`,
    `https://127.0.0.1:${options.port}`,
  ]);
  return localOrigins.has(normalized);
}

function positiveInt(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

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
  const policy = getSensitiveApiPolicy();
  return {
    ok: true,
    configured: isStepRealtimeConfigured() && policy.enabled,
    authRequired: policy.required,
    authConfigured: policy.configured,
    model: process.env.STEP_REALTIME_MODEL || 'stepaudio-2.5-realtime',
    voice: process.env.STEP_VOICE || 'linjiajiejie',
    wsPath: PROXY_PATH,
    sampleRate: Number(process.env.STEP_PCM_SAMPLE_RATE || 24000),
  };
}

function eventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultOralInstructions(): string {
  return `You are a warm, patient English oral practice partner for Chinese learners of English.
Goals: natural conversation, gentle corrections only when needed, short turns, high emotional intelligence.
Speak mainly in clear intermediate English. Use brief Chinese only when a word is truly hard.
Prefer questions that keep the learner talking. Allow light laughs or soft tone when natural.
Never lecture for long; one idea + one follow-up question per turn.
This is free oral practice (no article required) unless the user pastes article context.
Always reply with voice when modalities include audio.`;
}

function sanitizeModalities(value: unknown): string[] {
  if (!Array.isArray(value)) return ['text', 'audio'];
  const allowed = value.filter((item): item is string => item === 'text' || item === 'audio');
  return allowed.length > 0 ? [...new Set(allowed)] : ['text', 'audio'];
}

function sanitizeTurnDetection(value: unknown): Record<string, unknown> | null {
  if (value === null) return null;
  const candidate = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const numberInRange = (key: string, fallback: number, min: number, max: number) => {
    const number = Number(candidate[key]);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
  };
  return {
    type: 'server_vad',
    prefix_padding_ms: numberInRange('prefix_padding_ms', 300, 0, 2_000),
    silence_duration_ms: numberInRange(
      'silence_duration_ms',
      Number(process.env.STEP_VAD_SILENCE_MS || 800),
      200,
      5_000
    ),
    energy_awakeness_threshold: numberInRange(
      'energy_awakeness_threshold',
      Number(process.env.STEP_VAD_ENERGY || 1200),
      0,
      5_000
    ),
  };
}

export function normalizeSessionUpdate(raw: {
  type?: string;
  session?: Record<string, unknown>;
  event_id?: string;
}): string {
  const voice = process.env.STEP_VOICE || 'linjiajiejie';
  const clientSession = raw.session || {};
  return JSON.stringify({
    event_id: typeof raw.event_id === 'string' ? raw.event_id.slice(0, 128) : eventId(),
    type: 'session.update',
    session: {
      modalities: sanitizeModalities(clientSession.modalities),
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      voice,
      instructions: defaultOralInstructions(),
      turn_detection: sanitizeTurnDetection(clientSession.turn_detection),
    },
  });
}

export type RealtimeEventValidation =
  | { ok: true; payload: string }
  | { ok: false; code: 'INVALID_EVENT' | 'EVENT_NOT_ALLOWED'; message: string };

function boundedEventId(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 128 ? value : undefined;
}

export function validateRealtimeClientEvent(value: unknown): RealtimeEventValidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, code: 'INVALID_EVENT', message: 'Realtime event must be a JSON object.' };
  }
  const event = value as Record<string, unknown>;
  const type = typeof event.type === 'string' ? event.type : '';
  const event_id = boundedEventId(event.event_id);

  if (type === 'session.update') {
    const session = event.session;
    if (session !== undefined && (!session || typeof session !== 'object' || Array.isArray(session))) {
      return { ok: false, code: 'INVALID_EVENT', message: 'session must be an object.' };
    }
    return {
      ok: true,
      payload: normalizeSessionUpdate({
        type,
        event_id,
        session: (session || {}) as Record<string, unknown>,
      }),
    };
  }

  if (type === 'input_audio_buffer.append') {
    const audio = event.audio;
    if (typeof audio !== 'string' || audio.length === 0 || audio.length > MAX_AUDIO_BASE64_CHARS) {
      return { ok: false, code: 'INVALID_EVENT', message: 'audio chunk is missing or too large.' };
    }
    return { ok: true, payload: JSON.stringify({ type, event_id, audio }) };
  }

  if (type === 'input_audio_buffer.commit' || type === 'input_audio_buffer.clear' || type === 'response.create') {
    return { ok: true, payload: JSON.stringify({ type, event_id }) };
  }

  if (type === 'conversation.item.create') {
    const item = event.item as Record<string, unknown> | undefined;
    const content = Array.isArray(item?.content) ? item.content : [];
    const safeContent = content
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
      .filter((entry) => entry.type === 'input_text' && typeof entry.text === 'string')
      .slice(0, 8)
      .map((entry) => ({ type: 'input_text', text: String(entry.text).slice(0, MAX_INPUT_TEXT_CHARS) }));
    if (item?.type !== 'message' || item.role !== 'user' || safeContent.length === 0) {
      return { ok: false, code: 'INVALID_EVENT', message: 'Only user input_text messages are allowed.' };
    }
    return {
      ok: true,
      payload: JSON.stringify({
        type,
        event_id,
        item: { type: 'message', role: 'user', content: safeContent },
      }),
    };
  }

  return { ok: false, code: 'EVENT_NOT_ALLOWED', message: `Event type is not allowed: ${type || '(missing)'}.` };
}

export function rawDataByteLength(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.byteLength, 0);
  return data.byteLength;
}

function rejectUpgrade(
  socket: { write: (data: string) => unknown; destroy: () => unknown },
  status: number,
  message: string
): void {
  const body = JSON.stringify({ ok: false, error: { code: 'REALTIME_REJECTED', message } });
  socket.write(
    `HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Service Unavailable'}\r\n` +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body
  );
  socket.destroy();
}

interface QueuedMessage {
  payload: string;
  bytes: number;
}

/**
 * Adds a constrained Step Realtime proxy to an existing HTTP server.
 * Public/production access requires APP_API_TOKEN (or API_SHARED_TOKEN).
 */
export function attachStepRealtimeProxy(httpServer: HttpServer): WebSocketServer {
  const maxPayload = positiveInt(process.env.STEP_WS_MAX_PAYLOAD_BYTES, DEFAULT_MAX_PAYLOAD_BYTES, 2 * 1024 * 1024);
  const maxQueueBytes = positiveInt(process.env.STEP_WS_MAX_QUEUE_BYTES, DEFAULT_MAX_QUEUE_BYTES, 8 * 1024 * 1024);
  const maxQueueMessages = positiveInt(process.env.STEP_WS_MAX_QUEUE_MESSAGES, DEFAULT_MAX_QUEUE_MESSAGES, 500);
  const maxConnections = positiveInt(process.env.STEP_WS_MAX_CONNECTIONS, DEFAULT_MAX_CONNECTIONS, 100);
  const idleTimeoutMs = positiveInt(process.env.STEP_WS_IDLE_TIMEOUT_MS, DEFAULT_IDLE_TIMEOUT_MS, 30 * 60_000);
  const maxSessionMs = positiveInt(process.env.STEP_WS_MAX_SESSION_MS, DEFAULT_MAX_SESSION_MS, 4 * 60 * 60_000);
  const heartbeatMs = positiveInt(process.env.STEP_WS_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS, 5 * 60_000);
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  const policy = getSensitiveApiPolicy({ host });
  const allowedOrigins = getAllowedOrigins();
  const publicMode = !isLoopbackHost(host);
  const wss = new WebSocketServer({ noServer: true, maxPayload });
  let activeConnections = 0;

  httpServer.on('upgrade', (req, socket, head) => {
    const pathOnly = (req.url || '').split('?')[0];
    if (pathOnly !== PROXY_PATH) return;

    if (!policy.enabled) {
      rejectUpgrade(socket, 503, 'Realtime is disabled until APP_API_TOKEN is configured.');
      return;
    }
    if (!authorizeSensitiveRequest({ headers: req.headers, url: req.url }, policy)) {
      rejectUpgrade(socket, 401, 'Valid realtime credentials are required.');
      return;
    }
    if (
      !isAllowedRealtimeOrigin(req.headers.origin, {
        allowedOrigins,
        host,
        port,
        publicMode,
      })
    ) {
      rejectUpgrade(socket, 403, 'WebSocket Origin is not allowed.');
      return;
    }
    if (activeConnections >= maxConnections) {
      rejectUpgrade(socket, 503, 'Realtime connection limit reached.');
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      activeConnections += 1;
      wss.emit('connection', client, req);
    });
  });

  wss.on('connection', (client: WebSocket, _req: IncomingMessage) => {
    const apiKey = getStepApiKey();
    if (!apiKey) {
      activeConnections = Math.max(0, activeConnections - 1);
      client.close(1011, 'Realtime provider unavailable');
      return;
    }

    const model = process.env.STEP_REALTIME_MODEL || 'stepaudio-2.5-realtime';
    const pending: QueuedMessage[] = [];
    let pendingBytes = 0;
    let upstreamOpen = false;
    let cleanedUp = false;
    let lastActivityAt = Date.now();
    let clientAlive = true;

    let upstream: WebSocket;
    try {
      upstream = new WebSocket(getStepRealtimeUpstreamUrl(model), {
        headers: { Authorization: `Bearer ${apiKey}` },
        maxPayload,
        handshakeTimeout: 10_000,
      });
    } catch (error) {
      activeConnections = Math.max(0, activeConnections - 1);
      console.error(
        '[step-realtime] invalid upstream configuration',
        error instanceof Error ? error.message : 'Unknown error'
      );
      client.close(1011, 'Realtime provider unavailable');
      return;
    }

    let heartbeatTimer: ReturnType<typeof setInterval>;
    let sessionTimer: ReturnType<typeof setTimeout>;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      activeConnections = Math.max(0, activeConnections - 1);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionTimer) clearTimeout(sessionTimer);
    };

    const closeBoth = (code = 1000, reason = 'Session closed') => {
      cleanup();
      if (client.readyState === WebSocket.OPEN || client.readyState === WebSocket.CONNECTING) {
        client.close(code, reason.slice(0, 120));
      }
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close(code, reason.slice(0, 120));
      }
    };

    const sendClientError = (code: string, message: string) => {
      if (client.readyState !== WebSocket.OPEN) return;
      client.send(JSON.stringify({ type: 'error', event_id: eventId(), error: { type: 'invalid_request_error', code, message } }));
    };

    const forwardPayload = (payload: string) => {
      if (upstream.readyState === WebSocket.OPEN) upstream.send(payload);
    };

    heartbeatTimer = setInterval(() => {
      if (Date.now() - lastActivityAt > idleTimeoutMs) {
        closeBoth(1008, 'Idle timeout');
        return;
      }
      if (!clientAlive) {
        closeBoth(1008, 'Heartbeat timeout');
        return;
      }
      clientAlive = false;
      if (client.readyState === WebSocket.OPEN) client.ping();
    }, Math.min(heartbeatMs, idleTimeoutMs));
    heartbeatTimer.unref?.();

    sessionTimer = setTimeout(() => closeBoth(1008, 'Maximum session duration reached'), maxSessionMs);
    sessionTimer.unref?.();

    upstream.on('open', () => {
      upstreamOpen = true;
      lastActivityAt = Date.now();
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
      while (pending.length > 0) {
        const item = pending.shift()!;
        pendingBytes -= item.bytes;
        forwardPayload(item.payload);
      }
    });

    upstream.on('message', (data, isBinary) => {
      lastActivityAt = Date.now();
      if (client.readyState !== WebSocket.OPEN) return;
      if (rawDataByteLength(data) > maxPayload) {
        closeBoth(1009, 'Upstream message too large');
        return;
      }
      client.send(isBinary ? data : data.toString(), { binary: isBinary });
    });

    upstream.on('error', (error) => {
      console.error('[step-realtime] upstream error', error.message);
      sendClientError('UPSTREAM_ERROR', 'Realtime provider is unavailable.');
    });
    upstream.on('close', () => closeBoth(1011, 'Realtime provider closed'));

    client.on('pong', () => {
      clientAlive = true;
      lastActivityAt = Date.now();
    });

    client.on('message', (data, isBinary) => {
      lastActivityAt = Date.now();
      clientAlive = true;
      if (isBinary) {
        sendClientError('BINARY_NOT_ALLOWED', 'Binary client frames are not allowed.');
        closeBoth(1008, 'Binary frames are not allowed');
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        sendClientError('INVALID_JSON', 'Realtime events must be valid JSON.');
        closeBoth(1008, 'Invalid JSON');
        return;
      }

      const validated = validateRealtimeClientEvent(parsed);
      if (validated.ok === false) {
        sendClientError(validated.code, validated.message);
        closeBoth(1008, validated.code);
        return;
      }

      const bytes = Buffer.byteLength(validated.payload);
      if (!upstreamOpen || upstream.readyState !== WebSocket.OPEN) {
        if (pending.length >= maxQueueMessages || pendingBytes + bytes > maxQueueBytes) {
          sendClientError('QUEUE_LIMIT', 'Realtime startup queue limit exceeded.');
          closeBoth(1009, 'Queue limit exceeded');
          return;
        }
        pending.push({ payload: validated.payload, bytes });
        pendingBytes += bytes;
        return;
      }
      forwardPayload(validated.payload);
    });

    client.on('error', (error) => console.error('[step-realtime] client error', error.message));
    client.on('close', () => {
      cleanup();
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close(1000, 'Client closed');
      }
    });
  });

  console.log(`[step-realtime] proxy armed at ${PROXY_PATH}`);
  return wss;
}
