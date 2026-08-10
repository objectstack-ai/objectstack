// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #6073 — what `AuthoringRuleInputTier`'s `normalized` value actually buys.
//
// ## Why this file exists
//
// The tier's doc comment used to justify itself with three examples — "the rules
// that need it check keys the parse strips (a flat list view in `views: []`,
// `userFilters` on an object list view, a `visibleOn` alias): by the time
// `result.data` exists the evidence is gone". All three were measured FALSE
// under #6073, each for a different reason, and a comment is not something CI
// can keep honest. Every claim the corrected comment makes is pinned here, so
// the next reader inherits the measurement instead of re-deriving it — and so a
// change that silently restores one of the old premises goes red.
//
// The mechanism half was never in doubt (#5693 measured it, this file re-pins
// it): `defineStack` PARSES at definition time, so for a TS config — the
// documented and universal way to declare a stack — the value the CLI hands the
// registry is already `result.data`, and re-normalizing it cannot resurrect
// anything the parse resolved. What was in doubt was the CONSEQUENCE, and the
// consequence is not the blind spot it looked like: the two view schemas the
// comment cited went strict at #4001, so they REFUSE where the comment says they
// STRIP, and refuse earlier and better than any lint rule could.
//
// ## What this file does NOT claim
//
// It does not claim the tier is useless. The reason
// `validate-functional-completeness.ts` gives for it is real and pinned in the
// last describe block: on the raw (non-`defineStack`) door, `os lint` — which
// never parses — still reports rule findings on a stack whose schema step would
// have failed. `normalized` means "needs no PARSED stack", never "is guaranteed
// to see pre-parse evidence".

import { describe, expect, it, vi } from 'vitest';
import { defineStack, normalizeStackInput } from '@objectstack/spec';

import { validateListViewMode } from './validate-list-view-mode.js';
import { validateViewContainers } from './validate-view-containers.js';
import { validateVisibilityPredicates } from './validate-visibility-predicates.js';
import { runAuthoringRules } from './authoring-rules.js';

type AnyRec = Record<string, unknown>;

const manifest = {
  id: 'com.example.tier',
  namespace: 'tier',
  version: '1.0.0',
  type: 'app',
  name: 'Tier Probe',
  engines: { protocol: '^17' },
};

/** `defineStack` warns on the D2 conversion channel; keep test output clean. */
function quietly<T>(fn: () => T): { value?: T; error?: Error; warnings: string[] } {
  const warnings: string[] = [];
  const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    warnings.push(args.join(' '));
  });
  try {
    return { value: fn(), warnings };
  } catch (e) {
    return { error: e as Error, warnings };
  } finally {
    spy.mockRestore();
  }
}

/**
 * The value the three commands hand `runAuthoringRules` for a `defineStack`
 * config: `loadConfig()` returns the module's default export (= `result.data`),
 * and `lint.ts` / `validate.ts` / `compile.ts` then call `normalizeStackInput`
 * on THAT. Modelled here rather than imported so this package does not depend
 * on the CLI; the shape is asserted against reality in the first block.
 */
const cliTierFor = (stack: AnyRec): AnyRec =>
  normalizeStackInput(defineStack(stack as never) as unknown as AnyRec);

