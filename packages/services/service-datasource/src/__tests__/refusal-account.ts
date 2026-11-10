// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { thrownRefusalText } from '../datasource-refusal.js';

/**
 * Await a refusal and answer its whole account: the one-line `message`, then
 * the `details.hint` that carries the rationale. A pin on what a refusal SAYS
 * reads this, so it holds whichever of the two halves a sentence lives in.
 */
export async function refusalAccount(answer: unknown): Promise<string> {
  try {
    await answer;
  } catch (err) {
    return thrownRefusalText(err);
  }
  throw new Error('expected a refusal, but the call resolved');
}
