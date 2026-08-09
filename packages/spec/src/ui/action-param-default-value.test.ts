// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6970 — an action param's `defaultValue` must satisfy the param's OWN value
 * contract at AUTHORING time, checked through the same `valueSchemaFor` the
 * dispatcher runs at submit (ADR-0104 D2).
 *
 * Before this, `defaultValue` was `z.unknown().optional()`: a default that
 * could never satisfy its own param parsed clean, prefilled the control, and
 * 400'd at submit on a field the user never touched.
 */

import { describe, it, expect } from 'vitest';

import { ActionParamSchema } from './action.zod';
import { validateActionParams } from './action-params.zod';
import { getMetadataTypeSchema } from '../kernel/metadata-type-schemas';

/** Parse a param and return its first `defaultValue` issue, or `null`. */
function defaultValueIssue(param: Record<string, unknown>) {
  const r = ActionParamSchema.safeParse(param);
  if (r.success) return null;
  return r.error.issues.find((i) => i.path.join('.') === 'defaultValue') ?? null;
}

/** What the ADR-0104 D2 dispatcher does with this default AS A SUBMITTED VALUE. */
function submitIssue(param: Record<string, unknown>) {
  const issues = validateActionParams(
    [{
      name: param.name as string,
      type: param.type as string | undefined,
      multiple: param.multiple as boolean | undefined,
      options: param.options as never,
    }],
    { [param.name as string]: param.defaultValue },
  );
  return issues[0] ?? null;
}

/**
 * The cases the issue names, plus the deliberate NON-rejections. `accepted`
 * is the verdict for BOTH moments — that equivalence is the point (see the
 * parity test at the bottom), so the table carries one column, not two.
 */
const CASES: Array<{ label: string; param: Record<string, unknown>; accepted: boolean }> = [
  // ── The hole, per type ────────────────────────────────────────────────────
  {
    label: "datetime + a wall-clock literal (the issue's example)",
    param: { name: 'start', type: 'datetime', defaultValue: '2026-08-10T15:00' },
    accepted: false,
  },
  { label: "number + 'abc'", param: { name: 'qty', type: 'number', defaultValue: 'abc' }, accepted: false },
  {
    label: 'select + a value not in its own options',
    param: {
      name: 'tier',
      type: 'select',
      options: [{ label: 'Gold', value: 'gold' }, { label: 'Silver', value: 'silver' }],
      defaultValue: 'platinum',
    },
    accepted: false,
  },
  {
    label: 'multiple: true + a scalar default',
    param: { name: 'owners', type: 'user', multiple: true, defaultValue: 'usr_1' },
    accepted: false,
  },
  {
    label: 'date + a full instant (the mirror of the datetime case)',
    param: { name: 'due', type: 'date', defaultValue: '2026-08-10T15:00:00.000Z' },
    accepted: false,
  },
  { label: 'boolean + a string', param: { name: 'notify', type: 'boolean', defaultValue: 'yes' }, accepted: false },
  {
    label: 'lookup + an embedded record object instead of an id',
    param: { name: 'owner', type: 'lookup', reference: 'sys_user', defaultValue: { id: 'usr_1', name: 'Ada' } },
    accepted: false,
  },

  // ── Valid defaults of each type: untouched ────────────────────────────────
  {
    label: 'VALID datetime (ISO instant with zone)',
    param: { name: 'start', type: 'datetime', defaultValue: '2026-08-10T15:00:00.000Z' },
    accepted: true,
  },
  { label: 'VALID number', param: { name: 'qty', type: 'number', defaultValue: 7 }, accepted: true },
  {
    label: 'VALID select member',
    param: { name: 'tier', type: 'select', options: [{ label: 'Gold', value: 'gold' }], defaultValue: 'gold' },
    accepted: true,
  },
  {
    label: 'VALID multiple array',
    param: { name: 'owners', type: 'user', multiple: true, defaultValue: ['usr_1'] },
    accepted: true,
  },
  { label: 'VALID date', param: { name: 'due', type: 'date', defaultValue: '2026-08-10' }, accepted: true },
  { label: 'VALID boolean', param: { name: 'notify', type: 'boolean', defaultValue: true }, accepted: true },
  {
    label: 'json — an explicitly OPEN value contract, so any default rides',
    param: { name: 'blob', type: 'json', defaultValue: { anything: ['at', 'all'] } },
    accepted: true,
  },
  {
    label: 'no `type` — the value shape is unresolvable, so it stays open',
    param: { name: 'loose', defaultValue: 'whatever' },
    accepted: true,
  },

  // ── Presence parity: the dispatcher treats these as ABSENT ────────────────
  {
    label: "empty-string default on a datetime — ABSENT at submit, so not judged here either",
    param: { name: 'start', type: 'datetime', defaultValue: '' },
    accepted: true,
  },
  {
    label: 'null default on a number — ABSENT at submit',
    param: { name: 'qty', type: 'number', defaultValue: null },
    accepted: true,
  },
];

