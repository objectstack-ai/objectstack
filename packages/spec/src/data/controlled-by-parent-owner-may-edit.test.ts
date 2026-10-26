// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

// Read through the `@objectstack/spec/data` entry, not the module: the pin is
// on the PUBLISHED reader the gate and the lint import.
import { controlledByParentOwnerMayEdit } from './index';
import { ObjectSchema } from './object.zod';

/**
 * [ADR-0055 §3 amendment · ruling 6398566164] `sharing.controlledByParent.ownerMayEdit`
 * is an authorable key of a `controlled_by_parent` detail — reachable (no
 * `unrecognized_keys`, the parse keeps the value) — and the parse refuses it
 * on an object whose `sharingModel` is not `controlled_by_parent`, at the key's
 * own path, with the prescription. The exported reader answers `true` for the
 * boolean `true` alone, and `false` for every unreadable shape.
 */

const md = (reference: string) => ({ type: 'master_detail', label: reference, reference, required: true });

const detail = (extra: Record<string, unknown> = {}) => ({
  name: 'omd_obligation',
  label: 'Obligation',
  sharingModel: 'controlled_by_parent',
  fields: { contract: md('omd_contract') },
  ...extra,
});

const OPT_IN = { sharing: { controlledByParent: { ownerMayEdit: true } } };
const OWNER_MAY_EDIT_PATH = 'sharing.controlledByParent.ownerMayEdit';

function issuesOf(obj: Record<string, unknown>): Array<{ code: string; path: string; message: string }> {
  const parsed = ObjectSchema.safeParse(obj);
  if (parsed.success) return [];
  return parsed.error.issues.map((i) => ({ code: i.code, path: i.path.join('.'), message: i.message }));
}

describe('sharing.controlledByParent.ownerMayEdit (ADR-0055 §3 amendment)', () => {
  it('is an authorable key of a controlled_by_parent detail: the parse keeps it and refuses nothing', () => {
    const parsed = ObjectSchema.safeParse(detail(OPT_IN));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.sharing?.controlledByParent?.ownerMayEdit).toBe(true);
    expect(controlledByParentOwnerMayEdit(parsed.data)).toBe(true);
    // The whole parse is green, so no key of the block landed as `unrecognized_keys`.
    expect(issuesOf(detail(OPT_IN)).filter((i) => i.code === 'unrecognized_keys')).toEqual([]);
  });

  it('`ObjectSchema.create()` keeps it too', () => {
    const created = ObjectSchema.create(detail(OPT_IN) as never);
    expect(controlledByParentOwnerMayEdit(created)).toBe(true);
  });

  it.each([
    ['private', "under 'private'"],
    ['public_read', "under 'public_read'"],
    ['public_read_write', "under 'public_read_write'"],
  ])('is refused on a %s object, at the key, with the fix', (sharingModel, under) => {
    const issues = issuesOf({ name: 'omd_contract', label: 'Contract', sharingModel, fields: {}, ...OPT_IN });
    const own = issues.filter((i) => i.path === OWNER_MAY_EDIT_PATH);
    expect(own).toHaveLength(1);
    expect(own[0]!.code).toBe('custom');
    expect(own[0]!.message.startsWith(
      `Object "omd_contract" declares sharing.controlledByParent.ownerMayEdit: true ${under}.`,
    )).toBe(true);
    expect(own[0]!.message).toContain("sharingModel: 'controlled_by_parent' plus one required master_detail field");
    // Nothing else is refused: the object is otherwise sound.
    expect(issues).toHaveLength(1);
  });

  it('is refused on an object that declares no sharingModel at all, saying so', () => {
    const issues = issuesOf({ name: 'omd_contract', label: 'Contract', fields: {}, ...OPT_IN });
    const own = issues.filter((i) => i.path === OWNER_MAY_EDIT_PATH);
    expect(own).toHaveLength(1);
    expect(own[0]!.message).toContain('under no sharingModel.');
  });

  it('`ObjectSchema.create()` throws the same refusal', () => {
    expect(() =>
      ObjectSchema.create({ name: 'omd_contract', label: 'Contract', sharingModel: 'private', fields: {}, ...OPT_IN } as never),
    ).toThrow(ZodError);
  });

  it.each([
    ['`ownerMayEdit: false`', { sharing: { controlledByParent: { ownerMayEdit: false } } }],
    ['an empty `controlledByParent` block', { sharing: { controlledByParent: {} } }],
    ['an empty `sharing` block', { sharing: {} }],
  ])('%s on a private object is not an opt-in and is not refused', (_label, sharing) => {
    const obj = { name: 'omd_contract', label: 'Contract', sharingModel: 'private', fields: {}, ...sharing };
    expect(issuesOf(obj)).toEqual([]);
    expect(controlledByParentOwnerMayEdit(obj)).toBe(false);
  });

  it('the block is closed: `ownerMayEdit` one level up is refused as an unknown key, naming its level', () => {
    const issues = issuesOf(detail({ sharing: { ownerMayEdit: true } }));
    const unknown = issues.filter((i) => i.code === 'unrecognized_keys');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.path).toBe('sharing');
    expect(unknown[0]!.message).toContain('sharing.controlledByParent');
  });

  it('the nested block is closed: a misspelt key under `controlledByParent` is refused', () => {
    const issues = issuesOf(detail({ sharing: { controlledByParent: { ownerCanEdit: true } } }));
    const unknown = issues.filter((i) => i.code === 'unrecognized_keys');
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.path).toBe('sharing.controlledByParent');
  });

  it('only the boolean opts in: a string is refused by the parse, and the reader reads it as off', () => {
    const raw = detail({ sharing: { controlledByParent: { ownerMayEdit: 'true' } } });
    const issues = issuesOf(raw);
    expect(issues.some((i) => i.path === OWNER_MAY_EDIT_PATH && i.code === 'invalid_type')).toBe(true);
    expect(controlledByParentOwnerMayEdit(raw)).toBe(false);
  });

  it('the reader fails closed on every unreadable shape', () => {
    for (const shape of [null, undefined, 42, 'x', {}, { sharing: null }, { sharing: { controlledByParent: null } }, { sharing: { controlledByParent: { ownerMayEdit: 1 } } }]) {
      expect(controlledByParentOwnerMayEdit(shape)).toBe(false);
    }
  });
});
