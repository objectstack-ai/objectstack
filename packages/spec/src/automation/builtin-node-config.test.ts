// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CRUD / `screen` / `map` config contracts — the #4001 批 9 closure (#4045).
 *
 * Live execute-time contracts (`parse-config.ts`), so these assertions are
 * about behaviour, not documentation: an accepted shape runs and a rejected
 * one refuses the node as a guard.
 *
 * Most of the file is about the PROSE. `service-automation`'s registration-time
 * rejection already carried a curated table (`FLOW_NODE_UNKNOWN_KEY_GUIDANCE`),
 * and this campaign's second finding is that a bespoke guard's DETECTION
 * generalizes for free the moment a default flips while its prescriptions do
 * not — so the prose was copied to this door and is pinned here. The two
 * entries that door never had (`recordId`, and `outputVariable` on
 * update/delete) were measured against every flow payload in the repo first.
 */

import { describe, expect, it } from 'vitest';

import {
  CreateRecordConfigSchema,
  DeleteRecordConfigSchema,
  GetRecordConfigSchema,
  MapConfigSchema,
  ScreenConfigSchema,
  ScreenFieldConfigSchema,
  UpdateRecordConfigSchema,
} from './builtin-node-config.zod.js';

interface Parseable { safeParse(v: unknown): { success: boolean; error?: { issues: ReadonlyArray<{ code: string; message: string }> } } }

/** The unknown-key message, or `undefined` when the shape was accepted. */
function unknownKeyMessage(schema: Parseable, value: unknown): string | undefined {
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error!.issues.find((i) => i.code === 'unrecognized_keys')?.message;
}

describe('CRUD config contracts — strict as of #4001 批 9', () => {
  it('accepts every declared key on each of the four', () => {
    expect(GetRecordConfigSchema.parse({
      objectName: 'lead', filter: { status: 'new' }, fields: ['id'], limit: 5, outputVariable: 'leads',
    })).toEqual({ objectName: 'lead', filter: { status: 'new' }, fields: ['id'], limit: 5, outputVariable: 'leads' });
    expect(CreateRecordConfigSchema.parse({ objectName: 'task', fields: { subject: 'hi' }, outputVariable: 'task' }).objectName).toBe('task');
    expect(UpdateRecordConfigSchema.parse({ objectName: 'lead', filter: { id: '1' }, fields: { status: 'won' } }).objectName).toBe('lead');
    expect(DeleteRecordConfigSchema.parse({ objectName: 'lead', filter: { status: 'stale' } }).objectName).toBe('lead');
  });

  it.each([
    ['get_record', GetRecordConfigSchema, { objectName: 'lead' }],
    ['create_record', CreateRecordConfigSchema, { objectName: 'task' }],
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead' }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead' }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: prescribes `objectName` for the retired `object` spelling — which edit distance cannot reach',
    (nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, object: 'lead' })!;
      expect(message).toContain(`this ${nodeType} node config`);
      expect(message).toContain('`objectName`');
      expect(message).toContain('flow-node-crud-object-alias');
      // The distance claim in the schema's comment, pinned: without the
      // curated entry this key would get NO suggestion at all.
      expect(message).not.toContain('`object` → ');
    },
  );

  it.each([
    ['get_record', GetRecordConfigSchema, { objectName: 'lead' }],
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead' }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead' }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: prescribes `filter` for the retired `filters` spelling, and names the #3810 hazard',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, filters: { status: 'stale' } })!;
      expect(message).toContain('flow-node-crud-filter-alias');
      expect(message).toContain('#3810');
    },
  );

  it('create_record does NOT prescribe `filter` — it has no match map to point at', () => {
    // Finding 12 generalized: never point an author at a key this shape does
    // not declare. `create_record` is outside `flow-node-crud-filter-alias`'s
    // node-type set precisely because it has no filter.
    const message = unknownKeyMessage(CreateRecordConfigSchema, { objectName: 'task', filters: {} })!;
    expect(message).not.toContain('flow-node-crud-filter-alias');
    expect(message).not.toContain('`filter` (singular)');
  });

  it.each([
    ['create_record', CreateRecordConfigSchema, { objectName: 'task' }],
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead' }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: `fieldValues` gets the #2419 prescription, not a runtime alias',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, fieldValues: { subject: 'hi' } })!;
      expect(message).toContain('#2419');
      expect(message).toContain('`fields`');
    },
  );

  it.each([
    ['get_record', GetRecordConfigSchema, { objectName: 'lead' }],
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead' }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead' }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: `recordId` — the shape the repo\'s own fixtures teach and no executor reads',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, recordId: '{record.id}' })!;
      expect(message).toContain('`filter`');
      expect(message).toContain('#3810');
    },
  );

  it.each([
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead', filter: { id: '1' } }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead', filter: { id: '1' } }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: `outputVariable` is a DOCUMENTED absence, so the rejection says so rather than staying silent',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, outputVariable: 'updated' })!;
      expect(message).toContain('#4045');
      expect(message).toContain('get_record');
    },
  );

  it('the siblings that DO bind an output still accept it', () => {
    expect(GetRecordConfigSchema.safeParse({ objectName: 'lead', outputVariable: 'lead' }).success).toBe(true);
    expect(CreateRecordConfigSchema.safeParse({ objectName: 'task', outputVariable: 'task' }).success).toBe(true);
  });
});

