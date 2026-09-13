// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16390 — a `user` dimension renders the referenced record's display NAME, the
 * same way a `lookup` dimension already does.
 *
 * ## The measured asymmetry
 *
 * ONE dataset over the reporter's object, ONE `POST /api/v1/analytics/dataset/query`
 * — which is `AnalyticsService.queryDataset` one thin route away (`rest-server.ts`
 * dispatches to `svc.queryDataset` and does nothing to the rows):
 *
 * ```
 * dimensions: ['unit']    -> {"unit":"Customer Success", "avg_score":91.5}     a NAME
 * dimensions: ['person']  -> {"person":"7zLYIwpX82If4Bvt…", "avg_score":124.25} an ID
 * ```
 *
 * Both fields carry exactly what the resolution needs, and differ in one word:
 *
 * ```
 * Field.user({ label: 'Person' })          -> { type: 'user',   reference: 'sys_user' }
 * Field.lookup('sys_business_unit', {…})   -> { type: 'lookup', reference: 'sys_business_unit' }
 * ```
 *
 * so the fixture below builds its field map from those BUILDERS rather than from
 * hand-written literals — the premise is then re-measured by the pin on every run
 * instead of being asserted once in a card.
 *
 * ## The class is the unit of the fix, not the one member that was reported
 *
 * `REFERENCE_VALUE_TYPES` (`packages/spec/src/data/field-value.zod.ts`) declares
 * FOUR members — `lookup`, `master_detail`, `user`, `tree` — as one kind: "value
 * points at another record … a record-id string in stored form". This service
 * already treats them as one kind where it annotates measure result types
 * (`measure-result-type.ts` imports that very set), while the label resolver
 * hand-wrote a two-member subset of it. `user` and `tree` were BOTH outside that
 * subset, so both rendered raw ids; fixing only the reported member would re-seed
 * the same defect for the next reporter to find on the other one.
 *
 * The target object is read through spec's `referenceTargetOf`, the declared
 * SINGLE arbiter of "what does this reference field point at" — which also
 * supplies `sys_user` for a `user` field authored WITHOUT `reference`, a shape
 * that reaches production (`packages/objectql/src/query-expression-conformance.test.ts`
 * captures one) and that a `meta.reference &&` test would silently drop.
 *
 * ## Declaring the dimension `type: 'lookup'` is not, and never was, a way out
 *
 * `DatasetDimensionSchema.type` is `['string','number','date','boolean','lookup']` —
 * it has no `user` member at all — and the resolver reads the OBJECT field's type,
 * never the dimension's. Pinned below on both spellings, because it is the reason
 * the fix belongs at the resolution site and not in an author-facing declaration.
 *
 * ## Reverse verification — direction predicted BEFORE running
 *
 * Ordinary direction, no inversion and no count movement: the change ADDS
 * resolutions that were absent and narrows no rule, so restoring the two-member
 * subset must turn RED exactly the cases that depend on a `user` or `tree` axis,
 * and leave GREEN every `lookup`, `master_detail`, `select`, unresolved-id,
 * no-display-field and fail-closed case — `master_detail` was already inside the
 * old subset, so it is a control here, not a casualty. Predicted on that reading:
 * 7 red in this file and 3 in the `dimension-labels` sibling. Measured exactly
 * that (10 red / 33 green over the two files); the run is quoted in the PR body.
 */

import { describe, it, expect } from 'vitest';
import { DatasetSchema } from '@objectstack/spec/ui';
import { Field, referenceTargetOf } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { AnalyticsService } from '../analytics-service.js';
import { pickDisplayField, type FieldMetaLite } from '../dimension-labels.js';

// ── the reporter's object, built from the real builders ─────────────────────

const KPI_RESULT_FIELDS: Record<string, FieldMetaLite> = {
  // The card's two fields, verbatim in shape.
  person: Field.user({ label: 'Person' }),
  unit: Field.lookup('sys_business_unit', { label: 'Business Unit' }),
  // The other two members of the same declared class.
  owner_team: Field.masterDetail('kpi_team', { label: 'Team' }),
  category: { type: 'tree', reference: 'kpi_category', label: 'Category' } as FieldMetaLite,
  // A `user` field authored WITHOUT `reference` — the target is a constant of
  // the type, so this metadata is fully specified, not under-specified.
  reviewer: { type: 'user', label: 'Reviewer' } as FieldMetaLite,
  score: Field.number({ label: 'Score' }),
};

/** `sys_user`'s real primary-title pointer is `nameField: 'name'`. */
const SYS_USER_FIELDS: Record<string, FieldMetaLite> = {
  name: { type: 'text' },
  email: { type: 'text' },
};
const UNIT_FIELDS: Record<string, FieldMetaLite> = { name: { type: 'text' } };
const TEAM_FIELDS: Record<string, FieldMetaLite> = { name: { type: 'text' } };
const CATEGORY_FIELDS: Record<string, FieldMetaLite> = { name: { type: 'text' } };

