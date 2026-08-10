// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the #7010 predicate PATH-resolution gate.
 *
 * The load-bearing block is `#6254 corpus` at the bottom. Everything above it is
 * unit coverage over a hand-built schema; that block runs the rule over the
 * metadata forms this repo actually SHIPS (`METADATA_FORM_REGISTRY`), which is
 * both the corpus count the widening discipline requires before an `error`-level
 * gate may land, and the reverse verification — restoring #6254's pre-fix
 * `object.form.ts` spellings must turn the count from 0 to 16.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { METADATA_FORM_REGISTRY } from '@objectstack/spec/system';
import { getMetadataTypeSchema } from '@objectstack/spec/kernel';

import {
  validatePredicatePathRefs,
  PREDICATE_PATH_UNRESOLVED,
  PREDICATE_PATH_UNROOTED,
} from './validate-predicate-path-refs.js';
import { AUTHORING_RULES } from './authoring-rules.js';

// ── A miniature target schema, so the traversal is pinned against a shape the
// test fully controls rather than against whatever `FieldSchema` happens to
// declare this month.
const RowSchema = z.object({
  name: z.string(),
  type: z.string(),
  maxLength: z.number().optional(),
});

const DemoSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  enable: z.object({ search: z.boolean().optional() }).optional(),
  rows: z.array(RowSchema).optional(),
  entries: z.record(z.string(), RowSchema).optional(),
  bag: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

const resolveSchema = (schemaId: string) => (schemaId === 'demo' ? DemoSchema : undefined);
const run = (stack: Record<string, unknown>) => validatePredicatePathRefs(stack, { resolveSchema });

/** A `defineForm`-shaped view: the bare FormView with a schema data source. */
const form = (sections: unknown[], schemaId = 'demo') => ({
  views: [{ name: 'demo_form', data: { provider: 'schema', schemaId }, sections }],
});

describe('validatePredicatePathRefs — resolvable paths', () => {
  it('is clean when every `data.` path resolves', () => {
    expect(
      run(form([
        {
          label: 'Basics',
          visibleWhen: "data.type == 'formula'",
          fields: [
            { field: 'name', visibleWhen: "data.type != 'code'" },
            { field: 'x', visibleWhen: 'data.enable.search' },
          ],
        },
      ])),
    ).toEqual([]);
  });

  it('rebinds `data` to the ROW inside a repeater sub-field list (#6254)', () => {
    // `data.maxLength` is NOT a key of DemoSchema; it IS a key of RowSchema.
    // Judging the sub-field against the parent scope would report it.
    expect(
      run(form([
        {
          label: 'Rows',
          fields: [
            {
              field: 'rows',
              type: 'repeater',
              fields: [{ field: 'maxLength', visibleWhen: "data.type == 'text'" }],
            },
          ],
        },
      ])),
    ).toEqual([]);
  });

  it('treats a record map KEY as accepted and resolves the rest against the value schema', () => {
    expect(run(form([{ fields: [{ field: 'x', visibleWhen: "data.entries.anything.type == 't'" }] }])))
      .toEqual([]);
  });

  it('stops at a scope that declares no key set', () => {
    expect(run(form([{ fields: [{ field: 'x', visibleWhen: 'data.bag.whatever.deep == 1' }] }])))
      .toEqual([]);
  });

  it('does not judge a comprehension-macro variable as a dropped root', () => {
    // `type` is a DemoSchema key, so a naive bare-identifier scan would report
    // the loop variable if it were spelled `type`.
    expect(run(form([{ fields: [{ field: 'x', visibleWhen: "data.tags.all(type, type != '')" }] }])))
      .toEqual([]);
  });
});