describe('ScreenConfigSchema / ScreenFieldConfigSchema — strict as of #4001 批 9', () => {
  it('accepts the flat and object-form shapes in full', () => {
    expect(ScreenConfigSchema.safeParse({
      title: 'Details', description: 'Fill this in', waitForInput: true,
      fields: [{ name: 'amount', label: 'Amount', type: 'number', required: true, defaultValue: 0, placeholder: '0.00', visibleWhen: "type == 'x'" }],
    }).success).toBe(true);
    expect(ScreenConfigSchema.safeParse({
      objectName: 'showcase_task', mode: 'edit', recordId: '{record.id}', idVariable: 'savedId', defaults: { status: 'open' },
    }).success).toBe(true);
  });

  it('rejects an undeclared key on the screen and on a field item', () => {
    expect(unknownKeyMessage(ScreenConfigSchema, { title: 'x', heading: 'y' }))
      .toContain('this screen node config');
    expect(unknownKeyMessage(ScreenFieldConfigSchema, { name: 'amount', hint: 'x' }))
      .toContain('this screen field');
  });

  it('`visibleIf` on a field carries the #3528 prescription — the typo the whole ladder descends from', () => {
    const message = unknownKeyMessage(ScreenFieldConfigSchema, { name: 'amount', visibleIf: "type == 'x'" })!;
    expect(message).toContain('`visibleWhen`');
    expect(message).toContain('#3528');
  });

  it('`object` on a screen names `objectName`, which no other layer would tell the author', () => {
    // `screen` is NOT in `flow-node-crud-object-alias`'s node-type set, so
    // nothing rewrites it at load, and four edits is past the suggester's
    // threshold. The alias entry is the only channel that carries it.
    expect(unknownKeyMessage(ScreenConfigSchema, { object: 'showcase_task' }))
      .toContain('`object` → `objectName`');
  });

  it('closes the select-option item too — the eighth site', () => {
    expect(ScreenFieldConfigSchema.safeParse({
      name: 'stage', options: [{ value: 'won', label: 'Won' }],
    }).success).toBe(true);
    const message = unknownKeyMessage(ScreenFieldConfigSchema, {
      name: 'stage', options: [{ value: 'won', label: 'Won', disabled: true }],
    });
    expect(message).toContain('this screen field option');
    expect(message).toContain('`disabled`');
  });
});

describe('MapConfigSchema — strict as of #4001 批 9', () => {
  it('accepts every declared key', () => {
    expect(MapConfigSchema.parse({
      collection: '{tasks}', flowName: 'one_task_signoff', iteratorVariable: 'item',
      indexVariable: 'i', itemObject: 'showcase_task', input: { id: '{item.id}' }, outputVariable: 'results',
    }).flowName).toBe('one_task_signoff');
  });

  it('prescribes `flowName` for the undeclared `flow` fallback', () => {
    const message = unknownKeyMessage(MapConfigSchema, { collection: '{tasks}', flowName: 'per_row', flow: 'ignored' })!;
    expect(message).toContain('this map node config');
    expect(message).toContain('flow-node-map-flow-alias');
    expect(message).toMatch(/delete/i);
  });

  it('rejects the SHADOWED alias the ADR-0087 conversion deliberately leaves behind', () => {
    // `renameConfigKey` does nothing when the canonical key is already
    // present, so `{ flowName, flow }` survives the load-path conversion
    // intact — and under `.strip` the dead twin was then deleted in silence at
    // this parse. That silence is the whole point of #4001: the author wrote
    // two names for one thing and the platform picked one without saying so.
    expect(MapConfigSchema.safeParse({ collection: '{r}', flowName: 'per_row', flow: 'ignored' }).success).toBe(false);
  });
});
