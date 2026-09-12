// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Pins the per-branch JSON-Schema projection (#16431 option (a)) — the third
// attempt `build-schemas.ts` makes after `z.toJSONSchema()` has refused a whole
// export in both `io` directions.
//
// The defect it exists for: `orderingComparandSchema` is
// `z.union([z.number(), z.date(), z.string(), FieldReferenceSchema])`, Zod
// refuses the WHOLE schema over the one member with no JSON form, and so
// `$gt` / `$gte` / `$lt` / `$lte` / `$between` — ~2000 characters of `.describe()`
// carrying the #5685 comparand contract and the #6571 endpoint contract —
// reached no reference row at all. Not a blank cell: no section.
//
// Two directions have to be pinned, and the second is the one that matters:
//
//   1. a union branch with no JSON form is DROPPED, so the export publishes;
//   2. an unprojectable node anywhere ELSE still refuses the projection, so the
//      export is skipped exactly as before. The mechanism is Zod's
//      `unrepresentable: 'any'`, which turns every unrepresentable node into
//      `{}` — and `{}` inside an `anyOf` accepts EVERY JSON value. A regression
//      that let one of those through would publish a universally-permissive
//      schema and report nothing, which is a worse version of the silence this
//      card was filed about.

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import {
  UNPROJECTABLE_MARK,
  findSurvivingMark,
  markUnprojectableNodes,
  projectByPruningUnionBranches,
  pruneMarkedUnionBranches,
  type PrunedBranch,
} from './lib/union-branch-projection';
import {
  ComparisonOperatorSchema,
  FieldOperatorsSchema,
  NormalizedFilterSchema,
  PersistenceAdapterSchema,
  RangeOperatorSchema,
} from '../src/data';
import { FlowFunctionEntrySchema } from '../src/automation';

const TARGET = { target: 'draft-2020-12' } as const;

/** Convert with the marker override, the way the projection itself does. */
function markedProjection(schema: z.ZodType, io: 'output' | 'input' = 'output'): Record<string, unknown> {
  return z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    unrepresentable: 'any',
    override: markUnprojectableNodes(io),
    ...(io === 'input' ? { io } : {}),
  }) as Record<string, unknown>;
}

/** Every value at `key`, anywhere in a JSON tree. */
function collect(node: unknown, key: string, into: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const item of node) collect(item, key, into);
    return into;
  }
  if (typeof node !== 'object' || node === null) return into;
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (k === key) into.push(v);
    collect(v, key, into);
  }
  return into;
}

describe('markUnprojectableNodes — what counts as "no JSON form"', () => {
  it('marks a bare z.date(), in BOTH io directions', () => {
    // The premise #16431 recorded — that the existing `io: 'input'` fallback
    // would project a date branch if applied per branch — is false, and this is
    // why: `dateProcessor` reads only `ctx.unrepresentable`, never `ctx.io`.
    for (const io of ['output', 'input'] as const) {
      expect(markedProjection(z.date(), io)[UNPROJECTABLE_MARK]).toBe('date');
      expect(() => z.toJSONSchema(z.date(), { ...TARGET, io })).toThrow(
        /Date cannot be represented in JSON Schema/,
      );
    }
  });

  it('marks a described z.date(), which an emptiness test alone would miss', () => {
    // `.describe()` lands on the node BEFORE the override runs, so this comes
    // back as `{ description }` — non-empty, and indistinguishable from a real
    // schema to `Object.keys().length === 0`.
    const marked = markedProjection(z.date().describe('a real Date instance'));
    expect(marked).toMatchObject({ description: 'a real Date instance', [UNPROJECTABLE_MARK]: 'date' });
  });

  it('does NOT mark z.any() / z.unknown(), which accept any JSON value legitimately', () => {
    expect(markedProjection(z.any())).not.toHaveProperty(UNPROJECTABLE_MARK);
    expect(markedProjection(z.unknown())).not.toHaveProperty(UNPROJECTABLE_MARK);
  });

  it('does NOT mark z.any() through wrappers — the `$eq` shape', () => {
    // `FieldOperators.$eq` is `z.any().optional().describe(EQ_DESCRIPTION)`. It
    // projects to `{ description }`, byte-shaped exactly like the unprojectable
    // date above, and marking it refused the whole projection for the ENFORCED
    // half of the filter contract. Only a strict re-conversion tells them apart.
    const eqShape = z.any().optional().describe('Equal to — the DEFAULT operator');
    expect(markedProjection(z.object({ $eq: eqShape })).properties).toMatchObject({
      $eq: { description: 'Equal to — the DEFAULT operator' },
    });
    expect(findSurvivingMark(markedProjection(z.object({ $eq: eqShape })))).toBeNull();
  });
});

