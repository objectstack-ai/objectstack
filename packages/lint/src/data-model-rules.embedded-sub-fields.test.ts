// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `field/embedded-sub-fields` — an object-level `composite` / `repeater` is
// untyped JSON (ruling 6386744473), so declaring `fields` / `subFields` /
// `columns` on one is an error whose route is a child object.
//
// The rule reaches only the doors that never parse (its docblock's intake
// table): the strict field schema refuses the same keys first, with the same
// route. Both halves are pinned below, so neither can be credited for the
// other's door.
import { describe, expect, it } from 'vitest';
import { FieldSchema } from '@objectstack/spec/data';

import { FIELD_EMBEDDED_SUB_FIELDS, lintDataModel } from './data-model-rules.js';
import { explainRule } from './rule-explanations.js';

const RULE = 'field/embedded-sub-fields';

/** One object carrying `checklist` as `def`, in the record shape authors write. */
const audit = (def: Record<string, unknown>) => [
  { name: 'supplier_audit', fields: { name: { type: 'text' }, checklist: def } },
];
const findings = (objects: unknown[]) => lintDataModel(objects as any[]).filter((i) => i.rule === RULE);

const SUB_ROWS = [{ name: 'item', label: 'Item', type: 'text' }];

describe('field/embedded-sub-fields — refuses a typed list on an embedded-JSON field', () => {
  for (const type of ['repeater', 'composite'] as const) {
    for (const [key, value] of [['fields', SUB_ROWS], ['subFields', SUB_ROWS], ['columns', ['item', 'score']]] as const) {
      it(`${type} + \`${key}\` is an error at that key`, () => {
        const [issue, ...rest] = findings(audit({ type, [key]: value }));
        expect(rest).toEqual([]);
        expect(issue).toMatchObject({
          severity: 'error',
          rule: RULE,
          path: `objects[0].fields.checklist.${key}`,
        });
      });
    }
  }

  it('the array field shape is judged the same as the record shape', () => {
    const objects = [{ name: 'supplier_audit', fields: [{ name: 'checklist', type: 'repeater', fields: SUB_ROWS }] }];
    expect(findings(objects)).toHaveLength(1);
  });

  it('several keys on one field are one finding naming every key, located at the first', () => {
    const [issue, ...rest] = findings(audit({ type: 'repeater', fields: SUB_ROWS, columns: ['item'] }));
    expect(rest).toEqual([]);
    expect(issue!.path).toBe('objects[0].fields.checklist.fields');
    expect(issue!.message).toContain('`fields`, `columns`');
  });
});

describe('field/embedded-sub-fields — stays silent outside its scope', () => {
  it('a bare composite / repeater is untyped JSON, not an error', () => {
    expect(findings(audit({ type: 'repeater' }))).toEqual([]);
    expect(findings(audit({ type: 'composite' }))).toEqual([]);
  });

  it('other field types are not judged here, whatever they carry', () => {
    expect(findings(audit({ type: 'json', fields: SUB_ROWS }))).toEqual([]);
    expect(findings(audit({ type: 'record', fields: SUB_ROWS }))).toEqual([]);
    expect(findings(audit({ type: 'lookup', reference: 'account', columns: ['name'] }))).toEqual([]);
  });

  it('a key that merely shares a name with an inherited property is not authored', () => {
    const inherited = Object.create({ fields: SUB_ROWS }) as Record<string, unknown>;
    inherited.type = 'repeater';
    expect(findings(audit(inherited))).toEqual([]);
  });
});

describe('field/embedded-sub-fields — the parsed doors refuse first, with the same route', () => {
  it('the strict field schema refuses each key by name and names `master_detail`', () => {
    for (const key of ['fields', 'subFields', 'columns']) {
      const r = FieldSchema.safeParse({ name: 'checklist', type: 'repeater', [key]: SUB_ROWS });
      expect(r.success, key).toBe(false);
      if (r.success) continue;
      const issue = r.error.issues.find((i) => i.code === 'unrecognized_keys');
      expect(issue, key).toBeTruthy();
      expect(issue!.message, key).toContain('`master_detail`');
    }
  });
});

describe('field/embedded-sub-fields — one-line verdict, `os explain` carries the rest', () => {
  it('the published constant spells the id the findings carry', () => {
    expect(FIELD_EMBEDDED_SUB_FIELDS).toBe(RULE);
  });

  it('the verdict names the type, the field and the keys, on one line of at most 200 characters', () => {
    const [issue] = findings(audit({ type: 'repeater', fields: SUB_ROWS }));
    expect(issue!.message).toBe(
      'repeater field "supplier_audit.checklist" declares `fields`, but an object-level repeater is untyped ' +
        'JSON with no sub-fields',
    );
    expect(issue!.message).not.toContain('\n');
    expect(issue!.message.length).toBeLessThanOrEqual(200);
  });

  it('`os explain` carries the route, the exclusions and the reach', () => {
    const entry = explainRule(RULE);
    expect(entry, 'no `os explain field/embedded-sub-fields` entry').toBeDefined();
    const text = entry!.paragraphs.join('\n');
    for (const fact of [
      'untyped JSON',
      'child object',
      '`master_detail`',
      'inline grid',
      'form view',
      'refuses all three keys at the parse',
      'never parse',
    ]) {
      expect(text, fact).toContain(fact);
    }
  });
});
