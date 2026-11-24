// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  installCommentReplyReopens,
  isResolutionOnlyUpdate,
  stampCommentResolution,
  threadsInvolvingUser,
} from './comment-resolution.js';

/**
 * #36071 — the pure parts of the resolution: the "involving me" rule the
 * comment panel filters a record's loaded threads by, the resolution-only
 * predicate the update gate reads, the stamp's no-change and import arms,
 * and the reopen hook's loud failure. The engine-decided parts are pinned in
 * `comment-resolution.integration.test.ts`.
 */

const ME = 'u_me';

describe('threadsInvolvingUser — "involving me" over one record\'s loaded threads', () => {
  const rows = [
    { id: 'started', parent_id: null, author_id: ME, mentions: null },
    { id: 'replied', parent_id: null, author_id: 'u_a', mentions: null },
    { id: 'replied.1', parent_id: 'replied', author_id: ME, mentions: null },
    { id: 'mentioned-root', parent_id: null, author_id: 'u_a', mentions: JSON.stringify([ME]) },
    { id: 'mentioned-reply', parent_id: null, author_id: 'u_a', mentions: '[]' },
    { id: 'mentioned-reply.1', parent_id: 'mentioned-reply', author_id: 'u_b', mentions: JSON.stringify([{ id: ME }]) },
    { id: 'nested', parent_id: null, author_id: 'u_a', mentions: null },
    { id: 'nested.1', parent_id: 'nested', author_id: 'u_b', mentions: null },
    { id: 'nested.1.1', parent_id: 'nested.1', author_id: ME, mentions: null },
    { id: 'others', parent_id: null, author_id: 'u_a', mentions: JSON.stringify(['u_b']) },
    { id: 'others.1', parent_id: 'others', author_id: 'u_b', mentions: 'not json' },
    { id: 'orphan', parent_id: 'not-loaded', author_id: ME, mentions: null },
  ];

  it('a thread I started, replied in, or am mentioned in (root or reply) — and no other', () => {
    expect([...threadsInvolvingUser(rows, ME)].sort()).toEqual(
      ['mentioned-reply', 'mentioned-root', 'nested', 'replied', 'started'].sort(),
    );
  });

  it('mentioned only, never having written in the thread, is involved', () => {
    const only = threadsInvolvingUser(rows, ME);
    expect(only.has('mentioned-root')).toBe(true);
    expect(only.has('mentioned-reply')).toBe(true);
  });

  it('answers top-level ids only, and nothing for a reply whose chain leaves the loaded set', () => {
    const ids = threadsInvolvingUser(rows, ME);
    expect(ids.has('replied.1')).toBe(false);
    expect(ids.has('orphan')).toBe(false);
    expect(ids.has('not-loaded')).toBe(false);
  });

  it('a user who appears nowhere is involved in nothing', () => {
    expect(threadsInvolvingUser(rows, 'u_nobody').size).toBe(0);
  });
});

describe('isResolutionOnlyUpdate', () => {
  it('is_resolved alone, or beside the row address and the platform stamps', () => {
    expect(isResolutionOnlyUpdate({ is_resolved: true })).toBe(true);
    expect(isResolutionOnlyUpdate({ id: 'c1', is_resolved: false, updated_at: 'x', updated_by: 'y', resolved_by: 'z', resolved_at: 'w' })).toBe(true);
  });
  it('anything else beside it, or no is_resolved at all, is not', () => {
    expect(isResolutionOnlyUpdate({ is_resolved: true, body: 'b' })).toBe(false);
    expect(isResolutionOnlyUpdate({ is_resolved: true, thread_id: 'a:1' })).toBe(false);
    expect(isResolutionOnlyUpdate({ resolved_by: 'z' })).toBe(false);
    expect(isResolutionOnlyUpdate({})).toBe(false);
    expect(isResolutionOnlyUpdate(null)).toBe(false);
    expect(isResolutionOnlyUpdate([])).toBe(false);
  });
});

describe('stampCommentResolution — the arms the real-engine pins do not reach', () => {
  it('a historical import (preserveAudit) keeps the resolver and time it supplies', async () => {
    const data: Record<string, unknown> = { is_resolved: true, resolved_by: 'u_then', resolved_at: '2020-01-01T00:00:00.000Z' };
    await stampCommentResolution({ input: { data }, previous: { is_resolved: false }, session: { userId: 'u_now', preserveAudit: true } });
    expect(data).toMatchObject({ resolved_by: 'u_then', resolved_at: '2020-01-01T00:00:00.000Z' });
  });
  it('a system write resolving with no user records no resolver, and the server clock', async () => {
    const data: Record<string, unknown> = { is_resolved: true };
    await stampCommentResolution({ input: { data }, previous: { is_resolved: false }, session: { isSystem: true } });
    expect(data.resolved_by).toBeNull();
    expect(typeof data.resolved_at).toBe('string');
  });
  it('a system write attributed to a caller (the resolution door) records that caller as the resolver', async () => {
    const data: Record<string, unknown> = { is_resolved: true };
    await stampCommentResolution({
      input: { data },
      previous: { is_resolved: false },
      session: { isSystem: true },
      provenance: { attributedUserId: 'u_door_caller' },
    });
    expect(data.resolved_by).toBe('u_door_caller');
    expect(typeof data.resolved_at).toBe('string');
  });
  it("an attribution never outranks a non-system write's own session user", async () => {
    const data: Record<string, unknown> = { is_resolved: true };
    await stampCommentResolution({
      input: { data },
      previous: { is_resolved: false },
      session: { userId: 'u_session' },
      provenance: { attributedUserId: 'u_other' },
    });
    expect(data.resolved_by).toBe('u_session');
  });
  it('a non-boolean is_resolved is left to the record validator, unstamped', async () => {
    const data: Record<string, unknown> = { is_resolved: 'yes' };
    await stampCommentResolution({ input: { data }, previous: { is_resolved: false }, session: { userId: 'u' } });
    expect(data).toEqual({ is_resolved: 'yes' });
  });
});

describe('installCommentReplyReopens — a reopen that fails is said at error', () => {
  it('names the stored reply, the thread left resolved, and the fix', async () => {
    let hook: ((ctx: any) => Promise<void>) | undefined;
    const logger = { warn: vi.fn(), error: vi.fn() };
    installCommentReplyReopens(
      {
        registerHook: (_e, h) => {
          hook = h as any;
        },
        findOne: async () => ({ id: 'root', parent_id: null, is_resolved: true }),
        update: async () => {
          throw new Error('disk full');
        },
      },
      logger,
      { packageId: 'test' },
    );
    await hook!({ result: { id: 'r1', parent_id: 'root' }, session: { userId: 'u' } });
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = String(logger.error.mock.calls[0][0]);
    expect(line).toContain('reply r1 was stored');
    expect(line).toContain('comment root');
    expect(line).toContain('is_resolved');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a historical import does not reopen', async () => {
    let hook: ((ctx: any) => Promise<void>) | undefined;
    const update = vi.fn();
    installCommentReplyReopens(
      { registerHook: (_e, h) => { hook = h as any; }, findOne: async () => ({ id: 'root', is_resolved: true }), update },
      { warn: vi.fn() },
      { packageId: 'test' },
    );
    await hook!({ result: { id: 'r1', parent_id: 'root' }, session: { isSystem: true, preserveAudit: true } });
    expect(update).not.toHaveBeenCalled();
  });
});