describe('pruneMarkedUnionBranches — only a union member is droppable', () => {
  it('drops the marked branch and names where it was', () => {
    const schema = markedProjection(z.object({ $gt: z.union([z.number(), z.date(), z.string()]) }));
    const pruned: PrunedBranch[] = [];
    pruneMarkedUnionBranches(schema, '#', pruned);

    expect(pruned).toEqual([{ at: '#/properties/$gt/anyOf/1', type: 'date' }]);
    expect(findSurvivingMark(schema)).toBeNull();
    expect((schema.properties as Record<string, { anyOf: Array<{ type: string }> }>).$gt.anyOf)
      .toEqual([{ type: 'number' }, { type: 'string' }]);
  });

  it('marks a union that loses EVERY branch, so the parent can drop it in turn', () => {
    const schema = markedProjection(z.union([z.date(), z.function()]));
    pruneMarkedUnionBranches(schema, '#', []);
    expect(schema).not.toHaveProperty('anyOf');
    expect(schema[UNPROJECTABLE_MARK]).toBe('union');
  });

  it('leaves a marked node in a PROPERTY position for the caller to refuse', () => {
    const schema = markedProjection(z.object({ handler: z.function(), name: z.string() }));
    pruneMarkedUnionBranches(schema, '#', []);
    expect(findSurvivingMark(schema)).toBe('#/properties/handler');
  });
});

