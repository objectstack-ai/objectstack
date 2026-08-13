// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';
import {
  validateVisibilityPredicates,
  VISIBILITY_ROOT_MISLAYERED,
  VISIBILITY_BARE_IDENTIFIER,
  VISIBILITY_PREDICATE_SYNTAX,
  VISIBILITY_PREDICATE_OVER_BUDGET,
} from './validate-visibility-predicates.js';
import { AUTHORING_RULES } from './authoring-rules.js';

describe('validateVisibilityPredicates (ADR-0089 D3b)', () => {
  it('is clean for canonical `visibleWhen` with a runtime binding root', () => {
    const stack = {
      views: [
        {
          name: 'task_form',
          sections: [
            {
              label: 'Details',
              visibleWhen: "record.type == 'urgent'",
              fields: [{ field: 'notes', visibleWhen: "record.priority == 'high'" }],
            },
          ],
        },
      ],
      pages: [
        {
          name: 'detail_page',
          regions: [
            { components: [{ type: 'element:text', visibleWhen: "page.selectedId != ''" }] },
          ],
        },
      ],
    };
    expect(validateVisibilityPredicates(stack)).toEqual([]);
  });

  // ── #6318: the alias-KEY rule is RETIRED; the alias-VALUE read is not ──
  //
  // Three tests here used to assert that a `visibleOn` / `visibility` KEY
  // produced a `visibility-alias-deprecated` finding, one per carrier. That
  // rule never reached a real input: through all three CLI commands the stack
  // arrives at the `normalized` tier, and the ADR-0087 D2 conversions rename the
  // key INSIDE `normalizeStackInput`, one layer above. Measured at retirement,
  // per site: raw object 1 finding, `normalized` tier 0. The only shape that
  // still fired is the one those three fixtures used — a view CONTAINER with
  // top-level `sections` — which strict `ViewSchema` refuses outright
  // ("Unrecognized key(s) on this view container: `sections`"). Green unit test,
  // impossible fixture: #4984 / #6251.
  //
  // What SURVIVES those three assertions, and is what the replacements below
  // pin instead: the traversal reaches all three carriers, and `checkElement`
  // still reads the predicate VALUE through the deprecated key, so a value
  // defect written under an alias is judged rather than skipped. Each asserts
  // the EXACT finding set — non-empty and named, so it cannot pass by producing
  // nothing, and restoring the retired rule would fail it on set inequality.
  //
  // The surface itself is not unguarded: the same D2 conversion emits a
  // `warnConversionNotice` from `defineStack` naming the site, the conversion
  // and the protocol-16 retirement window. `authoring-rule-input-tier.test.ts`
  // (premise 3) pins that notice as the recorded guard.
  describe('the deprecated alias keys (#6318 — key rule retired, value read kept)', () => {
    it('a `visibleOn` KEY with a clean value is clean — no rule judges the spelling', () => {
      const stack = {
        views: [
          { name: 'task_form', sections: [{ label: 'S', visibleOn: "record.a == 1", fields: [] }] },
        ],
      };
      // Deliberately labelled: this green is VACUOUS with respect to the fold —
      // it is empty because the rule is gone, not because anything normalized.
      // It earns its place only as the retirement's direct statement, and the
      // three assertions below are what carry the real evidence.
      expect(validateVisibilityPredicates(stack)).toEqual([]);
    });

    it('a form SECTION predicate is still read through `visibleOn` (value verdict survives)', () => {
      const stack = {
        views: [
          { name: 'task_form', sections: [{ label: 'S', visibleOn: "data.a == 1", fields: [] }] },
        ],
      };
      const findings = validateVisibilityPredicates(stack);
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      expect(findings[0].path).toBe('views[0].sections[0]');
    });

    it('a form FIELD predicate is still read through `visibleOn`', () => {
      const stack = {
        views: [
          { name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleOn: "data.a == 1" }] }] },
        ],
      };
      const findings = validateVisibilityPredicates(stack);
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      expect(findings[0].path).toBe('views[0].sections[0].fields[0]');
    });

    it('a PAGE COMPONENT predicate is still read through the page-side `visibility` key', () => {
      const stack = {
        pages: [
          { name: 'p', regions: [{ components: [{ type: 'element:text', visibility: "data.x != ''" }] }] },
        ],
      };
      const findings = validateVisibilityPredicates(stack);
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      expect(findings[0].path).toBe('pages[0].regions[0].components[0]');
    });

    it('the canonical key still wins over an alias on the same element (ADR-0089 ordering)', () => {
      // Why the surviving alias limbs can only add coverage and never change a
      // verdict: `visibleWhen` is read first, so a stale alias beside it is
      // ignored rather than allowed to overrule the canonical spelling.
      const stack = {
        views: [
          { name: 'f', sections: [{ visibleWhen: "record.ok == 1", visibleOn: "data.stale == 1", fields: [] }] },
        ],
      };
      expect(validateVisibilityPredicates(stack)).toEqual([]);
    });
  });

  it('flags a `data.`-rooted predicate in a runtime view as mis-layered', () => {
    const stack = {
      views: [
        { name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleWhen: "data.type == 'grid'" }] }] },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(findings[0].severity).toBe('warning');
  });

  it('a `data.`-rooted predicate under `visibleOn` reports the mis-layer ALONE (#6318)', () => {
    // Was: "reports BOTH alias + mis-layer". The alias half is retired; the
    // surviving half — the mis-layer verdict is reached THROUGH the deprecated
    // key — is what this now pins, as an exact one-element set.
    const stack = {
      views: [
        { name: 'task_form', sections: [{ visibleOn: "data.status == 'x'", fields: [] }] },
      ],
    };
    expect(validateVisibilityPredicates(stack).map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
  });

  it('does not confuse a field literally named `data` (e.g. `record.data`) for a data root', () => {
    const stack = {
      views: [
        { name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: "record.data == 1" }] }] },
      ],
    };
    expect(validateVisibilityPredicates(stack)).toEqual([]);
  });

  it('resolves predicates stored as `{ dialect, source }` envelopes', () => {
    const stack = {
      pages: [
        {
          name: 'p',
          regions: [{ components: [{ type: 'element:text', visibleWhen: { dialect: 'cel', source: "data.x == 1" } }] }],
        },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
  });

  it('walks legacy `groups` (alias of sections) too', () => {
    // The `groups` bucket has no other test in this file, so the half-fact this
    // used to carry — the traversal descends `groups` at all — had to survive
    // #6318's retirement of the alias-KEY rule that used to demonstrate it. It
    // is re-demonstrated with a rule that still exists, and with the alias key
    // kept on the fixture so the group walk and the alias-value read are pinned
    // together exactly as before.
    const stack = {
      views: [
        { name: 'f', groups: [{ visibleOn: "data.a == 1", fields: [{ field: 'x', visibleWhen: 'approved' }] }] },
      ],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED, VISIBILITY_BARE_IDENTIFIER]);
    expect(findings.map((f) => f.path)).toEqual(['views[0].groups[0]', 'views[0].groups[0].fields[0]']);
  });

  it('is clean on an empty / model-less stack', () => {
    expect(validateVisibilityPredicates({})).toEqual([]);
    expect(validateVisibilityPredicates({ views: [], pages: [] })).toEqual([]);
  });

  // ── Layer-directional binding-root check (ADR-0089 D3, both directions) ──
  describe('metadata layer (opts.layer: "metadata")', () => {
    it('flags a `record.`-rooted predicate in a metadata-editing form as mis-layered', () => {
      const stack = {
        views: [
          { name: 'page_form', sections: [{ fields: [{ field: 'template', visibleWhen: "record.type != 'list'" }] }] },
        ],
      };
      const findings = validateVisibilityPredicates(stack, { layer: 'metadata' });
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      expect(findings[0].severity).toBe('warning');
      expect(findings[0].message).toContain('record.');
      expect(findings[0].hint).toContain('data');
    });

    it('is clean for the canonical `data.` root in a metadata-editing form', () => {
      const stack = {
        views: [
          { name: 'page_form', sections: [{ visibleWhen: "data.type != 'list'", fields: [{ field: 'template', visibleWhen: "data.type == 'grid'" }] }] },
        ],
      };
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' })).toEqual([]);
    });

    it('does NOT flag `data.` as mis-layered in the metadata layer (the runtime rule is the opposite)', () => {
      const stack = {
        views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: "data.type == 'grid'" }] }] }],
      };
      // Runtime (default) flags `data.`…
      expect(validateVisibilityPredicates(stack).map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
      // …metadata does not.
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' })).toEqual([]);
    });

    it('reads the value through a deprecated alias key on the metadata layer too (#6318)', () => {
      // Was: "still flags a deprecated alias key in the metadata layer (alias
      // check is layer-agnostic)". The alias-KEY rule is retired, so the
      // layer-agnostic claim about it is gone. What survives — and is the half
      // that ever mattered — is that the alias-VALUE read is layer-agnostic:
      // the same key feeds the layer-directional root verdict in BOTH
      // directions. Pinned bidirectionally on one fixture, exact sets both ways.
      const stack = {
        views: [{ name: 'f', sections: [{ visibleOn: "record.a == 1", fields: [] }] }],
      };
      // metadata layer forbids the runtime `record.` root → reported through the alias key…
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' }).map((f) => f.rule))
        .toEqual([VISIBILITY_ROOT_MISLAYERED]);
      // …and the same alias-spelled predicate is correct on the runtime layer.
      expect(validateVisibilityPredicates(stack)).toEqual([]);
    });

    it('does not confuse an identifier ending in `record` (e.g. `my_record.x`) for a record root', () => {
      const stack = {
        views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: "my_record.x == 1" }] }] }],
      };
      expect(validateVisibilityPredicates(stack, { layer: 'metadata' })).toEqual([]);
    });
  });

  it('runtime is the default layer (no opts) — flags `data.`, not `record.`', () => {
    const dataStack = { views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: 'data.a == 1' }] }] }] };
    const recordStack = { views: [{ name: 'f', sections: [{ fields: [{ field: 'x', visibleWhen: 'record.a == 1' }] }] }] };
    expect(validateVisibilityPredicates(dataStack).map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(validateVisibilityPredicates(recordStack)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// #7815 — WHICH LAYER a site is on, when the caller does not say.
//
// The rule above is correct for the layer it is told. What it was told at the
// runtime publish gate was the `'runtime'` default for EVERY view, including
// schema-bound metadata forms — so a correctly `data.`-rooted form drew the
// advisory telling its author to write `record.`. These cases pin the
// derivation itself; `runtime-gate.test.ts` pins it at the door it was wrong at.
// ─────────────────────────────────────────────────────────────────────

describe('the layer a site declares for itself (#7815)', () => {
  /**
   * A schema-bound metadata form, with the data source on the CONTAINER (the
   * `self` rung of the `formViewSites` ladder).
   */
  const metaForm = (predicate: string) => ({
    views: [{
      name: 'field_editor',
      data: { provider: 'schema', schemaId: 'field' },
      sections: [{ fields: [{ field: 'notes', visibleWhen: predicate }] }],
    }],
  });

  /** The same predicate on a plain runtime view — the negative control. */
  const runtimeForm = (predicate: string) => ({
    views: [{ name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleWhen: predicate }] }] }],
  });

  it('a `data.`-rooted predicate on a schema-bound form is CORRECT — no advisory', () => {
    // The finding this card is about. `data` IS the root that surface binds.
    expect(validateVisibilityPredicates(metaForm("data.type == 'grid'"))).toEqual([]);
  });

  it('the same predicate on a plain runtime view still draws it — the rule is live', () => {
    // The negative control that keeps the case above from being a walk that
    // simply went blind: one character of difference in the fixture (the
    // `data:` source), opposite verdicts.
    const findings = validateVisibilityPredicates(runtimeForm("data.type == 'grid'"));
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(findings[0].severity).toBe('warning');
  });

  it('a `record.`-rooted predicate on a schema-bound form draws it the OTHER way', () => {
    // ADR-0089 D3 is bidirectional and this direction was unreachable at the
    // runtime gate: told `'runtime'`, the rule forbids `data.` and says nothing
    // about `record.`, so a form predicate that never matches published silent.
    // No new behaviour — this is the metadata-layer arm the rule already had.
    const findings = validateVisibilityPredicates(metaForm("record.type == 'grid'"));
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('record.');
    expect(findings[0].hint).toContain('data');
  });

  it('derives per SITE, not per stack — one entry can carry both kinds', () => {
    // `formViews.<key>` sub-containers each declare their own `data`, so a
    // stack-level layer would be wrong for one of these two no matter which
    // value it took.
    const stack = {
      views: [{
        name: 'mixed',
        object: 'account',
        formViews: {
          meta: {
            data: { provider: 'schema', schemaId: 'field' },
            sections: [{ fields: [{ field: 'a', visibleWhen: "data.type == 'grid'" }] }],
          },
          live: {
            sections: [{ fields: [{ field: 'b', visibleWhen: "data.type == 'grid'" }] }],
          },
        },
      }],
    };
    const findings = validateVisibilityPredicates(stack);
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(findings[0].path).toBe('views[0].formViews.live.sections[0].fields[0]');
  });

  it('`opts.layer` still governs every site that declares no data source', () => {
    // The file-aware caller's contract is unchanged: a `*.form.ts` whose form
    // carries no `data: { provider: 'schema' }` is still only reachable through
    // the option, and a page component always is.
    expect(validateVisibilityPredicates(runtimeForm("data.type == 'grid'"), { layer: 'metadata' }))
      .toEqual([]);
    expect(
      validateVisibilityPredicates(runtimeForm("record.type == 'grid'"), { layer: 'metadata' })
        .map((f) => f.rule),
    ).toEqual([VISIBILITY_ROOT_MISLAYERED]);

    const page = (predicate: string) => ({
      pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibleWhen: predicate }] }] }],
    });
    expect(validateVisibilityPredicates(page("data.x == 'y'")).map((f) => f.rule))
      .toEqual([VISIBILITY_ROOT_MISLAYERED]);
    expect(validateVisibilityPredicates(page("data.x == 'y'"), { layer: 'metadata' })).toEqual([]);
  });

  it('an unresolvable `schemaId` is still a schema-bound SURFACE', () => {
    // The layer follows the data SOURCE, not whether the id resolves — the same
    // boundary `literalRhs` draws off the same `schemaIdOf` call, so the two
    // cannot disagree about which surface they are on.
    expect(validateVisibilityPredicates({
      views: [{
        name: 'f',
        data: { provider: 'schema', schemaId: 'no_such_schema' },
        sections: [{ fields: [{ field: 'x', visibleWhen: "data.a == 'b'" }] }],
      }],
    })).toEqual([]);
  });

  it('a non-schema provider is NOT a metadata form', () => {
    // `schemaIdOf` reads `provider === 'schema'` only; an ObjectQL-backed data
    // source is a runtime surface and keeps the runtime direction.
    const findings = validateVisibilityPredicates({
      views: [{
        name: 'f',
        data: { provider: 'object', object: 'account' },
        sections: [{ fields: [{ field: 'x', visibleWhen: "data.a == 'b'" }] }],
      }],
    });
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_ROOT_MISLAYERED]);
  });

  it('moves NO finding across the error/advisory boundary', () => {
    // The acceptance guarantee, asserted rather than argued: the derivation may
    // only ever change which ADVISORIES an author hears. Every fixture here is
    // schema-bound — the set the derivation moves — and every `error` on it is
    // the same id, at the same path, that the `'runtime'` reading produced.
    const errorsOf = (predicate: string) =>
      validateVisibilityPredicates(metaForm(predicate))
        .filter((f) => f.severity === 'error')
        .map((f) => f.rule)
        .sort();

    expect(errorsOf("data.type == 'grid'")).toEqual([]);
    expect(errorsOf("record.type == 'grid'")).toEqual([]);
    expect(errorsOf('status == active')).toEqual([VISIBILITY_BARE_IDENTIFIER]);
    expect(errorsOf('active == data.type')).toEqual([VISIBILITY_BARE_IDENTIFIER]);
    expect(errorsOf("country === 'USA'")).toEqual([VISIBILITY_PREDICATE_SYNTAX]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// `visibility-bare-identifier` — #6128 (the build-time half of #5149's
// 2026-08-06 ruling; the runtime warn-once half landed as objectui#3541).
// ─────────────────────────────────────────────────────────────────────

/** A one-field runtime form view carrying `predicate` on its only field. */
function formStack(predicate: unknown): Record<string, unknown> {
  return { views: [{ name: 'task_form', sections: [{ fields: [{ field: 'notes', visibleWhen: predicate }] }] }] };
}

/** Only the bare-identifier findings, for assertions that ignore the advisories. */
function bareFindings(stack: Record<string, unknown>, opts?: { layer: 'runtime' | 'metadata' }) {
  return validateVisibilityPredicates(stack, opts).filter((f) => f.rule === VISIBILITY_BARE_IDENTIFIER);
}

describe('visibility-bare-identifier (#6128 / #5149 requirement 3)', () => {
  describe('the acceptance pair', () => {
    it('#5149 Repro 1 — a bare field name is an ERROR, not an advisory', () => {
      const findings = validateVisibilityPredicates(formStack("status == 'active'"));
      expect(findings).toHaveLength(1);
      expect(findings[0].rule).toBe(VISIBILITY_BARE_IDENTIFIER);
      // The whole point of the ruling: `error` gates, so the broken predicate
      // cannot be shipped at all ("坏谓词根本发不出去").
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('views[0].sections[0].fields[0]');
      expect(findings[0].message).toContain('`status`');
      expect(findings[0].hint).toContain('`record.status`');
    });

    it('the `record.`-prefixed spelling of the SAME predicate is clean', () => {
      expect(validateVisibilityPredicates(formStack("record.status == 'active'"))).toEqual([]);
    });
  });

  describe('the whole predicate family, on every carrier the schema declares', () => {
    it('flags a bare identifier on a form SECTION', () => {
      const stack = { views: [{ name: 'f', sections: [{ visibleWhen: 'approved', fields: [] }] }] };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['views[0].sections[0]']);
    });

    it('flags a bare identifier on a PAGE COMPONENT', () => {
      const stack = {
        pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibleWhen: "kind == 'a'" }] }] }],
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['pages[0].regions[0].components[0]']);
    });

    it('reads the value through the deprecated `visibleOn` alias too (bare ALONE since #6318)', () => {
      // Was an "alias + bare, both reported" pair. The alias half is retired;
      // the half this test existed for — the gate reaches a bare identifier
      // written under the deprecated key — is unchanged and is now the whole
      // expected set.
      const stack = { views: [{ name: 'f', sections: [{ visibleOn: "status == 'x'", fields: [] }] }] };
      expect(validateVisibilityPredicates(stack).map((f) => f.rule)).toEqual([VISIBILITY_BARE_IDENTIFIER]);
    });

    it('reads the value through the deprecated page-side `visibility` alias too', () => {
      const stack = {
        pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibility: 'shown' }] }] }],
      };
      expect(bareFindings(stack)).toHaveLength(1);
    });

    it('resolves a `{ dialect, source }` envelope the same as a bare string', () => {
      expect(bareFindings(formStack({ dialect: 'cel', source: "status == 'active'" }))).toHaveLength(1);
    });

    it('walks a slotted page\'s `slots` map (single component AND array form)', () => {
      const stack = {
        pages: [
          {
            name: 'record_page',
            kind: 'slotted',
            slots: {
              highlights: { type: 'element:text', visibleWhen: "stage == 'won'" },
              tabs: [
                { type: 'record:related', visibleWhen: 'record.has_children' },
                { type: 'record:related', visibleWhen: 'has_children' },
              ],
            },
          },
        ],
      };
      expect(bareFindings(stack).map((f) => f.path).sort()).toEqual([
        'pages[0].slots.highlights',
        'pages[0].slots.tabs[1]',
      ]);
    });

    it('walks a component sub-tree hidden in the untyped `properties` bag', () => {
      // `page:tabs` / `page:accordion` keep their children at
      // `properties.items[].children`; `page:card` at `properties.body`. A
      // hand-rolled `regions[].components[]` loop sees none of them — which is
      // the dead-rule shape `page-walk.ts` exists to prevent (#3583).
      const stack = {
        pages: [
          {
            name: 'p',
            regions: [
              {
                components: [
                  {
                    type: 'page:tabs',
                    properties: {
                      items: [{ children: [{ type: 'element:text', visibleWhen: "stage == 'won'" }] }],
                    },
                  },
                ],
              },
            ],
          },
        ],
      };
      expect(bareFindings(stack)).toHaveLength(1);
    });
  });

  // ── The traversal the rule was measured against ─────────────────────
  //
  // `os build` on examples/app-showcase emits its single view-form predicate at
  // `views[0].formViews.edit.sections[0].fields[6].visibleWhen`: on the runtime
  // app shape a `views[]` entry is a view CONTAINER, and `sections` live under
  // `form` / `formViews.<key>`. Reading only `views[].sections` reported clean
  // on that stack — an `error`-level gate that cannot fire on the shape #5149's
  // own repro used (an object create dialog's `type: 'tabbed'` form view).
  describe('reaches the form views a real stack actually carries', () => {
    it('a container\'s named `formViews.<key>` — the shape app-showcase emits', () => {
      const stack = {
        views: [
          {
            name: 'showcase_task',
            list: { type: 'grid' },
            formViews: {
              edit: { type: 'simple', sections: [{ fields: [{ field: 'notes', visibleWhen: "priority == 'urgent'" }] }] },
            },
          },
        ],
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual([
        'views[0].formViews.edit.sections[0].fields[0]',
      ]);
    });

    it('names the sub-container in `where`, so two form views are distinguishable', () => {
      const stack = {
        views: [
          {
            object: 'showcase_task',
            formViews: {
              edit: { sections: [{ visibleWhen: 'approved', fields: [] }] },
              tabbed: { sections: [{ visibleWhen: 'approved', fields: [] }] },
            },
          },
        ],
      };
      // No `name` on the container (the emitted-artifact shape) — it falls back
      // to the `object` binding, and the surface tells the two forms apart.
      expect(bareFindings(stack).map((f) => f.where).sort()).toEqual([
        'view "showcase_task" · formViews.edit',
        'view "showcase_task" · formViews.tabbed',
      ]);
    });

    it('a container\'s DEFAULT `form`', () => {
      const stack = {
        views: [{ name: 'v', form: { sections: [{ visibleWhen: 'approved', fields: [] }] } }],
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['views[0].form.sections[0]']);
    });

    it('a bare form view whose `sections` sit at the top (the `defineForm` shape)', () => {
      const stack = { views: [{ name: 'v', sections: [{ visibleWhen: 'approved', fields: [] }] }] };
      expect(bareFindings(stack).map((f) => f.path)).toEqual(['views[0].sections[0]']);
    });

    it('a name-keyed `views` map reports the KEY, not a synthetic index', () => {
      const stack = {
        views: { task_form: { formViews: { edit: { sections: [{ visibleWhen: 'approved', fields: [] }] } } } },
      };
      expect(bareFindings(stack).map((f) => f.path)).toEqual([
        'views.task_form.formViews.edit.sections[0]',
      ]);
    });

    it('does NOT read `objects[].views` — the schema tombstones that key', () => {
      // `object.zod.ts:1833`: "`views` is not an ObjectSchema field". A branch
      // keyed on it could only fire for stacks the schema already rejects by
      // name — the phantom check #4984 / #5017 removed elsewhere.
      const stack = {
        objects: [
          { name: 'task', views: [{ sections: [{ visibleWhen: 'approved', fields: [] }] }] },
        ],
      };
      expect(validateVisibilityPredicates(stack)).toEqual([]);
    });
  });

  describe('the ONE position this rule stands down on (#7696)', () => {
    /** The same one-field form, but SCHEMA-BOUND — a metadata-editing form. */
    const metaForm = (predicate: string) => ({
      views: [{
        name: 'field_editor',
        data: { provider: 'schema', schemaId: 'field' },
        sections: [{ fields: [{ field: 'notes', visibleWhen: predicate }] }],
      }],
    });

    it('a bare word on the RIGHT of `==` is a literal slot, not a dropped root', () => {
      // The console's metadata-admin evaluator hands the right side to
      // `parseLiteral` and never resolves it (objectui#4049), so this rule's
      // prescription — `<root>.active` — is not a fix but a second defect, and
      // `predicate-rhs-path-shaped` refuses that spelling at `error`. One
      // position, one prescription: this rule is silent and that one speaks.
      expect(bareFindings(metaForm('data.type == active'))).toEqual([]);
      expect(bareFindings(metaForm('data.type != active'))).toEqual([]);
    });

    it('proves the scanner still sees — the stand-down is per IDENTIFIER', () => {
      // Every one of these is the same schema-bound form, so a walk that had
      // gone blind would report nothing here either.
      //
      // #7815: this pin used to read `record.status`, which is what the rule
      // said here while the caller's `'runtime'` default decided the layer for a
      // form that binds no `record` at all. The refusal is unchanged — same id,
      // same `error`, same one finding; only the ROOT it prescribes moved to the
      // one this surface actually binds. (That the pin had to change is the
      // measurement: an assertion was holding the wrong prescription in place.)
      expect(bareFindings(metaForm('status == active')).map((f) => f.hint))
        .toEqual([expect.stringContaining('`data.status`')]);
      expect(bareFindings(metaForm('active == data.type'))).toHaveLength(1);
      expect(bareFindings(metaForm('data.type == active && active'))).toHaveLength(1);
      // A macro body produces no replacement finding, so nothing stands down.
      expect(bareFindings(metaForm('data.tags.all(t, t == active)'))).toHaveLength(1);
    });

    it('is scoped to the metadata-editing surface — a runtime view is untouched', () => {
      // A runtime `*.view.ts` predicate goes to real CEL, where a path on the
      // right is perfectly legal and a bare word there IS a dropped root. No
      // replacement rule walks this shape, so standing down would be silence.
      const findings = bareFindings(formStack('record.status == active'));
      expect(findings).toHaveLength(1);
      expect(findings[0].hint).toContain('`record.active`');
    });
  });

  describe('the layer decides the prescribed root (ADR-0089 D3)', () => {
    it('a metadata-editing form is told to write `data.`, not `record.`', () => {
      const findings = bareFindings(formStack("layout == 'grid'"), { layer: 'metadata' });
      expect(findings).toHaveLength(1);
      expect(findings[0].hint).toContain('`data.layout`');
      expect(findings[0].hint).not.toContain('`record.layout`');
    });

    it('a runtime surface is told to write `record.`', () => {
      expect(bareFindings(formStack("layout == 'grid'"))[0].hint).toContain('`record.layout`');
    });
  });

  it('a field named after a CEL TYPE (`type`, `string`, …) is a measured blind spot', () => {
    // Not a bug to fix here, and not a false negative anyone can close cheaply:
    // `type` / `int` / `string` / `list` / `map` / `timestamp` … are identifiers
    // CEL itself declares (they denote type values), so `type == 'grid'` is a
    // TYPE-overload error to the checker, not an unknown variable — and
    // `firstUndeclaredReference` acts only on `Unknown variable`. Widening onto
    // the overload message would reject `type(record.x) == string`, which is
    // legitimate CEL, so the gate stays conservative: a missed catch, never a
    // false build error. Pinned so the next reader sees a decision, not a hole.
    expect(bareFindings(formStack("type == 'grid'"))).toEqual([]);
    expect(bareFindings(formStack("record.type == 'grid'"))).toEqual([]);
  });

  // ── The #4953 boundary, pinned rather than described ────────────────
  //
  // #4953 measured the SAME evaluator giving opposite verdicts on a total vs a
  // sparse record binding: `has(record.a)` is true/false and `record.a != null`
  // is false/FAULT depending on which the surface binds. Whichever way that
  // fork is settled, none of it changes THIS rule's verdict — a rootless
  // identifier resolves under neither binding, and a rooted one is never judged
  // here. These cases are the pin on that independence: if a later edit widens
  // the rule into key-level reasoning, they go red rather than the boundary
  // being quietly lost.
  describe('shapes that are legal under a SPARSE binding stay green (#4953)', () => {
    it.each([
      ['has(record.status)', 'the sparse-binding guard idiom'],
      ['record.status != null', 'the TOTAL-binding guard idiom — the opposite spelling'],
      ['has(record.a) && has(record.b) && record.a < record.b', 'the #4763 has()-only shape'],
      ['record.a != null && record.b != null && record.a < record.b', 'its total-binding counterpart'],
      ['!has(record.archived_at)', 'a negated presence test'],
    ])('%s stays clean (%s)', (predicate) => {
      expect(validateVisibilityPredicates(formStack(predicate))).toEqual([]);
    });
  });

  describe('what the rule deliberately does not reject', () => {
    it.each([
      ["record.tags.all(t, t != '')", 'a macro variable used BARE inside the comprehension body'],
      ['record.items.exists(i, i.qty > 0)', 'a macro variable used as a receiver'],
      ["['a', 'b'].exists(x, x == record.status)", 'a macro over a list literal'],
      ['record.lines.filter(l, l.amount > 0).size() > 0', 'a macro chained into a method call'],
    ])('%s — %s', (predicate) => {
      expect(validateVisibilityPredicates(formStack(predicate))).toEqual([]);
    });

    it.each([
      ["current_user.id == record.owner_id", 'the `current_user` root the schema documents'],
      ["'admin' in current_user.positions", 'the ADR-0068 role-membership shape'],
      ["page.selectedProjectId != ''", 'page state as `page.<var>`'],
      ['previous.status != record.status', 'the `previous` root the evaluator binds'],
      ["parent.status == 'paid'", 'a master-detail header injected as `parent`'],
    ])('%s — %s', (predicate) => {
      expect(validateVisibilityPredicates(formStack(predicate))).toEqual([]);
    });

    it('an UNKNOWN root is left to the wrong-root rules — this one only judges rootless refs', () => {
      // `my_record` resolves to nothing either, but it is a root-shaped defect:
      // ADR-0089 D3b owns the two directions the spec states, and the legal-root
      // list is not yet trustworthy enough to gate on (#6146). Widening here
      // would also make the D3b fixture below a false positive of this rule.
      expect(bareFindings(formStack('my_record.x == 1'))).toEqual([]);
      expect(bareFindings(formStack("record.data == 1"))).toEqual([]);
    });

    it('a predicate that does not parse yields no BARE-IDENTIFIER verdict (the syntax rule owns it)', () => {
      // This case used to assert whole-rule SILENCE on an unparseable source,
      // on the policy that a second syntax verdict must not be invented. #6253
      // ruled that policy wrong for this surface specifically — nothing else
      // judges view/page syntax — so the source is now reported, by
      // `visibility-predicate-syntax`. What survives from the old assertion is
      // the division of labour: the declaredness check needs an AST and gets
      // none, so `country` is NOT also reported as a bare identifier.
      expect(bareFindings(formStack('country === "USA"'))).toEqual([]);
      expect(bareFindings(formStack('status =='))).toEqual([]);
    });

    it('an absent / empty predicate is not a finding', () => {
      expect(validateVisibilityPredicates(formStack(undefined))).toEqual([]);
      expect(validateVisibilityPredicates(formStack('   '))).toEqual([]);
    });
  });

  describe('the finding really gates', () => {
    it('the registry entry is `gating`, so `error` reaches all three commands', () => {
      // `severity: 'error'` only fails a build because `authoring-rules.ts`
      // says this rule family gates and therefore runs on validate/build/lint
      // alike. Declared = enforced: without this entry the diagnostic would be
      // an `error` nobody runs everywhere (`authoring-rule-wiring.test.ts`
      // states the invariant; this is its per-rule pin).
      const entry = AUTHORING_RULES.find((r) => r.name === 'validateVisibilityPredicates');
      expect(entry, 'validateVisibilityPredicates must be registered').toBeDefined();
      expect(entry!.tier).toBe('gating');
      expect([...entry!.commands].sort()).toEqual(['build', 'lint', 'validate']);
    });

    it('a bare identifier ANYWHERE in the predicate is caught, not just at the head', () => {
      expect(bareFindings(formStack("record.type == 'a' ? record.x > 1 : status == 'b'"))).toHaveLength(1);
      expect(bareFindings(formStack('record.done && overdue'))[0].message).toContain('`overdue`');
    });

    it('an unknown root does not mask a real bare identifier alongside it', () => {
      // The declare-then-check order matters: `my_record` is declared as a
      // namespace first, so the checker's verdict lands on `status` rather than
      // stopping at the root it is not this rule's job to judge.
      const findings = bareFindings(formStack("my_record.x == 1 && status == 'a'"));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('`status`');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
// `visibility-predicate-syntax` — #6253 (maintainer ruling 2026-08-07:
// blocking error, same severity as every other predicate surface; no warning
// tier and no exception for this surface).
//
// The surface this closes: `validate-expressions.ts` (ADR-0032) runs
// `validateExpression` over every predicate it walks, but it walks objects /
// flows / actions / sharingRules / hooks and never `views` / `pages`. The rules
// that DO walk views/pages all declined the syntax verdict so as not to invent a
// second one — correct wherever `validateExpression` runs alongside, and wrong
// here, where nothing did. Net effect before this rule: `country === "USA"`
// built clean and then failed OPEN at runtime (#5149).
// ─────────────────────────────────────────────────────────────────────

/** Only the syntax findings, for assertions that ignore the other three rules. */
function syntaxFindings(stack: Record<string, unknown>, opts?: { layer: 'runtime' | 'metadata' }) {
  return validateVisibilityPredicates(stack, opts).filter((f) => f.rule === VISIBILITY_PREDICATE_SYNTAX);
}

describe('visibility-predicate-syntax (#6253)', () => {
  describe('the acceptance pair', () => {
    it('`===` is an ERROR whose message names the token and shows the CEL spelling', () => {
      // `country === "USA"` is the fixture-proven shape: `packages/spec/src/ui/
      // view.test.ts` writes it at :1126 / :1240 / :1245 / :1291 / :1373, which
      // is what the issue cites as evidence that authors reach for it.
      const findings = validateVisibilityPredicates(formStack('country === "USA"'));

      // The WHOLE reported set, not just "a syntax finding is present" — so the
      // bare-identifier rule staying out of the way is pinned here too.
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_PREDICATE_SYNTAX]);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('views[0].sections[0].fields[0]');
      expect(findings[0].where).toBe('view "task_form"');

      // Self-correcting, per the ruling: name the offending token, show the CEL
      // spelling. The raw parser message does neither — cel-js says
      // `Unexpected character: =` and points a caret, which tells an author
      // nothing about `==`.
      expect(findings[0].hint).toContain('`===`');
      expect(findings[0].hint).toContain('`==`');
      // The front end's own diagnostic is quoted rather than paraphrased, and
      // the predicate is echoed so the finding is self-contained.
      expect(findings[0].message).toContain('Unexpected character: =');
      expect(findings[0].message).toContain('country === "USA"');
      // The consequence is stated, because on screen it is invisible.
      expect(findings[0].message).toContain('#5149');
    });

    it('the CEL spelling of the SAME predicate is clean — paired so it cannot pass vacuously', () => {
      // A lone "no syntax finding is reported" assertion is green whenever the
      // feature is absent, so it can never detect a regression. Pairing it with
      // the positive case in one test fixes that: delete the rule and the FIRST
      // expectation goes red.
      expect(syntaxFindings(formStack('country === "USA"'))).toHaveLength(1);
      expect(validateVisibilityPredicates(formStack("record.country == 'USA'"))).toEqual([]);
    });
  });

  describe('every non-CEL spelling in the table names its own token', () => {
    // Each row is measured against the canonical front end — `parseCelToAst`
    // really does refuse all of these — so none of them is a guessed hint.
    it.each([
      ['country === "USA"', '===', '=='],
      ['country !== "USA"', '!==', '!='],
      ["record.country <> 'USA'", '<>', '!='],
      ["record.a == 1 and record.b == 2", 'and', '&&'],
      ["record.a == 1 or record.b == 2", 'or', '||'],
      ['not record.archived', 'not', '!'],
      ["record.status = 'open'", '=', '=='],
    ])('%s → names `%s`, prescribes `%s`', (predicate, wrote, cel) => {
      const findings = syntaxFindings(formStack(predicate));
      expect(findings).toHaveLength(1);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].hint).toContain(`\`${wrote}\``);
      expect(findings[0].hint).toContain(`\`${cel}\``);
    });

    it('a fault with no single-token equivalent still reports, with the parser\'s own words', () => {
      // `status ==` is a truncated expression: nothing to swap, so the hint
      // falls back to the general shape instead of inventing a token.
      const findings = syntaxFindings(formStack('status =='));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('Unexpected token: EOF');
      expect(findings[0].hint).toContain("record.status == 'open'");
    });

    it('blames the operator that actually broke it, not one quoted inside a string', () => {
      // The predicate fails on `and`; the `===` sits inside a string literal and
      // is none of the reason. Blaming it would send the author to edit a
      // perfectly good literal. (String literals are blanked before the scan.)
      const findings = syntaxFindings(formStack("record.msg == 'a === b' and record.n > 1"));
      expect(findings).toHaveLength(1);
      expect(findings[0].hint).toContain('`and`');
      expect(findings[0].hint).not.toContain('`===`');
    });

    it('a non-CEL operator INSIDE a string literal is not a fault at all', () => {
      // Same string, no `and` — this parses, so there is no finding to word.
      expect(validateVisibilityPredicates(formStack("record.msg == 'a === b'"))).toEqual([]);
    });
  });

  describe('the boundaries', () => {
    it('an absent / blank predicate is NOT a syntax fault', () => {
      // `parseCelToAst` returns null for an empty source too, so without an
      // explicit guard this rule would report "no predicate" as broken CEL.
      // Paired with a live case so the assertion can actually fail.
      expect(syntaxFindings(formStack('country === "USA"'))).toHaveLength(1);
      expect(validateVisibilityPredicates(formStack(undefined))).toEqual([]);
      expect(validateVisibilityPredicates(formStack('   '))).toEqual([]);
      expect(validateVisibilityPredicates(formStack(''))).toEqual([]);
    });

    it('exactly ONE finding per broken predicate — the syntax rule, not also the bare-ref rule', () => {
      // `country` is rootless as well as mis-spelled, but a source with no AST
      // yields no identifiers to judge. Asserting the whole set (not just "a
      // syntax finding exists") is what pins the exclusivity.
      expect(validateVisibilityPredicates(formStack('country === "USA"')).map((f) => f.rule))
        .toEqual([VISIBILITY_PREDICATE_SYNTAX]);
      // …and the converse: a source that PARSES is judged by the bare-ref rule
      // and never by this one.
      expect(validateVisibilityPredicates(formStack("status == 'active'")).map((f) => f.rule))
        .toEqual([VISIBILITY_BARE_IDENTIFIER]);
    });

    it('does NOT widen to type-checking — the CEL-type blind spot stays a blind spot', () => {
      // `type == 'grid'` PARSES; only `celEngine.compile`'s type checker rejects
      // it (`no such overload: type == string`). Routing this rule through
      // `compile` / `validateExpression` would silently overturn the deliberate,
      // separately-pinned decision to stay conservative there — and would widen
      // an error-level gate from "does not parse" to "does not type-check" on a
      // surface whose predicates are overwhelmingly `dyn`. The ruling said
      // syntax; the parse verdict is exactly syntax.
      expect(validateVisibilityPredicates(formStack("type == 'grid'"))).toEqual([]);
      // The legitimate CEL the overload message cannot be told apart from.
      expect(validateVisibilityPredicates(formStack('type(record.x) == string'))).toEqual([]);
    });

    it('a `DEFAULT_LIMITS` overrun is NOT this rule any more — it is `over-budget` (#7217)', () => {
      // Was: "reported too, in the front end's own words", asserted under
      // `visibility-predicate-syntax`. #7217 keeps the verdict and moves the
      // wording and the id; this case is now the exclusivity pin for the split,
      // and its full coverage lives in the `over-budget` block below.
      const overrun = `record.a${' + record.b'.repeat(400)}`;
      expect(syntaxFindings(formStack(overrun))).toEqual([]);
      expect(validateVisibilityPredicates(formStack(overrun)).map((f) => f.rule))
        .toEqual([VISIBILITY_PREDICATE_OVER_BUDGET]);
    });

    it.each([
      ['record.a == 1 && record.b == 2', 'the `&&` CEL spells `and` as'],
      ['record.a == 1 || record.b == 2', 'the `||` CEL spells `or` as'],
      ['!record.archived', 'the `!` CEL spells `not` as'],
      ["record.status != 'open'", 'the `!=` CEL spells `<>` as'],
      ["record.tags.all(t, t != '')", 'a comprehension macro'],
      ["record.type == 'a' ? record.x > 1 : record.y == 'b'", 'a ternary'],
      ["record.type in ['lookup', 'master_detail']", 'lowercase `in` — a REAL CEL operator, unlike SQL `IN`'],
      ["has(record.a) && record.b != null", 'both guard idioms at once'],
    ])('%s parses and is not reported (%s)', (predicate) => {
      expect(syntaxFindings(formStack(predicate))).toEqual([]);
    });
  });

  describe('every carrier the schema declares, and both layers', () => {
    it('a form SECTION predicate', () => {
      const stack = { views: [{ name: 'f', sections: [{ visibleWhen: 'country === "USA"', fields: [] }] }] };
      expect(syntaxFindings(stack).map((f) => f.path)).toEqual(['views[0].sections[0]']);
    });

    it('a PAGE COMPONENT predicate', () => {
      const stack = {
        pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibleWhen: 'kind === "a"' }] }] }],
      };
      const findings = syntaxFindings(stack);
      expect(findings.map((f) => f.path)).toEqual(['pages[0].regions[0].components[0]']);
      expect(findings[0].where).toBe('page "p"');
    });

    it('reads the value through the deprecated `visibleOn` alias (syntax ALONE since #6318)', () => {
      // Was an "alias + syntax, both reported" pair, whose point was that two
      // INDEPENDENT defects on one element both report. The alias half is
      // retired, so what is left is the syntax verdict reached through the
      // deprecated key — and the independence claim it was making now belongs
      // to the syntax/bare-ref exclusivity pin, which states it directly.
      const stack = { views: [{ name: 'f', sections: [{ visibleOn: 'status === "x"', fields: [] }] }] };
      expect(validateVisibilityPredicates(stack).map((f) => f.rule)).toEqual([VISIBILITY_PREDICATE_SYNTAX]);
    });

    it('reads the value through the deprecated page-side `visibility` alias', () => {
      const stack = {
        pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibility: 'shown === true' }] }] }],
      };
      expect(syntaxFindings(stack)).toHaveLength(1);
    });

    it('resolves a `{ dialect, source }` envelope the same as a bare string', () => {
      expect(syntaxFindings(formStack({ dialect: 'cel', source: 'country === "USA"' }))).toHaveLength(1);
    });

    it('reaches a container\'s `formViews.<key>` — the shape a real stack emits', () => {
      const stack = {
        views: [{ object: 'showcase_task', formViews: { edit: { sections: [{ fields: [{ field: 'n', visibleWhen: 'country === "USA"' }] }] } } }],
      };
      expect(syntaxFindings(stack).map((f) => f.path)).toEqual([
        'views[0].formViews.edit.sections[0].fields[0]',
      ]);
    });

    it('is layer-agnostic — a syntax fault is a syntax fault on a metadata form too', () => {
      // Unlike the root rules, nothing about "does it parse" depends on which
      // namespace the surface binds.
      expect(syntaxFindings(formStack('country === "USA"'), { layer: 'metadata' })).toHaveLength(1);
      expect(syntaxFindings(formStack('country === "USA"'))).toHaveLength(1);
    });
  });

  it('the registry entry already gates, so this `error` reaches all three commands', () => {
    // `severity: 'error'` only fails a build because `authoring-rules.ts` marks
    // the family `gating` and runs it on validate/build/lint alike. That entry
    // was already `gating` (#6128 promoted it), so #6253 needed no registry
    // change — this pins that it is still true rather than assuming it.
    const entry = AUTHORING_RULES.find((r) => r.name === 'validateVisibilityPredicates');
    expect(entry, 'validateVisibilityPredicates must be registered').toBeDefined();
    expect(entry!.tier).toBe('gating');
    expect([...entry!.commands].sort()).toEqual(['build', 'lint', 'validate']);
  });
});

