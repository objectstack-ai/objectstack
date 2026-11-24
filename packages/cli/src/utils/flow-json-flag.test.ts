// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `os verify --flow` takes the triggering record (`--flow-record`) and the
// start's input (`--flow-input`) as JSON objects, judged before anything loads
// or boots. This pins the decision, `parseFlowJsonFlag`, on its own: the
// command body hands each flag to it once, before the author-time stage.

import { describe, it, expect } from 'vitest';
import { parseFlowJsonFlag } from '../utils/flow-json-flag.js';

describe('parseFlowJsonFlag', () => {
  it('an absent flag is no value', () => {
    expect(parseFlowJsonFlag('--flow-record', undefined)).toBeUndefined();
  });

  it('a JSON object is handed on as given', () => {
    expect(parseFlowJsonFlag('--flow-record', '{"subject":"Printer jam","priority":2}')).toEqual({
      subject: 'Printer jam',
      priority: 2,
    });
  });

  it('text that does not parse is refused, naming the flag', () => {
    expect(() => parseFlowJsonFlag('--flow-input', '{subject: x}')).toThrow(/--flow-input/);
  });

  it.each([['[1,2]'], ['"text"'], ['null'], ['3']])('JSON that is not an object (%s) is refused, naming the flag', (raw) => {
    expect(() => parseFlowJsonFlag('--flow-record', raw)).toThrow(/--flow-record/);
  });
});