describe('#6970 ActionParamSchema.defaultValue — authored defaults meet the param value contract', () => {
  for (const { label, param, accepted } of CASES) {
    it(`${accepted ? 'accepts' : 'rejects'}: ${label}`, () => {
      const issue = defaultValueIssue(param);
      if (accepted) {
        expect(issue).toBeNull();
        return;
      }
      // Rejection pin: this is a pure Zod parse (no error envelope), so the
      // assertion set is issue PATH + message shape — never a bare
      // `success === false`, which cannot tell this rejection from the
      // schema refusing the param for some unrelated reason.
      expect(issue).not.toBeNull();
      expect(issue!.path).toEqual(['defaultValue']);
      expect(issue!.code).toBe('custom');
      // Names the param, its type, and the offending literal — the three
      // things the submit-time 400 could not say.
      expect(issue!.message).toContain(`"${param.name as string}"`);
      expect(issue!.message).toContain(`(${param.type as string})`);
      expect(issue!.message).toContain(JSON.stringify(param.defaultValue));
    });
  }

  it("names the author's default as the cause, not just the param", () => {
    const issue = defaultValueIssue({ name: 'start', type: 'datetime', defaultValue: '2026-08-10T15:00' })!;
    // The underlying reason is carried verbatim from the shared value contract,
    // so authoring and submit read identically.
    expect(issue.message).toContain('expected an ISO-8601 instant with explicit zone');
    expect(issue.message).toContain('cannot satisfy this param');
    expect(issue.message).toContain('PREFILL');
  });

  it('reports through the real authoring door with a full params path', () => {
    const r = getMetadataTypeSchema('action')!.safeParse({
      name: 'schedule_visit',
      label: 'Schedule Visit',
      type: 'script',
      params: [
        { name: 'note', type: 'text' },
        { name: 'start', type: 'datetime', defaultValue: '2026-08-10T15:00' },
      ],
    });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('params.1.defaultValue');
  });

  // ── The design's two deliberate non-rejections ────────────────────────────
  it('does NOT judge arity it cannot know — a field-backed param inherits `multiple`', () => {
    // `{ field: 'owners' }` inherits `multiple: true` from the referenced
    // field, which is invisible at parse time. Rejecting this array would be
    // the authoring gate guessing, and guessing wrong rejects valid metadata.
    expect(defaultValueIssue({ field: 'owners', type: 'user', defaultValue: ['usr_1', 'usr_2'] })).toBeNull();
    // The scalar spelling of the same inherited-arity param is equally legal.
    expect(defaultValueIssue({ field: 'owners', type: 'user', defaultValue: 'usr_1' })).toBeNull();
  });

  it('still judges arity when the param STATES it, field-backed or not', () => {
    // `multiple` declared → the declaration answers the question, so it binds.
    expect(defaultValueIssue({ field: 'owners', type: 'user', multiple: true, defaultValue: 'usr_1' }))
      .not.toBeNull();
    // Inline (no `field`) → nothing to inherit from, so silence means scalar.
    expect(defaultValueIssue({ name: 'owners', type: 'user', defaultValue: ['usr_1'] })).not.toBeNull();
  });

  it('does NOT judge option membership it cannot know — inherited option sets stay open', () => {
    // No inline `options`: the set comes from the referenced field, so
    // `valueSchemaFor` degrades to free-form and any string default rides.
    expect(defaultValueIssue({ field: 'tier', type: 'select', defaultValue: 'gold' })).toBeNull();
  });

  it('leaves params WITHOUT a defaultValue completely untouched', () => {
    for (const type of ['datetime', 'number', 'select', 'user', 'date', 'boolean']) {
      expect(ActionParamSchema.safeParse({ name: 'x', type }).success).toBe(true);
    }
  });

  /**
   * The ruling's actual claim: `defaultValue` goes through the SAME
   * `valueSchemaFor` machinery the dispatcher uses — no second rule set. This
   * is the pin that would catch a future edit re-implementing the check by
   * hand, which is how the two ends drift into two dialects.
   */
  it('agrees with the dispatcher on every case — one rule set, two moments', () => {
    for (const { label, param } of CASES) {
      // Arity/membership the AUTHORING side deliberately cannot resolve are
      // excluded: the dispatcher is fed the RESOLVED param, so for those rows
      // the two sides are answering different questions by design.
      if (param.field !== undefined) continue;
      const authoringRejects = defaultValueIssue(param) !== null;
      const submitRejects = submitIssue(param) !== null;
      expect(
        { case: label, authoringRejects },
        `authoring and submit must agree for: ${label}`,
      ).toEqual({ case: label, authoringRejects: submitRejects });
    }
  });
});