describe('projectByPruningUnionBranches — the contract build-schemas.ts relies on', () => {
  it('projects the ordering comparand union without its Date branch', () => {
    const projected = projectByPruningUnionBranches(
      z.object({ $gt: z.union([z.number(), z.date(), z.string()]).optional() }),
      TARGET,
    );
    expect(projected).not.toBeNull();
    expect(projected!.pruned).toEqual([{ at: '#/properties/$gt/anyOf/1', type: 'date' }]);
    // What an author writes still validates: a JSON document can carry the
    // string and the number, and can never carry a Date instance, so the set of
    // valid JSON documents is unchanged by the drop.
    expect((projected!.schema.properties as Record<string, { anyOf: unknown[] }>).$gt.anyOf)
      .toEqual([{ type: 'number' }, { type: 'string' }]);
  });

  it('refuses when an unprojectable node is NOT a union member', () => {
    // Dropping a required `handler` would publish a shape no runtime value has.
    expect(projectByPruningUnionBranches(z.object({ handler: z.function() }), TARGET)).toBeNull();
    expect(projectByPruningUnionBranches(z.record(z.string(), z.function()), TARGET)).toBeNull();
    expect(projectByPruningUnionBranches(z.array(z.date()), TARGET)).toBeNull();
  });

  it('refuses a union whose every branch is unprojectable', () => {
    expect(projectByPruningUnionBranches(z.union([z.date(), z.function()]), TARGET)).toBeNull();
  });

  it('refuses a marked node NESTED inside a SURVIVING union branch', () => {
    // The discriminating case, and the one the suite was missing. Every other
    // "refuses outside a union" pin here returns null through the
    // `pruned.length === 0` early-out instead of through the surviving-mark
    // guard — measured: `z.object({ handler })`, `z.record`, `z.array(z.date())`
    // and `PersistenceAdapterSchema` all prune ZERO branches, because none of
    // them contains a union at all. So a guard weakened to refuse only at the
    // ROOT (`findSurvivingMark(schema) === '#'`) keeps all of them green, and
    // `refuses a union whose every branch is unprojectable` above keeps passing
    // too because its mark IS at the root. This shape is the one that tells the
    // strong guard from the weak one: a branch really is dropped, and the mark
    // that survives sits BELOW the root.
    const nested = z.union([
      z.function(),
      z.object({ handler: z.function(), name: z.string() }),
      z.string(),
    ]);

    // Non-vacuity, asserted rather than asserted about. Both halves are what
    // make the refusal below attributable to the guard and to nothing else:
    // pruning happened (so the early-out cannot fire), and the surviving mark
    // is not `'#'` (so a root-only guard would tolerate it).
    for (const io of ['output', 'input'] as const) {
      const marked = markedProjection(nested, io);
      const pruned: PrunedBranch[] = [];
      pruneMarkedUnionBranches(marked, '#', pruned);
      expect(pruned).toEqual([{ at: '#/anyOf/0', type: 'function' }]);
      expect(findSurvivingMark(marked)).toBe('#/anyOf/0/properties/handler');
    }

    expect(projectByPruningUnionBranches(nested, TARGET)).toBeNull();
  });

  it('leaves Automation.FlowFunctionEntrySchema skipped, marker and all', () => {
    // The shape above is not hypothetical: `FlowFunctionEntrySchema` is
    // `z.union([z.function(), FlowFunctionDeclarationSchema, z.string().min(1),
    // FlowFunctionLoweredDeclarationSchema])`, and the declaration's required
    // `handler` is itself a live callable. Its `unemitted-schemas.baseline.json`
    // entry states exactly that: "1 branch pruned … the union still does not
    // publish, because the member behind it is FlowFunctionDeclarationSchema,
    // whose required `handler` is itself a live callable".
    //
    // What the guard is holding back is therefore a real artifact, not a
    // category: the pruned-but-unrefused projection still CARRIES the marker,
    // so emitting it would publish `x-os-unprojectable` into json-schema/ —
    // beside a `required: ["handler", …]` naming a property that annotates and
    // constrains nothing.
    for (const io of ['output', 'input'] as const) {
      const marked = markedProjection(FlowFunctionEntrySchema as z.ZodType, io);
      const pruned: PrunedBranch[] = [];
      pruneMarkedUnionBranches(marked, '#', pruned);
      expect(pruned).toHaveLength(1);
      expect(findSurvivingMark(marked)).toBe('#/anyOf/0/properties/handler');
      expect(JSON.stringify(marked)).toContain(UNPROJECTABLE_MARK);
    }

    expect(projectByPruningUnionBranches(FlowFunctionEntrySchema as z.ZodType, TARGET)).toBeNull();
  });

  it('returns null when there was nothing to drop', () => {
    expect(projectByPruningUnionBranches(z.object({ a: z.string() }), TARGET)).toBeNull();
  });

  it('prefers the direction that drops FEWER branches, not output-first', () => {
    // A `.transform()` has no OUTPUT form and a perfectly good input one. An
    // output-first rule would drop it as if it had no JSON form at all and
    // publish the narrower schema — deleting an authorable shape silently.
    const withTransform = z.union([
      z.date(),
      z.string().transform((s) => s.length),
      z.number(),
    ]);
    const projected = projectByPruningUnionBranches(withTransform, TARGET);
    expect(projected).not.toBeNull();
    expect(projected!.io).toBe('input');
    expect(projected!.pruned.map((b) => b.type)).toEqual(['date']);
    expect(projected!.schema.anyOf).toEqual([{ type: 'string' }, { type: 'number' }]);
  });

  it('never returns a schema still carrying a marker, and never an empty `{}` branch', () => {
    const projected = projectByPruningUnionBranches(ComparisonOperatorSchema, TARGET);
    expect(projected).not.toBeNull();
    expect(findSurvivingMark(projected!.schema)).toBeNull();
    expect(JSON.stringify(projected!.schema)).not.toContain(UNPROJECTABLE_MARK);
    for (const branches of collect(projected!.schema, 'anyOf') as unknown[][]) {
      for (const branch of branches) {
        expect(Object.keys(branch as Record<string, unknown>).length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the four filter exports #16431 measured, and the boundary beside them', () => {
  it.each([
    ['ComparisonOperatorSchema', ComparisonOperatorSchema, 4],
    ['RangeOperatorSchema', RangeOperatorSchema, 2],
    ['FieldOperatorsSchema', FieldOperatorsSchema, 6],
    ['NormalizedFilterSchema', NormalizedFilterSchema, 18],
  ])('%s projects, dropping only Date branches', (_name, schema, dropped) => {
    // Every one of these throws in both strict directions today — that is the
    // whole finding — so the strict pass is asserted first, or the projection
    // could be passing for a reason that has nothing to do with this change.
    for (const io of ['output', 'input'] as const) {
      expect(() => z.toJSONSchema(schema as z.ZodType, { ...TARGET, io })).toThrow(
        /cannot be represented in JSON Schema/,
      );
    }
    const projected = projectByPruningUnionBranches(schema as z.ZodType, TARGET);
    expect(projected).not.toBeNull();
    expect(projected!.pruned).toHaveLength(dropped);
    expect(new Set(projected!.pruned.map((b) => b.type))).toEqual(new Set(['date']));
  });

  it('publishes the five operators the card named, with their prose intact', () => {
    const comparison = projectByPruningUnionBranches(ComparisonOperatorSchema, TARGET)!;
    const range = projectByPruningUnionBranches(RangeOperatorSchema, TARGET)!;
    const slots = comparison.schema.properties as Record<string, { description?: string }>;
    for (const op of ['$gt', '$gte', '$lt', '$lte']) {
      expect(slots[op]?.description).toContain('null is NOT a comparand');
    }
    expect((range.schema.properties as Record<string, { description?: string }>).$between?.description)
      .toContain('$between');
  });

  it('leaves a driver interface of z.function() members skipped', () => {
    // The population the #16431 ratchet holds closed must not be emptied by a
    // projection that publishes shapes nobody authors.
    expect(projectByPruningUnionBranches(PersistenceAdapterSchema, TARGET)).toBeNull();
  });
});
