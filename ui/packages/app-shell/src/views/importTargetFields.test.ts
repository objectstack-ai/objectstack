/**
 * importTargetFields — writable vs match-only derivation for the ImportWizard
 * (#020: "编号存在则更新" — the record number must be usable as an upsert match
 * key even though it is autonumber/readonly and therefore not writable).
 */
import { describe, it, expect } from 'vitest';
import { importTargetFields, type ImportFieldPerms } from './importTargetFields';

const fields = {
  code: { type: 'autonumber', label: '编号', required: true },
  name: { type: 'text', label: '名称', required: true },
  slot: { type: 'text', label: '机位号' },
  total: { type: 'formula', label: '合计' },
  child_sum: { type: 'summary', label: '子表合计' },
  locked_note: { type: 'text', label: '锁定备注', readonly: true },
};

const permsAllowing = (allow: (field: string, op: 'read' | 'write' | 'create') => boolean): ImportFieldPerms => ({
  isLoaded: true,
  checkField: (_obj, field, op) => allow(field, op),
});

describe('importTargetFields', () => {
  it('keeps writable fields as write targets and marks autonumber/readonly as match-only', () => {
    const out = importTargetFields('device', fields);
    const byName = Object.fromEntries(out.map((f) => [f.name, f]));

    expect(byName.name).toMatchObject({ required: true });
    expect(byName.name.matchOnly).toBeUndefined();
    expect(byName.slot.matchOnly).toBeUndefined();

    // The record number is present again — but only for matching.
    expect(byName.code).toMatchObject({ matchOnly: true, type: 'autonumber' });
    expect(byName.locked_note).toMatchObject({ matchOnly: true });
    // A match-only column is never a required WRITE column, even when the
    // schema declares required (the runtime owns the value).
    expect(byName.code.required).toBe(false);
  });

  it('still drops computed fields — no storage column to match or write', () => {
    const out = importTargetFields('device', fields);
    const names = out.map((f) => f.name);
    expect(names).not.toContain('total');
    expect(names).not.toContain('child_sum');
  });

  it('match-only targets are gated on FLS read; write targets on the FLS insert question', () => {
    // Reader who cannot write `name` and cannot read `locked_note`. An explicit
    // field-level refusal answers the insert question (`create`) and the update
    // one (`write`) alike, so the stub refuses both.
    const out = importTargetFields('device', fields, permsAllowing((field, op) =>
      op === 'read' ? field !== 'locked_note' : field === 'slot',
    ));
    const names = out.map((f) => f.name);
    expect(names).toContain('slot'); // writable
    expect(names).toContain('code'); // readable → match-only
    expect(names).not.toContain('locked_note'); // unreadable → gone entirely
    // `name` lost write access → degrades to a match-only (readable) target
    // rather than disappearing: it can still locate rows.
    expect(out.find((f) => f.name === 'name')).toMatchObject({ matchOnly: true, required: false });
  });

  it('objectui#12082: write targets ask the create question — a create-only caller keeps them', () => {
    // A create-only grant with no field entries: the resolver answers `create`
    // from `allowCreate` and `write` from `allowEdit`. Import inserts, and the
    // Import affordance is itself gated on the create grant, so every
    // insertable field stays a write target. Asking `write` here left this
    // caller an Import wizard whose every target was match-only.
    const createOnly = permsAllowing((_field, op) => op !== 'write');
    const out = importTargetFields('device', fields, createOnly);
    const byName = Object.fromEntries(out.map((f) => [f.name, f]));
    expect(byName.name).toMatchObject({ required: true });
    expect(byName.name.matchOnly).toBeUndefined();
    expect(byName.slot.matchOnly).toBeUndefined();
    // CONTROL — the edit-only mirror image loses them: `write` held, `create` refused.
    const editOnly = importTargetFields('device', fields, permsAllowing((_field, op) => op !== 'create'));
    expect(editOnly.find((f) => f.name === 'name')).toMatchObject({ matchOnly: true, required: false });
  });

  it('without a loaded perms channel, falls back to schema-only derivation', () => {
    const out = importTargetFields('device', fields, { isLoaded: false, checkField: () => false });
    expect(out.map((f) => f.name).sort()).toEqual(
      ['code', 'locked_note', 'name', 'slot'],
    );
  });
});
