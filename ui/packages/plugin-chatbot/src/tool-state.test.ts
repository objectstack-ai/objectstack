// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `getToolState` — the activity chip's state for one tool invocation, read
// from the invocation's own lifecycle state (or, for a legacy invocation that
// carries none, from whether it holds a result or an error).

import { describe, it, expect } from 'vitest';
import { getToolState } from './ChatbotEnhanced';

describe('getToolState', () => {
  it('a returned tool → completed', () => {
    expect(
      getToolState({
        toolCallId: 't1',
        toolName: 'query_records',
        result: { records: [] },
      }),
    ).toBe('completed');
  });

  it('an errored or denied tool → failed; a running one → running', () => {
    expect(getToolState({ toolCallId: 't2', toolName: 'x', errorText: 'boom' })).toBe('failed');
    expect(getToolState({ toolCallId: 't3', toolName: 'x', state: 'output-denied' })).toBe('failed');
    expect(getToolState({ toolCallId: 't4', toolName: 'x' })).toBe('running');
  });

  it('an explicit approval-requested or approval-responded state → awaiting', () => {
    expect(
      getToolState({ toolCallId: 't5', toolName: 'x', state: 'approval-requested', result: undefined }),
    ).toBe('awaiting');
    expect(getToolState({ toolCallId: 't6', toolName: 'x', state: 'approval-responded' })).toBe('awaiting');
  });
});
