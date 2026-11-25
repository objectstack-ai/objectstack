// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0160 D7 — `type: 'ask_ai'` has no server dispatch.
 *
 * The console focuses its in-app assistant on the record and sends nothing.
 * The two predicates every headless door asks are the whole of the server
 * half:
 *
 *   · `isHeadlessInvokableAction` answers `false`, so MCP `list_actions` skips
 *     it and the `ai` posture of the action door refuses it — whatever the
 *     declaration carries beside the type (a data-at-rest row can carry keys
 *     the parse refuses, such as a `target` or `ai.exposed: true`);
 *   · `headlessActionTypeError` answers the REST caller with a sentence that
 *     describes THIS type — not the generic "the renderer opens its `target`",
 *     which names a key `ask_ai` refuses at parse.
 */
import { describe, it, expect } from 'vitest';
import { isHeadlessInvokableAction, headlessActionTypeError } from './action-execution.js';

const NO_DEPS = {} as never;
const ASK = { name: 'ask_about_account', type: 'ask_ai' };

describe('ask_ai — no server dispatch (ADR-0160 D7)', () => {
  it('is not headless-invokable, with or without an automation service', () => {
    expect(isHeadlessInvokableAction(NO_DEPS, ASK, true)).toBe(false);
    expect(isHeadlessInvokableAction(NO_DEPS, ASK, false)).toBe(false);
  });

  it('stays not invokable for a row at rest that carries what the parse refuses', () => {
    const atRest = {
      ...ASK,
      target: '/api/v1/data/account',
      body: { language: 'js', source: 'return 1;' },
      ai: { exposed: true, description: 'Opens the assistant focused on this account record.' },
    };
    expect(isHeadlessInvokableAction(NO_DEPS, atRest, true)).toBe(false);
  });

  it('is refused at the REST door with a sentence about the assistant, naming no target', () => {
    const error = headlessActionTypeError(NO_DEPS, ASK, 'account');
    expect(error).not.toBeNull();
    expect(error!.split(' — ')[0]).toBe("Action 'ask_about_account' on 'account' is `type: 'ask_ai'`");
    expect(error).toContain('in-app assistant');
    expect(error).not.toContain('target');
  });

  it('leaves the other client types on the generic sentence', () => {
    expect(headlessActionTypeError(NO_DEPS, { name: 'go', type: 'url', target: '/x' }, 'account'))
      .toContain('The renderer opens its `target`');
  });
});
