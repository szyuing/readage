/** Browser client for StepAudio Realtime via local Express proxy. */

export type StepRealtimeStatus = {
  ok: boolean;
  configured: boolean;
  model: string;
  voice: string;
  wsPath: string;
  sampleRate: number;
};

export type StepServerEvent = {
  type: string;
  event_id?: string;
  error?: { message?: string; code?: string; type?: string };
  delta?: string;
  transcript?: string;
  item?: {
    content?: Array<{ type?: string; transcript?: string; text?: string }>;
  };
  response?: {
    output?: Array<{
      content?: Array<{ type?: string; transcript?: string; text?: string }>;
    }>;
  };
  [key: string]: unknown;
};

export async function fetchStepRealtimeStatus(): Promise<StepRealtimeStatus> {
  const res = await fetch('/api/realtime/status');
  if (!res.ok) {
    return {
      ok: false,
      configured: false,
      model: '',
      voice: '',
      wsPath: '/api/realtime/step',
      sampleRate: 24000,
    };
  }
  return (await res.json()) as StepRealtimeStatus;
}

function eventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function floatTo16BitPCM(float32: Float32Array): ArrayBuffer {
  const buffer = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

export type StepClientEvent = { type: string };

export function buildManualAudioTurnEvents(framesSent: number): StepClientEvent[] {
  if (!Number.isFinite(framesSent) || framesSent <= 0) return [];
  return [
    { type: 'input_audio_buffer.commit' },
    { type: 'response.create' },
  ];
}

export function formatMicrophoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return '麦克风权限被拒绝。请在浏览器地址栏的网站权限中允许麦克风，然后重试。';
    }
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
      return '未找到可用的麦克风。请连接麦克风或检查系统输入设备。';
    }
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
      return '麦克风可能被其他应用占用。请关闭占用麦克风的程序后重试。';
    }
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return '当前浏览器不支持麦克风录音，或页面不是安全连接（HTTPS / localhost）。';
  }
  return error instanceof Error && error.message
    ? error.message
    : '无法启动麦克风，请检查浏览器和系统权限。';
}

