/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7297 — `{record_id}`, the record-scoped filter token
 * `@objectstack/spec` declares beside the two session tokens
 * (`RECORD_CONTEXT_TOKENS`, objectstack-ai/objectstack#20003).
 *
 * The resolver fills it from `FilterTokenScope.recordId` (which
 * `useFilterScope()` in `@object-ui/react` reads from the mounted
 * `RecordContextProvider`) and from nothing else. With no record in scope it is
 * refused BY NAME through `onUnresolved`, the channel an unresolved session
 * token uses, and left as written: never `null`, never dropped, and never
 * reported as an unknown spelling.
 */

import { describe, it, expect, vi } from 'vitest';
import { RECORD_CONTEXT_TOKENS } from '@objectstack/spec/data';

import { resolveContextTokens, resolveFilterPlaceholders } from '../filter-tokens';

const SESSION = { currentUserId: 'usr_42', currentOrgId: 'org_7' };

/** Resolve one filter and report both halves of the observable result. */
function resolve(filter: unknown, scope: Record<string, unknown>) {
  const warnings: string[] = [];
  const out = resolveContextTokens(filter, { ...scope, onUnresolved: (m: string) => warnings.push(m) });
  return { out, warnings };
}

describe('{record_id} resolves against the record in scope (objectui#7297)', () => {
  it('is the one record-context token the installed spec declares', () => {
    // The resolver's `satisfies Record<RecordContextToken, …>` literal reds the
    // compile on a second one; this states the same ratchet at runtime.
    expect([...RECORD_CONTEXT_TOKENS]).toEqual(['record_id']);
  });

  it('resolves in every filter shape, in both spellings', () => {
    const scope = { ...SESSION, recordId: 'rec_A' };
    expect(resolve({ assignee: '{record_id}', status: 'open' }, scope)).toEqual({
      out: { assignee: 'rec_A', status: 'open' },
      warnings: [],
    });
    expect(resolve([{ field: 'assignee', operator: 'equals', value: '{record_id}' }], scope).out).toEqual([
      { field: 'assignee', operator: 'equals', value: 'rec_A' },
    ]);
    expect(resolve([['assignee', '=', '{record_id}']], scope).out).toEqual([['assignee', '=', 'rec_A']]);
    expect(resolve({ $and: [{ assignee: { $in: ['${record_id}'] } }] }, scope).out).toEqual({
      $and: [{ assignee: { $in: ['rec_A'] } }],
    });
  });

  it('follows the record: two records, two resolutions', () => {
    const filter = { assignee: '{record_id}' };
    expect(resolve(filter, { recordId: 'rec_A' }).out).toEqual({ assignee: 'rec_A' });
    expect(resolve(filter, { recordId: 'rec_B' }).out).toEqual({ assignee: 'rec_B' });
  });

  it('resolves alongside the session tokens without either reading the other', () => {
    const { out, warnings } = resolve(
      { assignee: '{record_id}', owner: '{current_user_id}', org: '{current_org_id}' },
      { ...SESSION, recordId: 'rec_A' },
    );
    expect(out).toEqual({ assignee: 'rec_A', owner: 'usr_42', org: 'org_7' });
    expect(warnings).toEqual([]);
  });

  it('takes nothing from the session: a signed-in scope with no record refuses it', () => {
    const { out, warnings } = resolve({ assignee: '{record_id}' }, SESSION);
    expect(out).toEqual({ assignee: '{record_id}' });
    expect(warnings).toHaveLength(1);
  });

  it('gives the session tokens nothing: a record id does not resolve {current_user_id}', () => {
    const { out, warnings } = resolve({ owner: '{current_user_id}' }, { recordId: 'rec_A' });
    expect(out).toEqual({ owner: '{current_user_id}' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"{current_user_id}"');
  });
});

describe('{record_id} with no record in scope is refused by name (objectui#7297)', () => {
  for (const [label, scope] of [
    ['no recordId member', {}],
    ['recordId null', { recordId: null }],
    ['recordId undefined', { recordId: undefined }],
    ['recordId empty', { recordId: '' }],
  ] as const) {
    it(`${label}: left as written, one warning naming the token and the missing record`, () => {
      const { out, warnings } = resolve({ assignee: '{record_id}', status: 'open' }, { ...SESSION, ...scope });
      // Left as written: not `null` (a count about nobody), and the condition is
      // still there (dropping it would count everybody).
      expect(out).toEqual({ assignee: '{record_id}', status: 'open' });
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"{record_id}"');
      expect(warnings[0]).toContain('no record in context');
      // Refused as a KNOWN token on the wrong surface, never as a misspelling:
      // the spelling is right and the surface is not.
      expect(warnings[0]).not.toContain('not a recognised token');
      expect(warnings[0]).not.toContain('did you mean');
    });
  }

  it('takes the ${record_id} spelling down the same refusal', () => {
    const { out, warnings } = resolve({ assignee: '${record_id}' }, SESSION);
    expect(out).toEqual({ assignee: '${record_id}' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"{record_id}"');
  });

  it('warns on console by default, the same default an unresolved session token has', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(resolveContextTokens({ assignee: '{record_id}' })).toEqual({ assignee: '{record_id}' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('"{record_id}"');
    } finally {
      warn.mockRestore();
    }
  });

  it('is refused through resolveFilterPlaceholders too, the call every surface makes', () => {
    const warnings: string[] = [];
    const out = resolveFilterPlaceholders(
      { assignee: '{record_id}', due: { $lte: '{today}' } },
      { ...SESSION, onUnresolved: (m) => warnings.push(m) },
      new Date('2026-09-30T12:00:00Z'),
    );
    expect(out.assignee).toBe('{record_id}');
    expect(out.due.$lte).not.toBe('{today}');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('"{record_id}"');
  });
});