describe('validatePredicatePathRefs — `predicate-path-unresolved`', () => {
  it('names the unresolvable path and gates', () => {
    const findings = run(form([{ fields: [{ field: 'x', visibleWhen: "data.tpye == 'formula'" }] }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(PREDICATE_PATH_UNRESOLVED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('`data.tpye`');
    expect(findings[0].path).toBe('views[0].sections[0].fields[0].visibleWhen');
    // The suggestion is what makes this self-correcting for an AI author.
    expect(findings[0].hint).toContain("'type'");
  });

  it('names the unresolvable SEGMENT of a nested path, not just its head', () => {
    const findings = run(form([{ visibleWhen: 'data.enable.serach', fields: [] }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(PREDICATE_PATH_UNRESOLVED);
    expect(findings[0].message).toContain('`data.enable.serach`');
    expect(findings[0].message).toContain('not a key of `data.enable`');
  });

  it('reports a bad path inside a repeater row against the ROW schema', () => {
    const findings = run(form([
      {
        fields: [
          {
            field: 'rows',
            type: 'repeater',
            fields: [{ field: 'maxLength', visibleWhen: 'data.enable.search' }],
          },
        ],
      },
    ]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(PREDICATE_PATH_UNRESOLVED);
    expect(findings[0].message).toContain('`data.enable`');
    expect(findings[0].path).toBe('views[0].sections[0].fields[0].fields[0].visibleWhen');
  });
});

describe('validatePredicatePathRefs — `predicate-path-unrooted`', () => {
  it('reports a bare identifier that IS a schema key (#6254 shape)', () => {
    const findings = run(form([{ fields: [{ field: 'x', visibleWhen: "type == 'formula'" }] }]));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(PREDICATE_PATH_UNROOTED);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('`type`');
    expect(findings[0].hint).toContain('`data.type`');
  });

  it('catches the exact pre-#6254 spelling `type in [...]`', () => {
    const findings = run(form([
      { fields: [{ field: 'x', visibleWhen: "type in ['text','textarea','email']" }] },
    ]));
    expect(findings.map((f) => f.rule)).toEqual([PREDICATE_PATH_UNROOTED]);
  });

  it('says nothing about a bare identifier the schema does not declare', () => {
    // That is `visibility-bare-identifier`'s (#6128) verdict to give, and one
    // broken predicate must not produce two findings from two rules that
    // disagree about the reason.
    expect(run(form([{ fields: [{ field: 'x', visibleWhen: "nonsense == 'a'" }] }]))).toEqual([]);
  });
});

describe('validatePredicatePathRefs — deliberate boundaries', () => {
  it('gives no verdict on a predicate the canonical front end refuses', () => {
    // `visibility-predicate-syntax` (#6253) owns this source.
    expect(run(form([{ fields: [{ field: 'x', visibleWhen: "type === 'formula'" }] }]))).toEqual([]);
  });

  it('skips a form bound to an ObjectQL object rather than a schema', () => {
    const stack = {
      views: [
        {
          name: 'contact',
          data: { provider: 'object', objectName: 'contact' },
          sections: [{ fields: [{ field: 'x', visibleWhen: "data.tpye == 'a'" }] }],
        },
      ],
    };
    expect(run(stack)).toEqual([]);
  });

  it('skips a `schemaId` no schema resolves', () => {
    expect(run(form([{ fields: [{ field: 'x', visibleWhen: "data.tpye == 'a'" }] }], 'unknown_kind')))
      .toEqual([]);
  });

  it('does not descend a sub-field list whose row schema cannot be resolved', () => {
    expect(
      run(form([
        {
          fields: [
            { field: 'not_a_key', fields: [{ field: 'y', visibleWhen: "data.whatever == 'a'" }] },
          ],
        },
      ])),
    ).toEqual([]);
  });

  it('survives a resolver that throws', () => {
    const stack = form([{ fields: [{ field: 'x', visibleWhen: "data.tpye == 'a'" }] }]);
    expect(
      validatePredicatePathRefs(stack, {
        resolveSchema: () => {
          throw new Error('registry offline');
        },
      }),
    ).toEqual([]);
  });
});

describe('validatePredicatePathRefs — traversal reach', () => {
  it('reaches `formViews.<key>` and the container `form` (#6381 ladder)', () => {
    const bad = { fields: [{ field: 'x', visibleWhen: "data.tpye == 'a'" }] };
    const findings = validatePredicatePathRefs(
      {
        views: [
          {
            name: 'demo',
            form: { data: { provider: 'schema', schemaId: 'demo' }, sections: [bad] },
            formViews: {
              edit: { data: { provider: 'schema', schemaId: 'demo' }, sections: [bad] },
            },
          },
        ],
      },
      { resolveSchema },
    );
    expect(findings.map((f) => f.path)).toEqual([
      'views[0].form.sections[0].fields[0].visibleWhen',
      'views[0].formViews.edit.sections[0].fields[0].visibleWhen',
    ]);
  });

  it('reads the deprecated `visibleOn` alias VALUE on a raw authored object', () => {
    const findings = run(form([{ fields: [{ field: 'x', visibleOn: "data.tpye == 'a'" }] }]));
    expect(findings.map((f) => f.rule)).toEqual([PREDICATE_PATH_UNRESOLVED]);
  });

  it('walks a name-keyed `views` map and reports its map path', () => {
    const findings = validatePredicatePathRefs(
      {
        views: {
          demo_form: {
            data: { provider: 'schema', schemaId: 'demo' },
            sections: [{ fields: [{ field: 'x', visibleWhen: "data.tpye == 'a'" }] }],
          },
        },
      },
      { resolveSchema },
    );
    expect(findings.map((f) => f.path)).toEqual([
      'views.demo_form.sections[0].fields[0].visibleWhen',
    ]);
  });
});

describe('registry wiring', () => {
  it('is registered in AUTHORING_RULES as a gating rule on all three commands', () => {
    const entry = AUTHORING_RULES.find((r) => r.name === 'validatePredicatePathRefs');
    expect(entry, '#7010 rule missing from AUTHORING_RULES').toBeDefined();
    expect(entry!.tier).toBe('gating');
    expect([...entry!.commands].sort()).toEqual(['build', 'lint', 'validate']);
    // #7220 — the family moved to the runtime publish gate TOGETHER, so this
    // rule is no longer CLI-only and carries no `surfaceReason`. It is wired
    // here because its siblings are: the solo wiring this rule's own PR
    // implemented was reverted, and `authoring-rule-wiring.test.ts` now pins the
    // family property (all of the surface's ids, or none) rather than trusting a
    // prose reason to keep the halves in step.
    expect([...entry!.surfaces]).toEqual(['cli', 'runtime-publish']);
    expect([...entry!.runtimeTypes!]).toEqual(['view']);
    expect(entry!.surfaceReason).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// #6254 corpus — the shipped metadata forms
// ────────────────────────────────────────────────────────────────────────────
//
// `METADATA_FORM_REGISTRY` is the whole population of `data.`-rooted predicates
// this repo ships (17 forms; 46 predicates, all `visibleWhen`). Every entry is a
// `defineForm` output, i.e. exactly the bare FormView shape `formViewSites`
// walks as its `self` rung — so the corpus is fed through the rule's PRODUCTION
// entry point, not through a parallel walker written for the test.
//
// This is the count the widening discipline requires before an `error`-level
// gate may land. Measured on `origin/main@55da611e5`: **0**. A non-zero count
// here would have been a STOP.
describe('#7010 corpus — shipped METADATA_FORM_REGISTRY', () => {
  const shippedStack = { views: Object.values(METADATA_FORM_REGISTRY) };

  it('every shipped metadata form resolves a schema (the oracle is not vacuously absent)', () => {
    // Without this the corpus assertion below could read 0 because no form
    // resolved a schema at all — a green gate over nothing, the #4984 signature.
    const unresolved = Object.keys(METADATA_FORM_REGISTRY)
      .filter((type) => !getMetadataTypeSchema(type));
    expect(unresolved).toEqual([]);
  });

  it('reaches every shipped predicate (the walk is not vacuously empty)', () => {
    // The anti-vacuity guard from the other end, and the reason it is written
    // this way. The obvious version — "resolve every form against an empty
    // schema, expect a finding per predicate" — is WRONG here and was measured
    // wrong: an empty schema also fails to resolve the `fields` repeater, so the
    // walk stops before the 16 sub-field predicates and the count comes out
    // BELOW the corpus while looking like proof of reach.
    //
    // So keep the real schemas (descent works exactly as in production) and
    // corrupt the PREDICATES instead: every source becomes a path no schema can
    // declare. Each predicate the walk reaches must then report exactly once,
    // which makes the assertion an equality on the corpus size rather than a
    // floor that any subset satisfies.
    const corrupted = structuredClone(shippedStack) as { views: unknown[] };
    let predicates = 0;
    const corrupt = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) corrupt(child);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const rec = node as Record<string, unknown>;
      for (const key of ['visibleWhen', 'visibleOn']) {
        const value = rec[key];
        if (typeof value === 'string') {
          rec[key] = 'data.__no_such_key__';
          predicates++;
        } else if (value && typeof value === 'object'
          && typeof (value as Record<string, unknown>).source === 'string') {
          (value as Record<string, unknown>).source = 'data.__no_such_key__';
          predicates++;
        }
      }
      for (const value of Object.values(rec)) corrupt(value);
    };
    corrupt(corrupted.views);
    expect(predicates, 'the shipped metadata forms carry no predicates at all').toBe(46);

    const findings = validatePredicatePathRefs(corrupted);
    expect(findings).toHaveLength(predicates);
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set([PREDICATE_PATH_UNRESOLVED]));
  });

  it('reports NOTHING over the shipped forms (corpus count = 0)', () => {
    const findings = validatePredicatePathRefs(shippedStack);
    expect(
      findings.map((f) => `${f.rule} @ ${f.path}: ${f.message}`),
      'a shipped metadata form now carries a predicate path its schema does not declare',
    ).toEqual([]);
  });

  it('catches the pre-#6254 bare spellings when they are restored (reverse verification)', () => {
    // The reverse direction is RED-on-restore: #6254 rewrote 16 predicates in
    // `object.form.ts` from `type ...` to `data.type ...`. Restoring the bare
    // spelling on a deep copy of the shipped `object` form must produce exactly
    // 16 `predicate-path-unrooted` findings — the count the issue measured, and
    // the count this rule exists to have caught before it shipped.
    const objectForm = structuredClone(METADATA_FORM_REGISTRY.object) as Record<string, unknown>;
    let restored = 0;
    const debare = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) debare(child);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const rec = node as Record<string, unknown>;
      // `defineForm` PARSES, so a shipped predicate is the post-parse
      // `{ dialect, source }` envelope, not the raw string the source file spells.
      const predicate = rec.visibleWhen;
      const source = typeof predicate === 'string' ? predicate
        : predicate && typeof predicate === 'object'
            && typeof (predicate as Record<string, unknown>).source === 'string'
          ? ((predicate as Record<string, unknown>).source as string)
          : undefined;
      if (source && /^data\.type\b/.test(source)) {
        const bare = source.replace(/\bdata\.type\b/g, 'type');
        if (typeof predicate === 'string') rec.visibleWhen = bare;
        else (predicate as Record<string, unknown>).source = bare;
        restored++;
      }
      for (const value of Object.values(rec)) debare(value);
    };
    debare(objectForm);
    expect(restored, 'the 16 sites #6254 rewrote are no longer where this test looks').toBe(16);

    const findings = validatePredicatePathRefs({ views: [objectForm] });
    expect(findings).toHaveLength(16);
    expect(new Set(findings.map((f) => f.rule))).toEqual(new Set([PREDICATE_PATH_UNROOTED]));
    expect(findings[0].message).toContain('`type`');
  });
});
