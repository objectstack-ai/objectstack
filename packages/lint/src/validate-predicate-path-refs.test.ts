// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the #7010 predicate PATH-resolution gate, and for #7659's sibling
 * rule about the SHAPE of a `==` / `!=` right-hand side.
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
  PREDICATE_RHS_PATH_SHAPED,
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

// ────────────────────────────────────────────────────────────────────────────
// #7659 — the RIGHT-hand side of `==` / `!=`
// ────────────────────────────────────────────────────────────────────────────
//
// A different question from everything above, and the reason it needed its own
// rule rather than a widening of #7214: `data.a == data.b` RESOLVES on both
// sides, so both rules above are silent on it by construction. The first two
// tests pin that pair — the silence, and a control proving the walk that went
// silent can still see.
describe('validatePredicatePathRefs — path-shaped right-hand side (#7659)', () => {
  const rhs = (source: string) =>
    run(form([{ label: 'S', fields: [{ field: 'name', visibleWhen: source }] }]));

  it('reports a path on the RIGHT of `==` — the case #7214 is silent on', () => {
    // Both sides resolve against DemoSchema (`name`, `type`), so neither
    // resolution limb has anything to say. Asserted as an EQUALITY on the rule
    // set rather than a `toContain`: if a resolution limb ever started firing
    // here, this card's premise would be gone and the test must say so.
    const findings = rhs('data.name == data.type');
    expect(findings.map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('views[0].sections[0].fields[0].visibleWhen');
    expect(findings[0].message).toContain('`data.type`');
    expect(findings[0].message).toMatch(/literal string "data\.type"/);
    expect(findings[0].hint).toMatch(/quote it/);
  });

  it('proves that silence is #7214 unable to SEE this, not a walk that reports nothing', () => {
    // Same predicate, one segment misspelled: the resolution limb must wake up.
    // Without this, the assertion above could be measuring a dead walk.
    expect(rhs('data.name == data.tpye').map((f) => f.rule).sort())
      .toEqual([PREDICATE_PATH_UNRESOLVED, PREDICATE_RHS_PATH_SHAPED]);
  });

  it('reports `!=` the same way', () => {
    const findings = rhs('data.name != data.type');
    expect(findings.map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
    expect(findings[0].message).toContain('`!=`');
  });

  it('reports a path on the right even when the LITERAL is on the left', () => {
    // Sides swapped: the renderer resolves the left and parses the right, so
    // this is the same defect and the fix is to swap them back.
    expect(rhs("'grid' == data.type").map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
  });

  it('reports a BARE unquoted word, at `warning` — it works today by accident', () => {
    // `... == active` compares against the literal string "active", which is
    // very likely what the author meant; objectui#4049's ruling preserved that
    // deliberately. Reported, because it is outside the declared subset and dies
    // when CEL lands; not gated, because refusing a `view` write over metadata
    // that renders correctly is a false build error.
    const findings = rhs('data.name == active');
    expect(findings.map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('`active`');
  });

  it('reports every comparison in a compound predicate', () => {
    const findings = rhs("data.name == data.type && data.type == 'formula' || data.name != data.type");
    expect(findings.map((f) => f.rule)).toEqual([
      PREDICATE_RHS_PATH_SHAPED,
      PREDICATE_RHS_PATH_SHAPED,
    ]);
  });

  // ── Negative controls. Each is either a spelling the rule's own hint
  // recommends, or a literal form `parseLiteral` returns from BEFORE its
  // path-shaped tail — so the renderer is silent on it too.
  it.each([
    ['a quoted literal RHS', "data.type == 'formula'"],
    ['a double-quoted literal RHS', 'data.type == "formula"'],
    ['a numeric RHS', 'data.name == 3'],
    ['a negative numeric RHS', 'data.name != -3'],
    ['a boolean RHS', 'data.enable.search == true'],
    ['a boolean RHS, negated', 'data.enable.search != false'],
    ['a null RHS', 'data.type == null'],
    // The restructuring the hint recommends — PATH on the left, literal on the
    // right. If the message tells authors to write this, writing it must not be
    // reported, or the rule sends them in a circle.
    ['the sanctioned restructuring (path LEFT, literal right)', "data.type != 'formula'"],
    ['a bare truthy check with no comparison at all', 'data.enable.search'],
    ['an `in` membership test (objectui#4266, deliberately not folded in)', "data.type in ['a','b']"],
    // Reachable through `parseLiteral`'s tail in the renderer, but NOT
    // path-shaped under the shared grammar — the consumer stays silent on both.
    ['an indexed RHS', 'data.type == data.rows[0]'],
    ['a call-result RHS', 'data.type == size(data.tags)'],
  ])('is silent on %s', (_label, source) => {
    expect(rhs(source)).toEqual([]);
  });

  it('leaves a comprehension macro BODY alone, and still walks its receiver', () => {
    // The interim evaluator supports no macros at all, so a comparison inside
    // one is not a statement about this subset. The receiver is still walked —
    // the second case carries a real finding in the same predicate.
    expect(rhs('data.tags.all(t, t == data.type)')).toEqual([]);
    expect(rhs('data.name == data.type && data.tags.all(t, t == data.type)').map((f) => f.rule))
      .toEqual([PREDICATE_RHS_PATH_SHAPED]);
  });

  it('gives no verdict on a source the canonical front end refuses', () => {
    // `$` is in the shared grammar and NOT in CEL's identifier syntax, so this
    // never parses. One broken predicate, one finding — and that one is
    // `visibility-predicate-syntax`'s (#6253), from the sibling file.
    expect(rhs('data.name == $b')).toEqual([]);
  });

  it('emits the id the published barrel exports', async () => {
    const barrel = await import('./index.js');
    expect(barrel.PREDICATE_RHS_PATH_SHAPED).toBe('predicate-rhs-path-shaped');
    expect(rhs('data.name == data.type')[0].rule).toBe(barrel.PREDICATE_RHS_PATH_SHAPED);
  });
});

describe('validatePredicatePathRefs — one position, one prescription (#7696)', () => {
  const rhs = (source: string) =>
    run(form([{ label: 'S', fields: [{ field: 'name', visibleWhen: source }] }]));

  it('does not ALSO call a right-hand bare word a dropped root', () => {
    // `type` is a declared key of DemoSchema, so before #7696 this drew
    // `predicate-path-unrooted` at `error` ("write `data.type`") on top of the
    // right-hand `warning` ("write `'type'`") — two findings, opposite fixes,
    // and the blocking one asking for a spelling this same rule refuses.
    const findings = rhs('data.name == type');
    expect(findings.map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
    expect(findings[0].severity).toBe('warning');
  });

  it('proves that silence is the stand-down, not a walk that stopped seeing keys', () => {
    // Same schema key, LEFT of the comparison: the unrooted limb must still
    // fire, or the assertion above is measuring a dead limb.
    expect(rhs("type == 'formula'").map((f) => f.rule)).toEqual([PREDICATE_PATH_UNROOTED]);
    // And in a right-hand slot it stays reported whenever it ALSO occurs
    // somewhere that is not one.
    expect(rhs('data.name == type && type').map((f) => f.rule).sort())
      .toEqual([PREDICATE_PATH_UNROOTED, PREDICATE_RHS_PATH_SHAPED]);
  });

  it('stands down for `!=` as well, and not for a dotted chain', () => {
    expect(rhs('data.name != type').map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
    // A dotted chain is the `error` arm and was never part of the contradiction.
    expect(rhs('data.name == data.type')[0].severity).toBe('error');
  });

  it('never suppresses inside a comprehension-macro body, where nothing replaces it', () => {
    // `equalitySites` skips macro bodies, so an `==` in there produces no
    // right-hand finding. Suppressing the unrooted verdict there would be a
    // silence rather than a reconciliation.
    expect(rhs('data.tags.all(t, t == type)').map((f) => f.rule)).toEqual([PREDICATE_PATH_UNROOTED]);
  });

  it('names both readings and refuses to prescribe the in-place rooting', () => {
    const f = rhs('data.name == type')[0];
    expect(f.hint).toMatch(/quote it: `== 'type'`/);
    expect(f.hint).toMatch(/data\.type == 'yes'/);
    expect(f.hint).toMatch(/Do NOT simply add the root in place/);
    // The bar: BOTH spellings the message recommends must be clean…
    expect(rhs("data.type == 'yes'")).toEqual([]);
    expect(rhs("data.name == 'type'")).toEqual([]);
    // …and the spelling it warns AGAINST must be reported, or the warning is
    // noise. This is the exact edit the old `error` used to demand.
    expect(rhs('data.name == data.type').map((x) => x.severity)).toEqual(['error']);
  });

  it('the LEFT-side spelling it recommends is judged on its own merits, not circular', () => {
    // If the word names no field at all, moving it left is answered by #7214 —
    // "`active` is not a key" — which is a NEW statement about a different
    // mistake, not the old ring-around. The right-hand rule has nothing further
    // to say once the token is out of the literal slot.
    expect(rhs("data.active == 'yes'").map((x) => x.rule)).toEqual([PREDICATE_PATH_UNRESOLVED]);
  });

  it('judges the right-hand position on a form whose schemaId resolves to nothing', () => {
    // The two resolution limbs need an oracle and correctly go quiet; the
    // right-hand limb never did. Walking past the whole site made the
    // stand-down above a silence on this shape, so the site is now walked with
    // no scope instead of skipped.
    const unknown = (source: string) =>
      run(form([{ label: 'S', fields: [{ field: 'name', visibleWhen: source }] }], 'no_such_type'));
    expect(unknown('data.a == data.b').map((f) => f.rule)).toEqual([PREDICATE_RHS_PATH_SHAPED]);
    expect(unknown('data.a == active').map((f) => f.severity)).toEqual(['warning']);
    // The resolution limbs stay silent there — no oracle, no verdict.
    expect(unknown("data.tpye == 'x'")).toEqual([]);
    // Control: the same predicate against a schema that DOES resolve reports.
    expect(rhs("data.tpye == 'x'").map((f) => f.rule)).toEqual([PREDICATE_PATH_UNRESOLVED]);
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

  // #7659's own corpus measurement, on the same population and through the same
  // production entry point. The rule above is asserted at zero for its two ids;
  // this one asserts zero for the third at BOTH severities, which is what a new
  // `error` finding costs before it may land. Measured on `origin/main@5823d59`:
  // 0 and 0. A non-zero `error` count would have been a STOP.
  it('reports NOTHING on the RHS rule over the shipped forms, at either severity', () => {
    const rhsFindings = validatePredicatePathRefs(shippedStack)
      .filter((f) => f.rule === PREDICATE_RHS_PATH_SHAPED);
    expect(rhsFindings.filter((f) => f.severity === 'error').map((f) => f.path)).toEqual([]);
    expect(rhsFindings.filter((f) => f.severity === 'warning').map((f) => f.path)).toEqual([]);
  });

  it('sees the shipped corpus (reverse verification for the RHS rule)', () => {
    // The anti-vacuity direction, and the reason it is written against the
    // SHIPPED predicates rather than a fixture: rewriting each real
    // `== 'literal'` comparison into `== data.__rhs__` turns it into exactly the
    // defect, so the assertion is an EQUALITY on the number of rewritten
    // comparisons rather than a floor any subset would satisfy. Zero here would
    // mean the measurement above was a green gate over nothing (#4984).
    //
    // The rewrite is anchored on the OPERATOR, not on "any quoted string": a
    // literal inside `data.type in ['a','b']` belongs to `in`, whose array parse
    // is objectui#4266 and deliberately not this rule's, so rewriting those too
    // would have inflated the expected count past what this rule answers for.
    const corrupted = structuredClone(shippedStack) as { views: unknown[] };
    let comparisons = 0;
    const rewrite = (node: unknown): void => {
      if (Array.isArray(node)) {
        for (const child of node) rewrite(child);
        return;
      }
      if (!node || typeof node !== 'object') return;
      const rec = node as Record<string, unknown>;
      for (const key of ['visibleWhen', 'visibleOn']) {
        const value = rec[key];
        const source = typeof value === 'string' ? value
          : value && typeof value === 'object'
              && typeof (value as Record<string, unknown>).source === 'string'
            ? ((value as Record<string, unknown>).source as string)
            : undefined;
        if (source === undefined) continue;
        const swapped = source.replace(/(==|!=)(\s*)'[^']*'/g, (_m, op, gap) => {
          comparisons++;
          return `${op}${gap}data.__rhs__`;
        });
        if (swapped === source) continue;
        if (typeof value === 'string') rec[key] = swapped;
        else (value as Record<string, unknown>).source = swapped;
      }
      for (const value of Object.values(rec)) rewrite(value);
    };
    rewrite(corrupted.views);
    expect(comparisons, 'no shipped predicate carries an `==`/`!=` literal comparison').toBe(45);

    const rhsFindings = validatePredicatePathRefs(corrupted)
      .filter((f) => f.rule === PREDICATE_RHS_PATH_SHAPED);
    expect(rhsFindings).toHaveLength(comparisons);
    expect(new Set(rhsFindings.map((f) => f.severity))).toEqual(new Set(['error']));
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
