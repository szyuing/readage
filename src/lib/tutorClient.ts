import type { TutorRequest, TutorResponse, TutorSuccessResponse } from '../types';

export async function postTutor<T>(
  request: TutorRequest,
  fetcher: typeof fetch = fetch
): Promise<TutorSuccessResponse<T>> {
  const response = await fetcher('/api/tutor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });

  let body: TutorResponse<T>;
  try {
    body = (await response.json()) as TutorResponse<T>;
  } catch {
    throw new Error(`Tutor returned invalid JSON (${response.status}).`);
  }

  if (body.ok !== true) {
    const errBody = body as Extract<TutorResponse<T>, { ok: false }>;
    throw new Error(errBody.error?.message || `Tutor request failed (${response.status}).`);
  }
  if (!response.ok) {
    throw new Error(`Tutor request failed (${response.status}).`);
  }

  return body;
}