// ───────────────────────────────────────────────────────────────────────────
describe('the mechanism: for a defineStack config the `normalized` tier is POST-parse', () => {
  const flowStack = {
    manifest,
    flows: [
      {
        name: 'tier_flow',
        label: 'Tier Flow',
        type: 'schedule',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
      },
    ],
  };

  it('carries parse-time DEFAULTS that a truly pre-parse stack does not have', () => {
    // The tell #5693 tripped over: `os lint` printed a message arm reachable only
    // when `flow.runAs` IS a string, which only `FlowSchema`'s `.default('user')`
    // can produce. If this ever goes back to `undefined`, the whole premise below
    // changes and the comment on `AuthoringRuleInputTier` must be re-measured.
    const trulyPreParse = normalizeStackInput(structuredClone(flowStack)) as AnyRec;
    const cliTier = quietly(() => cliTierFor(structuredClone(flowStack)));
    expect(cliTier.error).toBeUndefined();

    const pre = (trulyPreParse.flows as AnyRec[])[0];
    const post = (cliTier.value!.flows as AnyRec[])[0];

    expect(pre.runAs).toBeUndefined();
    expect(pre.status).toBeUndefined();
    expect(post.runAs).toBe('user');
    expect(post.status).toBe('draft');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('premise 1 (FALSE): "the parse strips a flat list view in `views: []`"', () => {
  const flatView = {
    name: 'tier_flat',
    label: 'Tier Flat',
    type: 'grid',
    data: { provider: 'object', object: 'tier_task' },
    columns: [{ field: 'name' }],
  };

  it('defineStack REFUSES it by name instead — ViewSchema is strict since #4001', () => {
    const { error } = quietly(() => defineStack({ manifest, views: [flatView] } as never));
    expect(error).toBeDefined();
    // The schema names every offending key AND prints the wrap-it fix, which is
    // strictly more than `view-container-shape` would have said.
    expect(error!.message).toContain('views.0');
    expect(error!.message).toContain('Unrecognized key(s) on this view container');
    for (const key of ['type', 'data', 'columns']) expect(error!.message).toContain(key);
    expect(error!.message).toContain('defineView({ list:');
  });

  it('still fires on the doors the strict parse never sees (raw input, no defineStack)', () => {
    // `os lint` on a raw object-literal config, `defineStack(x, { strict: false })`,
    // and direct API callers all reach the rule with the flat shape intact. This
    // is the arm that keeps the `looksFlat` branch alive — deleting it would take
    // the only diagnostic those three doors get.
    const findings = validateViewContainers(
      normalizeStackInput({ manifest, views: [flatView] }) as AnyRec,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('view-container-shape');
    expect(findings[0].message).toContain('Flat list-view object');
  });

  it('the arm that DOES survive the parse is the all-slots-empty container', () => {
    // Every key here is declared, so nothing is refused and nothing is stripped:
    // this is the shape `validateViewContainers` is genuinely the only reporter of.
    const emptyContainer = { manifest, views: [{ name: 'tier_empty' }] };
    const cli = quietly(() => cliTierFor(structuredClone(emptyContainer)));
    expect(cli.error).toBeUndefined();

    const findings = validateViewContainers(cli.value!);
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('view-container-shape');
    expect(findings[0].message).toContain('defines no views');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('premise 2 (FALSE): "the parse strips `userFilters`/`quickFilters` on an object list view"', () => {
  const objectWithBadFilters = {
    manifest,
    objects: [
      {
        name: 'tier_task',
        label: 'Task',
        fields: {
          name: { type: 'text', label: 'Name' },
          status: { type: 'text', label: 'Status' },
        },
        listViews: {
          my_pending: {
            label: 'My Pending',
            type: 'grid',
            columns: [{ field: 'name' }],
            quickFilters: [{ field: 'status', label: 'Status' }],
            userFilters: { element: 'tabs', fields: ['status'] },
          },
        },
      },
    ],
  };

  it('defineStack REFUSES both — strict key rejection AND an enum refusal', () => {
    const { error } = quietly(() => defineStack(structuredClone(objectWithBadFilters) as never));
    expect(error).toBeDefined();
    // `quickFilters` — refused as an unrecognized KEY, with the rename suggestion.
    expect(error!.message).toContain('Unrecognized key(s) on this list view');
    expect(error!.message).toContain('quickFilters');
    // `element: 'tabs'` — refused as an invalid VALUE. Two different rejection
    // mechanisms; both louder than the rule, both at definition time.
    expect(error!.message).toContain("Invalid value 'tabs'");
    expect(error!.message).toContain('dropdown');
  });

  it('still fires on raw input, which is the door that keeps the rule honest', () => {
    const findings = validateListViewMode(
      normalizeStackInput(structuredClone(objectWithBadFilters)) as AnyRec,
    );
    expect(findings.map((f) => f.rule)).toEqual([
      'list-view-filters-in-views-mode',
      'list-view-filters-in-views-mode',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('premise 3 (FALSE): "the `visibleOn` alias survives until the parse"', () => {
  // The fold is an ADR-0087 D2 conversion inside `normalizeStackInput` — one
  // layer BEFORE this tier — not a parse-time `.transform()`. So the alias is
  // gone from the tier's own input on every door, `os lint` included.
  //
  // #6318 acted on that measurement: the alias-KEY rule this premise was
  // written to justify (`visibility-alias-deprecated`) has been RETIRED, so the
  // assertions below no longer count its findings. They pin the mechanism that
  // outlives it, which is what makes the retirement safe to keep:
  //
  //   * the KEY does not cross the fold — nothing downstream can judge it;
  //   * the VALUE does cross it intact — which is why the three surviving rules
  //     work on this tier and were not swept in;
  //   * the author is not silent — the D2 conversion notice fires in
  //     `defineStack`, and that notice IS the recorded guard for this surface.
  //
  // Read `toHaveLength(0)` on the raw leg as "the alias key is nobody's verdict
  // any more"; the fold measurement itself now lives in the VALUE assertions,
  // which are non-empty and can actually fail.
  /**
   * The three spec-valid alias sites, each carrying `predicate` under its
   * DEPRECATED key. Parameterised on the predicate so the same three shapes can
   * be measured twice: once with a clean value (nothing to find but the retired
   * key) and once with a bare-identifier value (a VALUE defect the surviving
   * gate must still reach through the fold).
   */
  const aliasSitesWith = (predicate: string): Array<[string, AnyRec]> => [
    ['views[].form.sections[]', {
      manifest,
      views: [{
        name: 'tier_form',
        form: { type: 'simple', sections: [{ label: 'S', visibleOn: predicate, fields: [{ field: 'name' }] }] },
      }],
    }],
    ['views[].formViews.edit.sections[]', {
      manifest,
      views: [{
        name: 'tier_form2',
        formViews: { edit: { type: 'simple', sections: [{ label: 'S', visibleOn: predicate, fields: [{ field: 'name' }] }] } },
      }],
    }],
    ['pages[].regions[].components[]', {
      manifest,
      pages: [{
        name: 'tier_page',
        label: 'P',
        type: 'home',
        object: 'tier_task',
        regions: [{ name: 'main', components: [{ type: 'element:text', visibility: predicate }] }],
      }],
    }],
  ];

  /** Clean, canonically-rooted predicate: the only thing wrong is the key spelling. */
  const aliasSites = aliasSitesWith('record.a == 1');
  /** Same three sites, predicate rooted nowhere (#5149 Repro 1) — a VALUE defect. */
  const aliasSitesBadValue = aliasSitesWith('approved');

  it.each(aliasSites)('%s: no rule judges the alias KEY any longer (#6318 retirement)', (_site, stack) => {
    // Both doors report nothing, and for TWO DIFFERENT reasons that must not be
    // conflated. Raw: the rule that would have judged the key is retired.
    // Normalized: the key is not even there — the D2 fold renamed it one layer
    // up. The `normalized` leg is a VACUOUS green after the retirement (it is
    // empty because no rule exists, not because of the fold), so it is labelled
    // as such and carries no weight on its own; the leg below is the one that
    // measures the fold.
    expect(validateVisibilityPredicates(structuredClone(stack))).toHaveLength(0);
    expect(validateVisibilityPredicates(normalizeStackInput(structuredClone(stack)) as AnyRec)).toEqual([]);
  });

  it.each(aliasSitesBadValue)(
    '%s: the KEY does not cross the fold but the VALUE does — measured on a NON-EMPTY finding set',
    (_site, stack) => {
      // The replacement for the vacuous green above, and the assertion that
      // actually measures the fold. Same three sites, but the predicate is now
      // a bare identifier — a VALUE defect. If the fold dropped the predicate
      // instead of renaming its key, or if the surviving gate stopped reaching
      // it, this set would be EMPTY and the assertion would fail. It cannot
      // pass by producing nothing, which is exactly what the leg above can do.
      const normalized = normalizeStackInput(structuredClone(stack)) as AnyRec;
      // The KEY is gone from the tier's own input …
      expect(JSON.stringify(normalized)).not.toContain('visibleOn');
      expect(JSON.stringify(normalized)).not.toContain('"visibility"');
      // … and the VALUE arrived under the canonical key, where the surviving
      // gate reads it. Exactly one finding, named.
      expect(validateVisibilityPredicates(normalized).map((f) => f.rule)).toEqual([
        'visibility-bare-identifier',
      ]);
    },
  );

  it('the author is NOT left silent — the D2 conversion notice names the site and its retirement', () => {
    // This notice is the RECORDED GUARD for the alias surface: it is why #6318
    // could retire the lint rule instead of re-anchoring it, and why no working
    // app lost a signal. If this test ever goes red, the retirement's premise is
    // gone and the surface is genuinely unguarded — re-open #6318, do not delete
    // this assertion.
    const { error, warnings } = quietly(() => defineStack(structuredClone(aliasSites[0][1]) as never));
    expect(error).toBeUndefined();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'visibleOn' → 'visibleWhen'");
    expect(warnings[0]).toContain('views[0].form.sections[0].visibleWhen');
    expect(warnings[0]).toContain('retires in protocol 16');
  });

  it('the predicate-VALUE rules in the same file are unaffected — do not connect them', () => {
    // The value moves into `visibleWhen` intact, so these still report on the
    // tier. #6318 was about the alias-KEY rule only, and this is the pin that
    // says so from the far side of the retirement.
    const bare = {
      manifest,
      views: [{
        name: 'tier_form3',
        form: { type: 'simple', sections: [{ label: 'S', visibleWhen: "status == 'active'", fields: [{ field: 'name' }] }] },
      }],
    };
    const cli = quietly(() => cliTierFor(structuredClone(bare)));
    expect(cli.error).toBeUndefined();
    expect(validateVisibilityPredicates(cli.value!).map((f) => f.rule)).toEqual([
      'visibility-bare-identifier',
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('what `normalized` DOES buy: findings survive a schema error that stops the parse', () => {
  it('the registry reports on a stack whose parse would have failed outright', () => {
    // This is the surviving justification, and it is not theoretical: on the raw
    // door `os validate` stops at the schema step and prints zero rule findings,
    // while `os lint` — which never parses — still names both rules. A `parsed`
    // tier could not have run here at all.
    const unparseable = {
      manifest,
      objects: [{
        name: 'tier_task',
        label: 'Task',
        fields: { name: { type: 'text', label: 'Name' } },
        listViews: {
          my_pending: {
            label: 'My Pending',
            type: 'grid',
            columns: [{ field: 'name' }],
            quickFilters: [{ field: 'status', label: 'Status' }],
          },
        },
      }],
      views: [{ name: 'tier_flat', label: 'F', type: 'grid', columns: [{ field: 'name' }] }],
    };

    // The parse refuses it — that is the premise of this test, not an aside.
    expect(quietly(() => defineStack(structuredClone(unparseable) as never)).error).toBeDefined();

    // …and the `normalized`-tier rules still deliver their verdicts.
    const findings = runAuthoringRules('lint', {
      normalized: normalizeStackInput(structuredClone(unparseable)) as AnyRec,
    });
    const rules = new Set(findings.map((f) => f.rule));
    expect(rules.has('list-view-filters-in-views-mode')).toBe(true);
    expect(rules.has('view-container-shape')).toBe(true);
  });
});
