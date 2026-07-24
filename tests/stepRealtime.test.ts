import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildManualAudioTurnEvents,
  formatMicrophoneError,
  StepRealtimeSession,
  type StepServerEvent,
} from '../src/lib/stepRealtime';

test('manual audio turn commits buffered audio and creates exactly one response', () => {
  assert.deepEqual(buildManualAudioTurnEvents(3), [
    { type: 'input_audio_buffer.commit' },
    { type: 'response.create' },
  ]);
});

test('manual audio turn refuses to commit an empty microphone buffer', () => {
  assert.deepEqual(buildManualAudioTurnEvents(0), []);
});

test('a server buffer-committed event does not create a duplicate response', () => {
  const session = new StepRealtimeSession();
  const sent: string[] = [];
  const internals = session as unknown as {
    ws: { readyState: number; send: (payload: string) => void };
    handleServerEvent: (event: StepServerEvent) => void;
  };
  internals.ws = {
    readyState: WebSocket.OPEN,
    send: (payload) => sent.push(JSON.parse(payload).type as string),
  };

  internals.handleServerEvent({ type: 'input_audio_buffer.committed' });

  assert.deepEqual(sent, []);
});

test('microphone permission and device failures are explained in Chinese', () => {
  assert.match(formatMicrophoneError(new DOMException('', 'NotAllowedError')), /麦克风权限/);
  assert.match(formatMicrophoneError(new DOMException('', 'NotFoundError')), /未找到可用的麦克风/);
  assert.match(formatMicrophoneError(new DOMException('', 'NotReadableError')), /被其他应用占用/);
});
