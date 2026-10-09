// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ObjectSchema } from './object.zod';

// ---------------------------------------------------------------------------
// [#22211 ruling A, #22386] `ObjectSchema.attachedOnRead` — the blocks a
// service attaches to each row it serves, computed per caller and never
// stored: block name → (leaf key → value type).
//
// The declaration is what the shared expression validator judges
// `record.<block>.<leaf>` against (pinned in `@objectstack/formula` and
// `@objectstack/lint`); this file pins the SHAPE: a well-formed declaration
// round-trips, its absence changes nothing, and every malformed form is
// refused at parse, located at the offending key. Refusals are asserted by
// code and path — the machine-readable subject — never by the prose.
// ---------------------------------------------------------------------------

const VIEWER = { can_act: 'boolean', can_override: 'boolean', is_submitter: 'boolean' } as const;

const request = (attachedOnRead?: unknown, fields: Record<string, unknown> = {}) => ({
  name: 'approval_request_probe',
  fields: {
    status: { type: 'text', label: 'Status' },
    ...fields,
  },
  ...(attachedOnRead === undefined ? {} : { attachedOnRead }),
});

/** The refusal issues, as `{ code, path }`, of an input that must NOT parse. */
function refusals(input: unknown): Array<{ code: string; path: PropertyKey[] }> {
  const parsed = ObjectSchema.safeParse(input);
  expect(parsed.success, 'the declaration must NOT parse clean').toBe(false);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ code: i.code, path: i.path }));
}

describe('ObjectSchema.attachedOnRead — the declaration', () => {
  it('accepts a block of leaves typed with the four value types, and keeps it as authored', () => {
    const declared = { viewer: VIEWER, decision_progress: { behavior: 'text', got: 'number', need: 'number', due_on: 'date' } };
    const parsed = ObjectSchema.safeParse(request(declared));
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.attachedOnRead).toEqual(declared);
  });

  it('is optional: an object without it parses exactly as before, with no key materialized (control)', () => {
    const parsed = ObjectSchema.safeParse(request());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect('attachedOnRead' in parsed.data).toBe(false);
  });

  it('is a known key at the authoring factory, so `ObjectSchema.create()` takes it', () => {
    const created = ObjectSchema.create({
      name: 'approval_request_probe',
      fields: { status: { type: 'text', label: 'Status' } },
      attachedOnRead: { viewer: { ...VIEWER } },
    });
    expect(created.attachedOnRead).toEqual({ viewer: VIEWER });
  });
});

describe('ObjectSchema.attachedOnRead — malformed declarations are refused at parse', () => {
  it('refuses a leaf typed outside the four value types', () => {
    expect(refusals(request({ viewer: { can_act: 'json' } }))).toEqual([
      { code: 'invalid_value', path: ['attachedOnRead', 'viewer', 'can_act'] },
    ]);
    expect(refusals(request({ viewer: { can_act: 'lookup' } }))).toEqual([
      { code: 'invalid_value', path: ['attachedOnRead', 'viewer', 'can_act'] },
    ]);
  });

  it('refuses a leaf that is a nested block or a field definition, not a type', () => {
    expect(refusals(request({ viewer: { can: { act: 'boolean' } } }))).toEqual([
      { code: 'invalid_value', path: ['attachedOnRead', 'viewer', 'can'] },
    ]);
    expect(refusals(request({ viewer: { can_act: { type: 'boolean' } } }))).toEqual([
      { code: 'invalid_value', path: ['attachedOnRead', 'viewer', 'can_act'] },
    ]);
  });

  it('refuses a leaf key outside the field-name grammar', () => {
    const issues = refusals(request({ viewer: { canAct: 'boolean' } }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path.slice(0, 2)).toEqual(['attachedOnRead', 'viewer']);
    expect(issues[0].code).toBe('invalid_key');
  });

  it('refuses a block that is not a map of leaves', () => {
    expect(refusals(request({ viewer: 'boolean' }))).toEqual([
      { code: 'invalid_type', path: ['attachedOnRead', 'viewer'] },
    ]);
    expect(refusals(request({ viewer: ['can_act'] }))).toEqual([
      { code: 'invalid_type', path: ['attachedOnRead', 'viewer'] },
    ]);
  });

  it('refuses a block name outside the field-name grammar', () => {
    const issues = refusals(request({ Viewer: VIEWER }));
    expect(issues).toHaveLength(1);
    expect(issues[0].path[0]).toBe('attachedOnRead');
    expect(issues[0].code).toBe('invalid_key');
  });

  it('refuses a block that names no leaf', () => {
    expect(refusals(request({ viewer: {} }))).toEqual([{ code: 'custom', path: ['attachedOnRead', 'viewer'] }]);
  });

  it('refuses a block that reuses a declared field name — a read attachment is not a field', () => {
    expect(refusals(request({ viewer: VIEWER }, { viewer: { type: 'text', label: 'Viewer' } }))).toEqual([
      { code: 'custom', path: ['attachedOnRead', 'viewer'] },
    ]);
  });
});