const FIELD_MAPS: Record<string, Record<string, FieldMetaLite>> = {
  kpi_result: KPI_RESULT_FIELDS,
  sys_user: SYS_USER_FIELDS,
  sys_business_unit: UNIT_FIELDS,
  kpi_team: TEAM_FIELDS,
  kpi_category: CATEGORY_FIELDS,
};

/** id -> display name, per referenced object. `usr_orphan` is deliberately absent. */
const NAMES: Record<string, Record<string, string>> = {
  sys_user: { usr_ada: 'Ada Lovelace', usr_bo: 'Bo Chen' },
  sys_business_unit: { bu_cs: 'Customer Success', bu_east: 'East China' },
  kpi_team: { team_a: 'Team Alpha' },
  kpi_category: { cat_q: 'Quality' },
};

const dataset = DatasetSchema.parse({
  name: 'kpi_scores',
  label: 'KPI Scores',
  object: 'kpi_result',
  dimensions: [
    // `lookup` is the only reference-ish spelling the dimension schema offers,
    // which is what the reporter wrote for BOTH axes.
    { name: 'unit', field: 'unit', type: 'lookup', label: 'Business Unit' },
    { name: 'person', field: 'person', type: 'lookup', label: 'Person' },
    { name: 'owner_team', field: 'owner_team', type: 'lookup' },
    { name: 'category', field: 'category', type: 'lookup' },
    // The same user axis declared `string` — the declaration must not decide.
    { name: 'reviewer', field: 'reviewer', type: 'string' },
  ],
  measures: [{ name: 'avg_score', aggregate: 'avg', field: 'score' }],
});

/** Rows the base aggregate returns, keyed by dimension name (raw stored ids). */
const BASE_ROWS: Record<string, Record<string, unknown>[]> = {
  'unit,person': [
    { unit: 'bu_cs', person: 'usr_ada', avg_score: 91.5 },
    { unit: 'bu_east', person: 'usr_bo', avg_score: 106.12 },
  ],
  person: [
    { person: 'usr_ada', avg_score: 124.25 },
    { person: 'usr_bo', avg_score: 128.6 },
  ],
  owner_team: [{ owner_team: 'team_a', avg_score: 70 }],
  category: [{ category: 'cat_q', avg_score: 80 }],
  reviewer: [{ reviewer: 'usr_ada', avg_score: 60 }],
};

interface Wiring {
  /** Referenced objects whose rows are visible; default: all of them. */
  names?: Record<string, Record<string, string>>;
  /** Field maps override — e.g. a `sys_user` with no display field. */
  fieldMaps?: Record<string, Record<string, FieldMetaLite>>;
  getReadScope?: (objectName: string, context?: ExecutionContext) => unknown;
  onFetch?: (targetObject: string, ids: unknown[], scope: unknown) => void;
}

function service(w: Wiring = {}) {
  const fieldMaps = w.fieldMaps ?? FIELD_MAPS;
  const names = w.names ?? NAMES;
  return new AnalyticsService({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (_object: string, { groupBy }: { groupBy?: string[] }) => {
      const key = (groupBy ?? []).join(',');
      return BASE_ROWS[key] ?? [];
    },
    ...(w.getReadScope ? { getReadScope: w.getReadScope as never } : {}),
    labelResolver: {
      getObjectFields: (objectName) => fieldMaps[objectName],
      // Mirrors the plugin bridge: pick the target's display field, then read
      // `id -> that field` for the ids in hand. Absent ids simply do not come
      // back, exactly as an RLS-hidden or orphaned row does not.
      fetchRecordLabels: async (targetObject, ids, scope) => {
        w.onFetch?.(targetObject, ids, scope);
        const map = new Map<unknown, string>();
        if (!pickDisplayField(fieldMaps[targetObject])) return map;
        const table = names[targetObject] ?? {};
        for (const id of ids) if (table[String(id)]) map.set(id, table[String(id)]);
        return map;
      },
    },
  });
}

const query = (svc: AnalyticsService, dimensions: string[]) =>
  svc.queryDataset(dataset, { dimensions, measures: ['avg_score'] });

// ── the premise, re-measured rather than recalled ───────────────────────────

describe('#16390 — the premise: a user field already carries its target', () => {
  it('Field.user() and Field.lookup() differ in one word, and both name a target', () => {
    expect(Field.user({ label: 'Person' })).toMatchObject({ type: 'user', reference: 'sys_user' });
    expect(Field.lookup('sys_business_unit', { label: 'Business Unit' }))
      .toMatchObject({ type: 'lookup', reference: 'sys_business_unit' });
    // The single arbiter answers for every member of the class, and answers for
    // a `user` field that omits `reference` too.
    expect(referenceTargetOf(KPI_RESULT_FIELDS.person)).toBe('sys_user');
    expect(referenceTargetOf(KPI_RESULT_FIELDS.reviewer)).toBe('sys_user');
    expect(referenceTargetOf(KPI_RESULT_FIELDS.unit)).toBe('sys_business_unit');
    expect(referenceTargetOf(KPI_RESULT_FIELDS.owner_team)).toBe('kpi_team');
    expect(referenceTargetOf(KPI_RESULT_FIELDS.category)).toBe('kpi_category');
    // …and refuses the measure column, so nothing non-referential is swept in.
    expect(referenceTargetOf(KPI_RESULT_FIELDS.score)).toBeUndefined();
  });

  it("resolves sys_user through its nameField ('name'), the same convention a lookup target uses", () => {
    expect(pickDisplayField(SYS_USER_FIELDS)).toBe('name');
  });
});

