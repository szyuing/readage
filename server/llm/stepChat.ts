import OpenAI from 'openai';

const DEFAULT_STEP_TIMEOUT_MS = 60_000;

/** Step Plan OpenAI-compatible base (chat/completions). */
export function getStepPlanBaseUrl(): string {
  return (
    process.env.STEP_BASE_URL ||
    process.env.STEPFUN_BASE_URL ||
    'https://api.stepfun.com/step_plan/v1'
  ).replace(/\/$/, '');
}

export function getStepApiKey(): string | undefined {
  return process.env.STEP_API_KEY || process.env.STEPFUN_API_KEY;
}

export function isStepChatConfigured(): boolean {
  return Boolean(getStepApiKey());
}

export function getStepChatModel(): string {
  return process.env.STEP_CHAT_MODEL || 'step-3.7-flash';
}

let client: OpenAI | null = null;

function getClient(): OpenAI {
  const apiKey = getStepApiKey();
  if (!apiKey) throw new Error('STEP_API_KEY is missing.');
  if (!client) {
    client = new OpenAI({
      apiKey,
      baseURL: getStepPlanBaseUrl(),
    });
  }
  return client;
}

export interface StepGenerateOptions {
  model?: string;
  temperature?: number;
  /** Abort upstream generation when the browser disconnects or a budget expires. */
  signal?: AbortSignal;
  /** Hard provider deadline. Defaults to 60 seconds. */
  timeoutMs?: number;
}

export function createStepAbortSignal(
  outer?: AbortSignal,
  timeoutMs = DEFAULT_STEP_TIMEOUT_MS
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const abort = () => controller.abort();
  outer?.addEventListener('abort', abort, { once: true });
  if (outer?.aborted) controller.abort();
  const timer = setTimeout(abort, Math.max(1, timeoutMs));
  timer.unref?.();
  return {
    signal: controller.signal,
    cleanup: () => {
      outer?.removeEventListener('abort', abort);
      clearTimeout(timer);
    },
  };
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error('Aborted');
  error.name = 'AbortError';
  throw error;
}

/**
 * Chat completion returning parsed JSON (schema described in the prompt).
 */
export async function stepGenerateJson<T>(
  prompt: string,
  options?: StepGenerateOptions
): Promise<T> {
  const model = options?.model || getStepChatModel();
  const linked = createStepAbortSignal(options?.signal, options?.timeoutMs);
  try {
    throwIfAborted(linked.signal);
    const response = await getClient().chat.completions.create(
      {
        model,
        temperature: options?.temperature ?? 0.4,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You are the English AI active-reading tutor backend. Always respond with a single valid JSON object only, no markdown fences.',
          },
          { role: 'user', content: prompt },
        ],
      },
      { signal: linked.signal }
    );

    const text = response.choices[0]?.message?.content || '{}';
    return JSON.parse(text) as T;
  } finally {
    linked.cleanup();
  }
}

export async function stepChatText(
  system: string,
  user: string,
  options?: StepGenerateOptions
): Promise<string> {
  const model = options?.model || getStepChatModel();
  const linked = createStepAbortSignal(options?.signal, options?.timeoutMs);
  try {
    throwIfAborted(linked.signal);
    const response = await getClient().chat.completions.create(
      {
        model,
        temperature: options?.temperature ?? 0.6,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
      { signal: linked.signal }
    );
    return response.choices[0]?.message?.content || '';
  } finally {
    linked.cleanup();
  }
}