// ─────────────────────────────────────────────────────────────────────
// `visibility-predicate-over-budget` — #7217.
//
// The defect this closes is an INSTRUCTION that makes an obedient author
// worse. An over-budget `visibleWhen` is flawless bare CEL; the gate refused it
// (correctly) as "not valid CEL" (false) and prescribed the dialect ("write
// `==` not `===`, `&&` not `and` …"), which is advice that cannot succeed. An
// LLM author follows the last sentence it was handed, rewrites operators that
// were never wrong, and returns with the same 80-clause predicate.
//
// The verdict is untouched: the same sources are refused before and after, at
// the same severity, one finding each. Only the class, the id and the words
// changed. Both directions are pinned deliberately — a fix that turned EVERY
// refusal into a size refusal would be green on the first block below, which is
// why the syntax block re-asserts the dialect wording it must not lose.
// ─────────────────────────────────────────────────────────────────────

/** Only the over-budget findings. */
function overBudgetFindings(stack: Record<string, unknown>, opts?: { layer: 'runtime' | 'metadata' }) {
  return validateVisibilityPredicates(stack, opts).filter((f) => f.rule === VISIBILITY_PREDICATE_OVER_BUDGET);
}

/** The escalation's own shape — 80-term conjunction, `maxAstNodes` (#6833 / #7073). */
const OVER_AST_NODES = Array.from({ length: 80 }, (_, i) => `record.f${i} == ${i}`).join(' && ');
/** 60-level parenthesis nest — `maxDepth`. Recursion that leaves no AST node. */
const OVER_DEPTH = `${'('.repeat(60)}record.a${')'.repeat(60)} == 1`;
/** 200-element list literal — `maxListElements`. */
const OVER_LIST = `record.id in [${Array.from({ length: 200 }, (_, i) => `'u${i}'`).join(',')}]`;

