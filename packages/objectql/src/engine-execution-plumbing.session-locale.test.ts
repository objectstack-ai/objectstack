// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26170] `HookContext.session.locale` — the caller's locale rides on the
 * session a hook receives, so the sandboxed body runner can answer a declared
 * hook refusal (`hooks.<hook>.refusals.<CODE>.message`) in the caller's
 * language.
 */

import { describe, it, expect } from 'vitest';
import { assembleExecutionContextOrGuest } from '@objectstack/core';
import { buildSession } from './engine-execution-plumbing.js';

describe('[#26170] buildSession carries the caller\'s locale', () => {
  it('copies `execCtx.locale` onto a session that exists', () => {
    expect(buildSession({ userId: 'u1', locale: 'zh-CN' } as any)).toMatchObject({ userId: 'u1', locale: 'zh-CN' });
  });

  it('a locale alone does not make a session — it says how to speak, not who is speaking', () => {
    expect(buildSession({ locale: 'zh-CN' } as any)).toBeUndefined();
  });

  it('writes no `locale` key when none was asked', () => {
    for (const locale of [undefined, '']) {
      expect(buildSession({ userId: 'u1', locale } as any)).not.toHaveProperty('locale');
    }
  });
});

// Create hooks with a bare-kernel carve-out (`sys_attachment`'s and
// `sys_comment`'s) read "no hook session" as an internal, context-less engine
// call and skip their user checks for it. That reading is sound only while
// every request door hands the engine a context this function turns into a
// session — the guest door included, whose envelope names no user. Built
// through the REAL guest entry (`@objectstack/core`), not a literal, so a
// change to what that entry emits is measured here rather than assumed.
describe('a guest request reaches create hooks with a session, so an anonymous create is never treated as a bare-kernel call', () => {
  // The anonymous resolver's own answer for a request with no credential:
  // the initial context `resolveAuthzContext` returns before any principal
  // is found (`packages/core/src/security/resolve-authz-context.ts`).
  const anonymousAuthz = () => ({
    positions: [] as string[],
    permissions: [] as string[],
    directPermissions: [] as string[],
    systemPermissions: [] as string[],
    org_user_ids: [] as string[],
    accessible_org_ids: [] as string[],
  });

  it('the guest envelope with no tenant, no grants and no token still yields a session that names no user', () => {
    const guest = assembleExecutionContextOrGuest({
      authz: anonymousAuthz(),
      oauth: undefined,
      localization: undefined,
      requestLocale: undefined,
      accessToken: undefined,
      authGate: undefined,
    });
    const session = buildSession(guest);
    expect(session).toBeDefined();
    expect(session?.userId).toBeUndefined();
    // Not the system arm either: the hooks test `isSystem` before the user.
    expect(session).not.toHaveProperty('isSystem');
  });

  it('CONTROL: an envelope that names nothing the session copies yields no session — the bare-kernel reading', () => {
    // The carve-out's own premise, so the pin above cannot pass on a
    // `buildSession` that answers a session for every input.
    expect(buildSession({ principalKind: 'guest' } as any)).toBeUndefined();
  });
});

// [ADR-0151 D5 · O4] The principal's kind rides on the hook session, so a
// hook asks one question — "did an agent do this?" — for an OAuth client and
// an AI service account alike. Built through the REAL assembler where a door
// decides it, so what the doors emit is measured here rather than assumed.
describe('[ADR-0151 D5] buildSession carries the principal\'s kind', () => {
  const authz = (over: Record<string, unknown> = {}) => ({
    userId: 'u1', tenantId: 'org_1',
    positions: [] as string[], permissions: [] as string[], directPermissions: [] as string[],
    systemPermissions: [] as string[], org_user_ids: ['u1'], accessible_org_ids: ['org_1'],
    ...over,
  });
  const door = (a: Record<string, unknown>) => assembleExecutionContextOrGuest({
    authz: a as any, oauth: undefined, localization: undefined, requestLocale: undefined,
    accessToken: undefined, authGate: undefined,
  });

  it('an AI service account reads `agent` with itself as the caller', () => {
    const session = buildSession(door(authz({ userId: 'u_bot', principalKind: 'agent' })));
    expect(session).toMatchObject({ userId: 'u_bot', principalKind: 'agent' });
  });

  it('CONTROL — a person reads `human` through the door', () => {
    expect(buildSession(door(authz()))).toMatchObject({ userId: 'u1', principalKind: 'human' });
  });

  it('copies each of the envelope\'s five values verbatim', () => {
    for (const principalKind of ['human', 'agent', 'service', 'guest', 'system'] as const) {
      expect(buildSession({ userId: 'u1', principalKind } as any)?.principalKind).toBe(principalKind);
    }
  });

  it('an envelope with no kind reads no kind — never a defaulted `human`', () => {
    expect(buildSession({ userId: 'u1' } as any)).not.toHaveProperty('principalKind');
  });

  it('a kind alone does not make a session — it says what sort of caller, not who', () => {
    expect(buildSession({ principalKind: 'agent' } as any)).toBeUndefined();
  });
});
