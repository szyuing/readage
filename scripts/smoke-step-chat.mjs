import dotenv from 'dotenv';
dotenv.config();

import { stepGenerateJson, getStepPlanBaseUrl, getStepChatModel } from '../server/llm/stepChat.ts';

console.log('base', getStepPlanBaseUrl());
console.log('model', getStepChatModel());
console.log('key set', Boolean(process.env.STEP_API_KEY));

const result = await stepGenerateJson(
  'Return JSON with keys: ok (boolean true) and greeting (string hello in English).'
);
console.log('result', result);