describe('visibility-predicate-over-budget (#7217)', () => {
  describe('the acceptance pair', () => {
    it('an over-budget but valid predicate names the SIZE fault and the bound, never the dialect', () => {
      const findings = validateVisibilityPredicates(formStack(OVER_AST_NODES));

      // The whole reported set: one finding, the new id, still gating.
      expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_PREDICATE_OVER_BUDGET]);
      expect(findings[0].severity).toBe('error');
      expect(findings[0].path).toBe('views[0].sections[0].fields[0]');
      expect(findings[0].where).toBe('view "task_form"');

      // ⛔ The headline was FALSE: this IS valid CEL.
      expect(findings[0].message).not.toContain('is not valid CEL');
      expect(findings[0].message).toContain('syntactically valid CEL');
      // The front end's own summary is quoted, and the bound is NAMED with the
      // platform's value for it — which is what "shrink it to fit" needs.
      expect(findings[0].message).toContain('Exceeded maxAstNodes (256)');
      expect(findings[0].message).toContain('`maxAstNodes` budget (platform limit 256)');
      // The consequence is unchanged: it still falls OPEN on screen.
      expect(findings[0].message).toContain('#5149');

      // ⛔ The defect itself: the dialect prescription must not reach this class.
      expect(findings[0].hint).not.toMatch(/bare CEL/);
      expect(findings[0].hint).not.toContain('`===`');
      expect(findings[0].hint).toContain('SIZE fault, not a dialect mistake');
      expect(findings[0].hint).toContain("`record.f in ['a', 'b', …]`");
    });

    it('the SAME predicate under budget is clean — paired so it cannot pass vacuously', () => {
      // Delete the rule and the first expectation goes red; loosen the verdict
      // (report everything) and the second does.
      expect(overBudgetFindings(formStack(OVER_AST_NODES))).toHaveLength(1);
      const underBudget = Array.from({ length: 8 }, (_, i) => `record.f${i} == ${i}`).join(' && ');
      expect(validateVisibilityPredicates(formStack(underBudget))).toEqual([]);
    });
  });

  it.each([
    ['maxAstNodes (80-term conjunction)', OVER_AST_NODES, 'maxAstNodes', 256],
    ['maxDepth (60-level nest)', OVER_DEPTH, 'maxDepth', 32],
    ['maxListElements (200-element list)', OVER_LIST, 'maxListElements', 64],
  ])('%s — the bound that was actually exceeded is the one named', (_name, source, limit, value) => {
    // Not one hard-coded bound: the name and its value are read off the front
    // end's structured overrun, so a source that overruns a DIFFERENT axis is
    // sent to shorten that axis and not `maxAstNodes` by default.
    const findings = overBudgetFindings(formStack(source as string));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain(`\`${limit}\` budget (platform limit ${value})`);
    expect(findings[0].hint).toContain('SIZE fault, not a dialect mistake');
  });

  it('a genuine dialect fault keeps the #6253 id, message and hint verbatim', () => {
    // The flipped pin. The obvious way to get #7217 wrong is to turn EVERY
    // refusal into a size refusal — green on every case above, and a total loss
    // of the wording #6253 shipped.
    const findings = validateVisibilityPredicates(formStack('country === "USA"'));
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_PREDICATE_SYNTAX]);
    expect(findings[0].message).toContain('is not valid CEL');
    expect(findings[0].hint).toContain('`===` is not a CEL operator');
    expect(findings[0].hint).not.toMatch(/SIZE fault/);
  });

  it('a dialect fault with no single-token equivalent keeps the FALLBACK dialect hint', () => {
    // The arm the card names: the fallback hint fires when no NON_CEL_SPELLINGS
    // row matches — which is exactly the arm an over-budget source used to land
    // in. It must still fire for a source that genuinely is not CEL.
    const findings = validateVisibilityPredicates(formStack('record.stage @@ "won"'));
    expect(findings.map((f) => f.rule)).toEqual([VISIBILITY_PREDICATE_SYNTAX]);
    expect(findings[0].hint).toContain('Visibility predicates are bare CEL');
    expect(findings[0].hint).not.toMatch(/SIZE fault/);
  });

  it('still exactly ONE finding — the bare-identifier rule stays out of the way', () => {
    // An over-budget source yields no AST, so there are no identifiers to judge.
    // The exclusivity property #6253/#6128 established survives the split.
    const rootless = Array.from({ length: 80 }, (_, i) => `f${i} == ${i}`).join(' && ');
    expect(validateVisibilityPredicates(formStack(rootless)).map((f) => f.rule))
      .toEqual([VISIBILITY_PREDICATE_OVER_BUDGET]);
  });

  it('elides the echoed predicate — one runaway expression cannot flood the console', () => {
    const findings = overBudgetFindings(formStack(OVER_AST_NODES));
    expect(findings[0].message).not.toContain(OVER_AST_NODES);
    expect(findings[0].message).toContain('...');
  });

  it('a blank predicate is still not a fault of any class', () => {
    // `parseCelToAstWithReason` answers `empty` rather than `parse`; paired with
    // a live case so the assertion can actually fail.
    expect(overBudgetFindings(formStack(OVER_AST_NODES))).toHaveLength(1);
    expect(validateVisibilityPredicates(formStack('   '))).toEqual([]);
    expect(validateVisibilityPredicates(formStack(undefined))).toEqual([]);
  });

  it('speaks the LAYER\'s binding root in its remedy', () => {
    // A `*.form.ts` author binds `data`, so a `record.`-flavoured example would
    // be a second wrong prescription in a rule whose whole point is that the
    // prescription must be followable.
    const metadata = overBudgetFindings(formStack(OVER_AST_NODES), { layer: 'metadata' });
    expect(metadata).toHaveLength(1);
    expect(metadata[0].hint).toContain("`data.f in ['a', 'b', …]`");
    expect(metadata[0].hint).not.toContain('`record.f in');
  });

  it('reaches page components too — the id is not view-only', () => {
    const stack = {
      pages: [{ name: 'p', regions: [{ components: [{ type: 'element:text', visibleWhen: OVER_AST_NODES }] }] }],
    };
    const findings = overBudgetFindings(stack);
    expect(findings.map((f) => f.path)).toEqual(['pages[0].regions[0].components[0]']);
    expect(findings[0].where).toBe('page "p"');
  });
});