function downsampleBuffer(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return buffer;
  const ratio = fromRate / toRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLen) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
      accum += buffer[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

export type StepRealtimeHandlers = {
  onEvent?: (ev: StepServerEvent) => void;
  onUserTranscript?: (text: string) => void;
  onAssistantTextDelta?: (text: string) => void;
  onAssistantTextDone?: (text: string) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
  onDebug?: (line: string) => void;
};

export class StepRealtimeSession {
  private ws: WebSocket | null = null;
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private muteGain: GainNode | null = null;
  private playContext: AudioContext | null = null;
  private playTime = 0;
  private assistantText = '';
  private sampleRate: number;
  private handlers: StepRealtimeHandlers;
  private framesSent = 0;
  private ready = false;

  constructor(sampleRate = 24000, handlers: StepRealtimeHandlers = {}) {
    this.sampleRate = sampleRate;
    this.handlers = handlers;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get isReady(): boolean {
    return this.ready && this.connected;
  }

  async connect(
    wsPath = '/api/realtime/step',
    sessionOverrides: Record<string, unknown> = {}
  ): Promise<void> {
    if (this.ws) this.disconnect();
    this.ready = false;
    this.framesSent = 0;

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}${wsPath}`;
    this.handlers.onDebug?.(`connecting ${url}`);

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          reject(new Error('连接超时：30s 内未就绪（检查服务端 / STEP 密钥）'));
        }
      }, 30000);

      const finishOk = () => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          resolve();
        }
      };
      const finishErr = (msg: string) => {
        if (!settled) {
          settled = true;
          window.clearTimeout(timer);
          reject(new Error(msg));
        }
      };

      ws.onopen = () => {
        this.handlers.onStatus?.('ws open');
        this.handlers.onDebug?.('local ws open, waiting proxy.ready…');
        // Do NOT send session.update yet — wait for proxy.ready so upstream is open
      };

      ws.onerror = () => {
        this.handlers.onError?.('WebSocket connection failed');
        finishErr('WebSocket 连接失败（代理未启动？）');
      };

      ws.onclose = (ev) => {
        this.handlers.onStatus?.('disconnected');
        this.handlers.onDebug?.(`ws closed code=${ev.code}`);
        this.stopMic();
        this.ready = false;
        if (!settled) finishErr(`连接关闭 code=${ev.code}`);
      };

      ws.onmessage = (msg) => {
        try {
          const ev = JSON.parse(String(msg.data)) as StepServerEvent;
          this.handleServerEvent(ev);

          if (ev.type === 'proxy.ready') {
            // Upstream is open — now configure session
            this.send({
              event_id: eventId(),
              type: 'session.update',
              session: { ...sessionOverrides },
            });
            this.handlers.onDebug?.('sent session.update after proxy.ready');
          }

          if (ev.type === 'session.created') {
            this.handlers.onDebug?.('session.created; waiting for session.updated');
          }

          if (ev.type === 'session.updated') {
            this.ready = true;
            this.handlers.onStatus?.('session ready');
            this.handlers.onDebug?.(ev.type);
            finishOk();
          }

          // Some deployments only send session.created once; proxy.ready + brief wait
          if (ev.type === 'proxy.ready') {
            window.setTimeout(() => {
              if (!this.ready) {
                this.ready = true;
                this.handlers.onStatus?.('session ready (proxy)');
                finishOk();
              }
            }, 800);
          }
        } catch {
          /* ignore non-json */
        }
      };
    });
  }

  private handleServerEvent(ev: StepServerEvent) {
    this.handlers.onEvent?.(ev);

    if (ev.type === 'error') {
      const msg = ev.error?.message || 'Step realtime error';
      this.handlers.onError?.(msg);
      this.handlers.onDebug?.(`error: ${msg}`);
      return;
    }

    if (ev.type === 'proxy.ready') {
      this.handlers.onStatus?.('proxy ready');
      return;
    }

    if (
      ev.type === 'conversation.item.input_audio_transcription.completed' ||
      ev.type === 'input_audio_transcription.completed'
    ) {
      const t =
        (ev.transcript as string) ||
        ev.item?.content?.map((c) => c.transcript || c.text || '').join('') ||
        '';
      if (t) this.handlers.onUserTranscript?.(t);
    }

    // Also catch user message items with transcripts
    if (ev.type === 'conversation.item.created' || ev.type === 'conversation.item.input_audio_transcription.delta') {
      const t = (ev.transcript as string) || '';
      if (t && ev.type.includes('transcription')) this.handlers.onUserTranscript?.(t);
    }

    if (ev.type === 'response.audio_transcript.delta' || ev.type === 'response.text.delta') {
      const d = ev.delta || '';
      if (d) {
        this.assistantText += d;
        this.handlers.onAssistantTextDelta?.(d);
      }
    }

    if (ev.type === 'response.audio_transcript.done' || ev.type === 'response.text.done') {
      const full = (ev.transcript as string) || (ev.delta as string) || this.assistantText;
      if (full) this.handlers.onAssistantTextDone?.(full);
      this.assistantText = '';
    }

    if (ev.type === 'response.done') {
      // Extract text from nested response if deltas never arrived
      if (!this.assistantText && ev.response?.output) {
        const texts: string[] = [];
        for (const item of ev.response.output) {
          for (const c of item.content || []) {
            if (c.transcript) texts.push(c.transcript);
            if (c.text) texts.push(c.text);
          }
        }
        if (texts.length) this.handlers.onAssistantTextDone?.(texts.join(''));
      } else if (this.assistantText) {
        this.handlers.onAssistantTextDone?.(this.assistantText);
      }
      this.assistantText = '';
      this.handlers.onStatus?.('idle');
      this.handlers.onDebug?.('response.done');
    }

    if (ev.type === 'response.audio.delta' && typeof ev.delta === 'string' && ev.delta) {
      this.enqueuePcm16Base64(ev.delta);
      this.handlers.onStatus?.('speaking');
    }

    if (ev.type === 'input_audio_buffer.speech_started') {
      this.handlers.onStatus?.('listening');
      this.handlers.onDebug?.('VAD: speech_started');
    }
    if (ev.type === 'input_audio_buffer.speech_stopped') {
      this.handlers.onStatus?.('thinking');
      this.handlers.onDebug?.('VAD: speech_stopped');
    }
    if (ev.type === 'input_audio_buffer.committed') {
      this.handlers.onDebug?.('buffer committed');
    }
  }

  send(payload: Record<string, unknown>) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!payload.event_id) payload.event_id = eventId();
    this.ws.send(JSON.stringify(payload));
  }

  /** Text turn over the realtime channel. */
  sendText(text: string) {
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text }],
      },
    });
    this.send({ type: 'response.create' });
    this.handlers.onStatus?.('thinking');
    this.handlers.onDebug?.(`text turn: ${text.slice(0, 40)}`);
  }

  /** Unlock audio playback while still inside a user gesture. */
  async preparePlayback(): Promise<void> {
    if (!this.playContext) {
      this.playContext = new AudioContext({ sampleRate: this.sampleRate });
      this.playTime = this.playContext.currentTime;
    }
    if (this.playContext.state === 'suspended') {
      await this.playContext.resume();
    }
  }

  /** Stop capture, commit one non-empty turn, then request exactly one response. */
  commitAndRespond(): boolean {
    const frames = this.framesSent;
    this.stopMic();
    const events = buildManualAudioTurnEvents(frames);
    this.framesSent = 0;

    if (!events.length) {
      this.handlers.onStatus?.('idle');
      this.handlers.onDebug?.('manual commit skipped: empty audio buffer');
      return false;
    }

    for (const event of events) this.send(event);
    this.handlers.onStatus?.('thinking');
    this.handlers.onDebug?.(`manual commit (frames=${frames})`);
    return true;
  }

  /** Discard a partially recorded turn without closing the realtime connection. */
  cancelRecording() {
    const hadFrames = this.framesSent > 0;
    this.stopMic();
    this.framesSent = 0;
    if (hadFrames) this.send({ type: 'input_audio_buffer.clear' });
    this.handlers.onStatus?.('idle');
    this.handlers.onDebug?.('recording cancelled');
  }

  async startMic(): Promise<void> {
    if (this.mediaStream) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('当前浏览器不支持麦克风录音，或页面不是安全连接（HTTPS / localhost）。');
    }
    this.framesSent = 0;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
    // Browsers often start suspended until user gesture — we have gesture, but resume anyway
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    const actualRate = this.audioContext.sampleRate;
    this.handlers.onDebug?.(
      `mic on actualRate=${actualRate} target=${this.sampleRate} tracks=${this.mediaStream.getAudioTracks().length}`
    );

    this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

    // CRITICAL: do NOT connect processor to speakers.
    // Feedback + echoCancellation will silence / mangle the mic input.
    this.muteGain = this.audioContext.createGain();
    this.muteGain.gain.value = 0;

    this.processor.onaudioprocess = (e) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      let samples = input;
      if (actualRate !== this.sampleRate) {
        samples = downsampleBuffer(input, actualRate, this.sampleRate);
      }
      // Skip near-silent frames to reduce noise (but keep most speech)
      let peak = 0;
      for (let i = 0; i < samples.length; i += 16) {
        const a = Math.abs(samples[i]);
        if (a > peak) peak = a;
      }
      // still send quiet frames occasionally so VAD sees continuous stream
      if (peak < 0.005 && this.framesSent % 4 !== 0) return;

      const pcm = floatTo16BitPCM(samples);
      const b64 = arrayBufferToBase64(pcm);
      this.send({ type: 'input_audio_buffer.append', audio: b64 });
      this.framesSent += 1;
      if (this.framesSent === 1 || this.framesSent % 50 === 0) {
        this.handlers.onDebug?.(`audio frames sent=${this.framesSent} peak=${peak.toFixed(3)}`);
      }
    };

    this.source.connect(this.processor);
    this.processor.connect(this.muteGain);
    this.muteGain.connect(this.audioContext.destination);
    this.handlers.onStatus?.('mic on');
  }

  stopMic() {
    try {
      if (this.processor) this.processor.onaudioprocess = null;
      this.processor?.disconnect();
      this.source?.disconnect();
      this.muteGain?.disconnect();
      this.processor = null;
      this.source = null;
      this.muteGain = null;
      this.mediaStream?.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
      void this.audioContext?.close();
      this.audioContext = null;
    } catch {
      /* ignore */
    }
  }

  private enqueuePcm16Base64(b64: string) {
    try {
      if (!this.playContext) {
        this.playContext = new AudioContext({ sampleRate: this.sampleRate });
        this.playTime = this.playContext.currentTime;
      }
      const ctx = this.playContext;
      if (ctx.state === 'suspended') void ctx.resume();

      const int16 = base64ToInt16(b64);
      const float32 = new Float32Array(int16.length);
      for (let i = 0; i < int16.length; i++) {
        float32[i] = int16[i] / 0x8000;
      }
      const buffer = ctx.createBuffer(1, float32.length, this.sampleRate);
      buffer.copyToChannel(float32, 0);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      const startAt = Math.max(this.playTime, ctx.currentTime + 0.02);
      src.start(startAt);
      this.playTime = startAt + buffer.duration;
    } catch (err) {
      console.warn('[step-realtime] audio play failed', err);
      this.handlers.onDebug?.(`play fail: ${err}`);
    }
  }

  disconnect() {
    this.stopMic();
    this.ready = false;
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
    this.ws = null;
    try {
      void this.playContext?.close();
    } catch {
      /* ignore */
    }
    this.playContext = null;
    this.framesSent = 0;
  }
}
