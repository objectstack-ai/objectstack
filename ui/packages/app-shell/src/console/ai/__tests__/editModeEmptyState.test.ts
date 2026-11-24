/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';

import { agentEmptyState, buildAgentSuggestions, editAppDataSuggestions } from '../AiChatPage';

// Identity translator: returns the defaultValue, interpolating `{{app}}` so the
// edit-mode named title can be asserted. Lets us test the branching without the
// i18n runtime.
const t = (_key: string, opts?: Record<string, unknown>): string => {
  let s = (opts?.defaultValue as string) ?? _key;
  if (opts && 'app' in opts) s = s.replace('{{app}}', String(opts.app));
  return s;
};

// ADR-0057 A1.b — the build surface's empty-state guidance and starters switch
// between the magic flow (from-scratch) and edit mode (change an existing app).
describe('agentEmptyState — build magic vs edit mode', () => {
  it('magic flow (no editContext): "Build with AI" / describe-an-app', () => {
    const s = agentEmptyState(t, 'build', undefined);
    expect(s.title).toBe('Build with AI');
    expect(s.description).toMatch(/describe/i);
  });

  it('edit mode with a known app name: title names the app', () => {
    const s = agentEmptyState(t, 'build', { appLabel: 'Tiny Todo' });
    expect(s.title).toBe('Editing “Tiny Todo”');
    expect(s.description).toMatch(/change/i);
    expect(s.description).toMatch(/in place/i);
  });

  it('edit mode before the app name resolves: generic edit title (never a raw id)', () => {
    const s = agentEmptyState(t, 'build', { appLabel: undefined });
    expect(s.title).toBe('Edit this app');
    expect(s.title).not.toMatch(/app\./); // no raw package id like app.xadv
  });

  it('ask agent is unaffected by edit context', () => {
    const s = agentEmptyState(t, 'ask', { appLabel: 'Tiny Todo' });
    expect(s.title).toBe('Ask your data');
  });
});

describe('buildAgentSuggestions — magic vs edit starters', () => {
  it('build + not editing: from-scratch authoring starters', () => {
    const s = buildAgentSuggestions('build', 'Build', t, false);
    expect(s.join(' ')).toMatch(/Build a sales CRM/);
    expect(s.join(' ')).not.toMatch(/Add a field/);
  });

  it('build + editing: change-oriented starters', () => {
    const s = buildAgentSuggestions('build', 'Build', t, true);
    expect(s.join(' ')).toMatch(/Add a field/);
    expect(s.join(' ')).toMatch(/Add a new object/);
    expect(s.join(' ')).not.toMatch(/Build a sales CRM/);
  });

  it('editing defaults to false (magic starters) when omitted', () => {
    expect(buildAgentSuggestions('build', 'Build', t)).toEqual(
      buildAgentSuggestions('build', 'Build', t, false),
    );
  });

  it('ask agent ignores editing (always data starters)', () => {
    const s = buildAgentSuggestions('ask', 'Ask', t, true);
    expect(s.join(' ')).toMatch(/How many users/);
    expect(s.join(' ')).not.toMatch(/Add a field/);
  });
});

// objectstack#34608 — a builder editing an app is offered both halves, as the
// ruling put it:「问数据，或者让我改这个应用」. The empty state names data
// questions as well as changes, and the starters lead with data questions.
describe('edit mode offers data questions as well as changes (objectstack#34608)', () => {
  it('the edit-mode description names asking about the data and changing the app', () => {
    const s = agentEmptyState(t, 'build', { appLabel: 'Tiny Todo' });
    expect(s.description).toMatch(/ask about this app’s data/i);
    expect(s.description).toMatch(/counts, lists and summaries/i);
    expect(s.description).toMatch(/change/i);
  });

  it('editAppDataSuggestions are data questions, drawn from the ask agent’s starters', () => {
    const s = editAppDataSuggestions(t);
    expect(s.length).toBeGreaterThanOrEqual(2);
    for (const line of s) expect(line).not.toMatch(/^Add /);
  });
});