// ─────────────────────────────────────────────────────────────────────
// #8042 — the emitted prose names the SURFACE, never one authoring route's
// filename.
//
// Since #7815 the metadata layer is reachable at the runtime publish gate
// (`authoring-rules.ts` → `validateVisibilityPredicates(stack)`, no options):
// a form view declaring `data: { provider: 'schema', schemaId }` is judged
// there on its own say-so. That door's audience is a Studio / REST `/meta` /
// MCP author who has no `*.form.ts` to open, so a message that justified the
// layer by naming that file prescribed correctly and then explained itself
// somewhere the reader cannot go.
//
// Every case below calls with NO options, which IS the gate's call shape.
// Nothing here judges severity, ids or firing conditions — those are pinned
// above and by `runtime-gate.test.ts`, and #8042 changed none of them.
// ─────────────────────────────────────────────────────────────────────
describe('emitted prose names the surface, not a source file (#8042)', () => {
  /** A schema-bound metadata-editing form — the shape the publish gate meets. */
  const publishedForm = (predicate: string) => ({
    views: [{
      name: 'field_editor',
      data: { provider: 'schema', schemaId: 'field' },
      sections: [{ fields: [{ field: 'notes', visibleWhen: predicate }] }],
    }],
  });

  /** Any `*.view.ts` / `*.page.ts` / `*.form.ts` spelling, in any position. */
  const SOURCE_FILENAME = /\.(form|view|page)\.ts/;

  it('the mis-layered advisory explains the metadata layer without naming a file', () => {
    const f = validateVisibilityPredicates(publishedForm("record.type == 'grid'"))
      .find((x) => x.rule === VISIBILITY_ROOT_MISLAYERED);
    // Paired first: a silence would satisfy every `not.toContain` below.
    expect(f, 'the advisory must still fire on a `record.`-rooted schema-bound form').toBeDefined();
    expect(f!.message).not.toMatch(SOURCE_FILENAME);
    expect(f!.hint).not.toMatch(SOURCE_FILENAME);
    // The prescription is byte-for-byte what it was: same root, same severity.
    expect(f!.severity).toBe('warning');
    expect(f!.message).toContain('metadata-editing form');
    expect(f!.hint).toBe(
      'Metadata-editing forms bind `data` (the row under edit). Use e.g. '
      + "`data.type == 'grid'` instead of `record.type == 'grid'`.",
    );
  });

  it("the bare-identifier hint still prescribes `data.`, and still names no file", () => {
    const f = bareFindings(publishedForm('status == active'))[0];
    expect(f, 'the refusal must still fire on a bare word in the LEFT position').toBeDefined();
    expect(f.severity).toBe('error');
    expect(f.hint).toContain('`data.status`');
    expect(f.hint).not.toMatch(SOURCE_FILENAME);
  });

  it('the RUNTIME arm is file-free too — the mirror sentence carried the same defect', () => {
    // A view or page published through Studio has no `*.view.ts` either, and
    // this arm explained the forbidden `data.` root by naming `*.form.ts`. Same
    // class, other direction; fixing only the graded arm would have left half
    // the sentence pointing at a file.
    const f = validateVisibilityPredicates(formStack("data.type == 'grid'"))[0];
    expect(f.rule).toBe(VISIBILITY_ROOT_MISLAYERED);
    expect(f.severity).toBe('warning');
    expect(f.message).not.toMatch(SOURCE_FILENAME);
    expect(f.message).toContain('`data.`');
    // Untouched — the runtime hint was already written surface-first.
    expect(f.hint).toContain("`record.status == 'open'`");
  });

  it('no finding this module emits names a source file — the whole family, both layers', () => {
    // The mechanical pin. One case per rule id per layer, so a future edit that
    // reintroduces a filename in ANY arm goes red here rather than at a
    // tenant's publish door.
    const cases: Array<[string, Record<string, unknown>]> = [
      ['mislayered · runtime', formStack("data.type == 'grid'")],
      ['mislayered · metadata', publishedForm("record.type == 'grid'")],
      ['bare-identifier · runtime', formStack("status == 'active'")],
      ['bare-identifier · metadata', publishedForm("status == 'active'")],
      ['syntax · runtime', formStack('country === "USA"')],
      ['syntax · metadata', publishedForm('country === "USA"')],
      ['over-budget · runtime', formStack(OVER_AST_NODES)],
      ['over-budget · metadata', publishedForm(OVER_AST_NODES)],
    ];
    for (const [name, stack] of cases) {
      const findings = validateVisibilityPredicates(stack);
      // Non-vacuous: every row must actually produce the finding it is named for.
      expect(findings.length, `${name} produced nothing — the case has gone blind`).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.message, `${name} message`).not.toMatch(SOURCE_FILENAME);
        expect(f.hint, `${name} hint`).not.toMatch(SOURCE_FILENAME);
      }
    }
  });

  it('the file-aware caller reads the SAME prose — this changed strings, not a code path', () => {
    // `MISLAYER_BY_LAYER` is keyed by LAYER, not by how the layer was decided,
    // so a caller passing `opts.layer = 'metadata'` (the file-aware caller,
    // linting a real `*.form.ts`) reads exactly what the published-through-
    // Studio author reads. Pinned because the tempting shape of this fix — fork
    // the wording by caller and give the file-aware one its filename back — is
    // two messages for one condition, which #5240 rules out.
    const viaOption = validateVisibilityPredicates(formStack("record.type == 'grid'"), { layer: 'metadata' })
      .find((x) => x.rule === VISIBILITY_ROOT_MISLAYERED);
    const viaDerivation = validateVisibilityPredicates(publishedForm("record.type == 'grid'"))
      .find((x) => x.rule === VISIBILITY_ROOT_MISLAYERED);
    expect(viaOption, 'the file-aware path must still reach the metadata arm').toBeDefined();
    expect(viaDerivation).toBeDefined();
    expect(viaOption!.message).toBe(viaDerivation!.message);
    expect(viaOption!.hint).toBe(viaDerivation!.hint);
  });

  it('the file-aware CALLER contract keeps its filename — this was not a find-and-replace', () => {
    // The discrimination that IS the card. What was wrong is prose addressed to
    // an AUTHOR who may hold no file; `opts.layer` is addressed to a CALLER that
    // is linting one, where `*.form.ts` is both accurate and the useful word. A
    // blanket strip would have deleted that too, and would pass every assertion
    // above — this is the one that notices.
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'validate-visibility-predicates.ts'),
      'utf8',
    );
    expect(source).toContain('a file-aware caller linting a `*.form.ts` does');
    expect(source).toContain('when linting a `*.form.ts` metadata-editing form');
  });
});
