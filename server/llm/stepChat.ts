import OpenAI from 'openai';

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
}

/**
 * Chat completion returning parsed JSON (schema described in the prompt).
 */
export async function stepGenerateJson<T>(
  prompt: string,
  options?: StepGenerateOptions
): Promise<T> {
  const model = options?.model || getStepChatModel();
  if (options?.signal?.aborted) {
    const error = new Error('Aborted');
    error.name = 'AbortError';
    throw error;
  }

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
    { signal: options?.signal }
  );

  const text = response.choices[0]?.message?.content || '{}';
  return JSON.parse(text) as T;
}

export async function stepChatText(
  system: string,
  user: string,
  options?: { model?: string }
): Promise<string> {
  const model = options?.model || getStepChatModel();
  const response = await getClient().chat.completions.create({
    model,
    temperature: 0.6,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  return response.choices[0]?.message?.content || '';
}