// ── the pin that matters: ONE query, BOTH axes ──────────────────────────────

describe('#16390 — one dataset query, a lookup dimension and a user dimension', () => {
  it('renders a display name for BOTH axes', async () => {
    const res = await query(service(), ['unit', 'person']);
    expect(res.rows).toEqual([
      { unit: 'Customer Success', person: 'Ada Lovelace', avg_score: 91.5 },
      { unit: 'East China', person: 'Bo Chen', avg_score: 106.12 },
    ]);
  });

  it('resolves the user axis on its own, too (the reporter\'s second query)', async () => {
    const res = await query(service(), ['person']);
    expect(res.rows).toEqual([
      { person: 'Ada Lovelace', avg_score: 124.25 },
      { person: 'Bo Chen', avg_score: 128.6 },
    ]);
  });

  it('reads the OBJECT field type, not the dimension declaration — a `string`-declared user axis resolves identically', async () => {
    const res = await query(service(), ['reviewer']);
    expect(res.rows).toEqual([{ reviewer: 'Ada Lovelace', avg_score: 60 }]);
  });

  it('covers the whole declared reference class: master_detail and tree resolve as well', async () => {
    const md = await query(service(), ['owner_team']);
    expect(md.rows).toEqual([{ owner_team: 'Team Alpha', avg_score: 70 }]);
    const tree = await query(service(), ['category']);
    expect(tree.rows).toEqual([{ category: 'Quality', avg_score: 80 }]);
  });

  it('asks for the REFERENCED object, never the base object', async () => {
    const targets: string[] = [];
    await query(service({ onFetch: (t) => targets.push(t) }), ['unit', 'person']);
    expect(new Set(targets)).toEqual(new Set(['sys_business_unit', 'sys_user']));
  });
});

// ── the read scope (#3602) reaches the new members too ──────────────────────

describe('#16390 — the label read stays scoped for every member of the class', () => {
  it('resolves and forwards the referenced object read scope for a user dimension', async () => {
    const asked: string[] = [];
    const seen: Array<{ target: string; scope: unknown }> = [];
    await query(
      service({
        getReadScope: (objectName) => {
          asked.push(objectName);
          return objectName === 'sys_user' ? { organization_id: 'org_A' } : undefined;
        },
        onFetch: (target, _ids, scope) => seen.push({ target, scope }),
      }),
      ['person'],
    );
    // Reading a user id into a name IS a read of `sys_user`; it must carry that
    // object's own RLS, exactly as a lookup target's label read does.
    expect(asked).toContain('sys_user');
    expect(seen).toContainEqual({ target: 'sys_user', scope: { organization_id: 'org_A' } });
  });

  it('fails CLOSED for a user dimension: an unresolvable scope leaves the raw id, and fetches nothing', async () => {
    let fetched = false;
    const res = await query(
      service({
        getReadScope: (objectName) => {
          // The base object stays resolvable — only the label target fails, so
          // the query itself must still answer.
          if (objectName === 'sys_user') throw new Error('security service unavailable');
          return undefined;
        },
        onFetch: () => { fetched = true; },
      }),
      ['person'],
    );
    expect(fetched).toBe(false);
    expect(res.rows).toEqual([
      { person: 'usr_ada', avg_score: 124.25 },
      { person: 'usr_bo', avg_score: 128.6 },
    ]);
  });
});

// ── C4 negative controls: degrade to the id, never to an error or a blank ───

describe('#16390 — an unresolvable user renders as itself, not as an error', () => {
  it('leaves an orphaned / RLS-hidden user id untouched, and still answers the query', async () => {
    const res = await query(service({ names: { ...NAMES, sys_user: { usr_ada: 'Ada Lovelace' } } }), ['person']);
    expect(res.rows).toEqual([
      { person: 'Ada Lovelace', avg_score: 124.25 },
      { person: 'usr_bo', avg_score: 128.6 }, // raw id survives — no blank, no throw
    ]);
  });

  it('leaves every id raw when sys_user carries no display field at all', async () => {
    const res = await query(
      service({ fieldMaps: { ...FIELD_MAPS, sys_user: { created_at: { type: 'date' } } } }),
      ['person'],
    );
    expect(res.rows).toEqual([
      { person: 'usr_ada', avg_score: 124.25 },
      { person: 'usr_bo', avg_score: 128.6 },
    ]);
  });

  it('leaves the id raw when the user object is unknown to the engine', async () => {
    const withoutUser = { ...FIELD_MAPS };
    delete (withoutUser as Record<string, unknown>).sys_user;
    const res = await query(service({ fieldMaps: withoutUser }), ['person']);
    expect(res.rows).toEqual([
      { person: 'usr_ada', avg_score: 124.25 },
      { person: 'usr_bo', avg_score: 128.6 },
    ]);
  });
});
