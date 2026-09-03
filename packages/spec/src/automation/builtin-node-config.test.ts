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
import { z } from 'zod';

import {
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
  AssignmentConfigSchema,
  AssignmentExpressionValueSchema,
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
      expect(message).toContain('match-everything write');
      expect(message, 'the prescription names the hazard, never a tracker id').not.toMatch(/#\d{3,5}/);
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
    '%s: `fieldValues` gets the rejected-alias prescription, not a runtime alias',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, fieldValues: { subject: 'hi' } })!;
      expect(message).toContain('never had a runtime reader');
      expect(message).toContain('`fields`');
      expect(message, 'the prescription names the write map, never a tracker id').not.toMatch(/#\d{3,5}/);
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
      expect(message).toContain('match-everything delete');
      expect(message, 'the prescription names the hazard, never a tracker id').not.toMatch(/#\d{3,5}/);
    },
  );

  it.each([
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead', filter: { id: '1' } }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead', filter: { id: '1' } }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: `outputVariable` is a DOCUMENTED absence, so the rejection says so rather than staying silent',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, outputVariable: 'updated' })!;
      expect(message).toContain('binds no output');
      expect(message).toContain('get_record');
    },
  );

  it('the siblings that DO bind an output still accept it', () => {
    expect(GetRecordConfigSchema.safeParse({ objectName: 'lead', outputVariable: 'lead' }).success).toBe(true);
    expect(CreateRecordConfigSchema.safeParse({ objectName: 'task', outputVariable: 'task' }).success).toBe(true);
  });

  // ── bulk intent (#5393) ────────────────────────────────────────────

  it.each([
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead', filter: { stage: 'stale' }, fields: { stage: 'archived' } }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead', filter: { stage: 'stale' } }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: `multi` is authorable — the declaration a predicate write needs to be reachable at all',
    (_nodeType, schema, base) => {
      expect(schema.safeParse({ ...base, multi: true }).success).toBe(true);
      expect(schema.safeParse({ ...base, multi: false }).success).toBe(true);
      // Absent is the default and still valid: the engine then refuses a
      // predicate write, which is the contract this key makes declarable.
      expect(schema.safeParse(base).success).toBe(true);
      // Typed, so `multi: 'yes'` is a guard, not a truthy surprise.
      expect(schema.safeParse({ ...base, multi: 'yes' }).success).toBe(false);
    },
  );

  it.each([
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead' }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead' }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: the measured wrong spellings of bulk intent get named, not a bare "unknown key"',
    (_nodeType, schema, base) => {
      for (const key of ['bulk', 'all', 'multiple']) {
        const message = unknownKeyMessage(schema, { ...base, [key]: true })!;
        expect(message, key).toContain('`multi: true`');
        expect(message, key).toContain('NO spelling of');
        expect(message, key).not.toMatch(/#\d{3,5}/);
        // The distance claim, pinned: none of these reaches `multi`, so
        // without the curated entry the rejection would offer nothing.
        expect(message, key).not.toContain(`\`${key}\` → `);
      }
    },
  );

  it.each([
    ['update_record', UpdateRecordConfigSchema, { objectName: 'lead' }],
    ['delete_record', DeleteRecordConfigSchema, { objectName: 'lead' }],
  ] as ReadonlyArray<[string, Parseable, Record<string, unknown>]>)(
    '%s: `options: { multi: true }` is answered as a wrong LAYER, not a typo',
    (_nodeType, schema, base) => {
      const message = unknownKeyMessage(schema, { ...base, options: { multi: true } })!;
      expect(message).toContain('NODE config');
      expect(message).toContain('executor');
    },
  );

  it('the read-only and single-row siblings do NOT declare `multi`', () => {
    // `get_record` bounds rows with `limit`; `create_record` writes one row.
    // Neither dispatches on bulk intent, so the key would be inert there —
    // the #3528 shape (a declared key nothing reads).
    expect(GetRecordConfigSchema.safeParse({ objectName: 'lead', multi: true }).success).toBe(false);
    expect(CreateRecordConfigSchema.safeParse({ objectName: 'task', multi: true }).success).toBe(false);
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

  it('`visibleIf` on a field carries its prescription — the typo the whole ladder descends from', () => {
    const message = unknownKeyMessage(ScreenFieldConfigSchema, { name: 'amount', visibleIf: "type == 'x'" })!;
    expect(message).toContain('`visibleWhen`');
    expect(message).toContain('the whole undeclared-key ladder descends from');
    expect(message, 'the prescription names the right key, never a tracker id').not.toMatch(/#\d{3,5}/);
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

  it('rejects the AMBIGUOUS pair the ADR-0087 conversion deliberately leaves behind', () => {
    // Since #4923 `renameConfigKey` resolves `{ flowName, flow }` itself when
    // the two agree, so the pair that survives the load-path conversion to
    // reach this parse is the one naming two DIFFERENT flows. Under `.strip`
    // the loser was then deleted in silence — the whole point of #4001: the
    // author wrote two names for one thing and the platform picked one without
    // saying so. This is the case where picking would be a guess, so the
    // refusal names both keys instead.
    expect(MapConfigSchema.safeParse({ collection: '{r}', flowName: 'per_row', flow: 'per_row_v2' }).success)
      .toBe(false);
    const message = unknownKeyMessage(MapConfigSchema, { collection: '{r}', flowName: 'per_row', flow: 'per_row_v2' })!;
    expect(message).toContain('`flow`');
    expect(message).toContain('`flowName`');
  });
});

// ─── assignment (#14149) ─────────────────────────────────────────────

describe('assignment value contract — a CEL envelope beside `{token}` interpolation (#14149)', () => {
  const DIGEST_SOURCE = 'joinNonEmpty(overdue_tasks.map(t, t.subject), "\\n")';
  const DIGEST_ENVELOPE = { dialect: 'cel', source: DIGEST_SOURCE };

  /** Every `custom` issue at exactly `assignments.<key>` (or beneath it). */
  function envelopeIssues(config: unknown, key: string) {
    const result = AssignmentConfigSchema.safeParse(config);
    if (result.success) return [];
    return result.error!.issues.filter((i) => i.path[0] === 'assignments' && i.path[1] === key);
  }

  it('accepts a CEL value envelope as a variable value — the ruling\'s `joinNonEmpty` example, verbatim', () => {
    const result = AssignmentConfigSchema.safeParse({ assignments: { digest: DIGEST_ENVELOPE } });
    expect(result.success).toBe(true);
    // No transform: the stored shape IS the envelope `validateExpression` and
    // the executor half read, so nothing has to un-normalize it later.
    expect((result.data as { assignments: Record<string, unknown> }).assignments.digest).toEqual(DIGEST_ENVELOPE);
    expect(AssignmentExpressionValueSchema.safeParse(DIGEST_ENVELOPE).success).toBe(true);
  });

  it('accepts the two forms side by side in one node', () => {
    expect(AssignmentConfigSchema.safeParse({
      assignments: { owner_name: '{manager.name}', digest: DIGEST_ENVELOPE },
    }).success).toBe(true);
  });

  it('PRESERVATION: every value that parsed before still parses — strings, scalars, arrays, plain objects', () => {
    expect(AssignmentConfigSchema.safeParse({
      assignments: {
        decision: 'approved',                 // the showcase's own assignment
        owner: '{record.owner}',              // sole-token interpolation
        greeting: 'Hi {record.name}!',        // text with holes
        cel_looking_text: 'a + b',            // a STRING is never CEL here
        n: 3, ok: true, nothing: null,
        list: ['{a}', 2],
        obj: { nested: '{x}', source: 'not an envelope without a dialect' },
        empty: '',
      },
    }).success).toBe(true);
    // An envelope-shaped object with a non-string `dialect` is a literal, as it always was.
    expect(AssignmentConfigSchema.safeParse({ assignments: { weird: { dialect: 1 } } }).success).toBe(true);
    // An empty node is valid (the descriptor declares no `required`).
    expect(AssignmentConfigSchema.safeParse({}).success).toBe(true);
    expect(AssignmentConfigSchema.safeParse({ assignments: {} }).success).toBe(true);
  });

  it('bare legacy keys (no `assignments` wrapper) still parse, untouched — an envelope there is a literal', () => {
    expect(AssignmentConfigSchema.safeParse({ decision: 'approved', digest: { dialect: 'cel' } }).success).toBe(true);
  });

  it.each([
    ['no `source` (and no `ast`)', { dialect: 'cel' }, ['assignments', 'digest'], 'Expression requires at least one of'],
    ['an empty `source`', { dialect: 'cel', source: '' }, ['assignments', 'digest', 'source'], ''],
    ['a non-string `source`', { dialect: 'cel', source: 42 }, ['assignments', 'digest', 'source'], ''],
    ['an unknown dialect', { dialect: 'javascript', source: '1 + 1' }, ['assignments', 'digest', 'dialect'], ''],
  ] as ReadonlyArray<[string, unknown, ReadonlyArray<string>, string]>)(
    'REFUSES a malformed envelope with %s — code `custom`, the value\'s path, the refusal sentence first',
    (_what, envelope, path, detail) => {
      const issues = envelopeIssues({ assignments: { digest: envelope } }, 'digest');
      expect(issues.length).toBeGreaterThan(0);
      const issue = issues.find((i) => i.path.join('.') === path.join('.'))!;
      expect(issue, `an issue at ${path.join('.')}`).toBeDefined();
      expect(issue.code).toBe('custom');
      expect(issue.message.startsWith(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL)).toBe(true);
      if (detail) expect(issue.message).toContain(detail);
    },
  );

  it('REFUSES a `template` / `cron` envelope: only `cel` is evaluated to a value', () => {
    for (const dialect of ['template', 'cron']) {
      const issues = envelopeIssues({ assignments: { body: { dialect, source: 'x' } } }, 'body');
      expect(issues.map((i) => i.path.join('.'))).toEqual(['assignments.body.dialect']);
      expect(issues[0]!.code).toBe('custom');
      expect(issues[0]!.message.startsWith(ASSIGNMENT_VALUE_ENVELOPE_REFUSAL)).toBe(true);
      expect(issues[0]!.message).toContain('only the `cel` dialect');
    }
  });

  it('a malformed envelope is refused wherever it sits in the map — the path names the variable', () => {
    const result = AssignmentConfigSchema.safeParse({
      assignments: { fine: DIGEST_ENVELOPE, broken: { dialect: 'cel' }, alsoFine: '{x}' },
    });
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((i) => i.path.join('.'))).toEqual(['assignments.broken']);
  });

  it('refuses the legacy array form with the map as the prescription', () => {
    const result = AssignmentConfigSchema.safeParse({ assignments: [{ variable: 'digest', value: DIGEST_ENVELOPE }] });
    expect(result.success).toBe(false);
    const issue = result.error!.issues.find((i) => i.code === 'custom' && i.path.join('.') === 'assignments')!;
    expect(issue).toBeDefined();
    expect(issue.message).toContain('`[{ variable, value }]`');
    expect(issue.message).toContain('write the map');
  });

  it('declares the slot to the expression ledger: `xExpression: \'value\'` rides onto the map value', () => {
    // The channel `FLOW_NODE_EXPRESSION_PATHS`'s `assignment` entry
    // (`assignments.*`) is derived from: a ratchet walking the map's
    // `additionalProperties` finds the marker there, the same way it finds
    // `loop.collection`'s `'template'` marker on a property.
    const json = z.toJSONSchema(AssignmentConfigSchema, {
      target: 'draft-2020-12', io: 'input', unrepresentable: 'any',
    }) as { properties?: Record<string, { additionalProperties?: Record<string, unknown> }> };
    expect(json.properties?.assignments?.additionalProperties?.xExpression).toBe('value');
    expect(String(json.properties?.assignments?.additionalProperties?.description)).toContain('joinNonEmpty');
  });
});
