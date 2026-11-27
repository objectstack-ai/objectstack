/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// AiChatPage reads a dropped spreadsheet through `import('@object-ui/plugin-grid')`; load it
// here so collection pays that transform, not a clocked case (check-test-source-alias).
import '@object-ui/plugin-grid';
import { describe, it, expect } from 'vitest';

import { agentEmptyState, buildAgentSuggestions } from '../AiChatPage';

// Identity translator: returns the defaultValue. Lets us test the branching
// without the i18n runtime.
const t = (_key: string, opts?: Record<string, unknown>): string => (opts?.defaultValue as string) ?? _key;

describe('agentEmptyState', () => {
  it('the ask agent reads as data Q&A', () => {
    expect(agentEmptyState(t, 'ask').title).toBe('Ask your data');
  });

  it('any other agent gets the generic empty state', () => {
    expect(agentEmptyState(t, 'build').title).toBe('Start a conversation');
    expect(agentEmptyState(t, 'support_bot').title).toBe('Start a conversation');
    expect(agentEmptyState(t, undefined).title).toBe('Start a conversation');
  });
});

describe('buildAgentSuggestions', () => {
  it('the ask agent offers data starters', () => {
    expect(buildAgentSuggestions('ask', 'Ask', t).join(' ')).toMatch(/How many users/);
  });

  it('a custom agent named for data offers data starters', () => {
    expect(buildAgentSuggestions('sales_data', 'Sales data', t).join(' ')).toMatch(/How many users/);
  });

  it('any other agent gets the generic starters, never app-authoring ones', () => {
    const s = buildAgentSuggestions('build', 'Build', t).join(' ');
    expect(s).toMatch(/What can you help me with/);
    expect(s).not.toMatch(/Build a sales CRM/);
  });
});
