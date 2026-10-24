/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6503 — the fault diagnostic says something TRUE to an author whose
 * node VANISHED.
 *
 * ## The defect this closes
 *
 * `evaluateCondition` answers an unevaluable predicate with `true` on every one
 * of its paths. `SchemaRenderer`'s visibility chain NEGATES that answer on four
 * of its six legs (`visibleWhen` / `visible` / `visibleOn` / `visibility`; the
 * last was retired by objectui#12654, leaving three of five), so
 * there the fail-soft default SHOWS the node and the reporter's sentence — "the
 * gate did NOT bite" — is exactly right. The chain returns it UN-negated on the
 * other two (`hidden` / `hiddenOn`): the same `true` sets `_hidden` and
 * `SchemaRenderer` returns `null`. The gate bit, and bit harder than on either
 * sibling gate — the node is not on screen at all — and those two legs were
 * handed the sentence that says the opposite.
 *
 * Worse than a merely wrong sentence: it is wrong in the direction that costs
 * the most. `SchemaRenderer`'s own #3862/#3955 comment names the asymmetry — "a
 * greyed-out control is still on screen, a node that never rendered is
 * indistinguishable from metadata that meant it". An author whose block
 * vanished, told the gate did not bite, is sent to hunt a rendering bug that
 * does not exist, past the one line that was supposed to name their predicate.
 *
 * ## ⭐ Why this file pins CONTENT, and why that is the whole point
 *
 * objectui#6038's suite already covers the `hidden` leg — "the `hidden` leg —
 * the NON-negated polarity — reports too, and still hides". It pins that the
 * line is EMITTED and that the line contains the KEY. It never pins what the
 * line SAYS, which is precisely why this defect shipped through it, survived
 * objectui#6487's rewrite of the same paragraph, and survived objectui#6510
 * writing the defect into the module's own docblock and printing it anyway.
 *
 * A pin that counts lines reproduces that blindness in new syntax. Every case
 * below therefore asserts the CONSEQUENCE SENTENCE, byte for byte, in both
 * directions: the sentence that must now appear, and the sentence that must no
 * longer. And the emission pin is re-asserted here rather than assumed — the
 * fix keeps `UNRESOLVABLE_VISIBILITY_PREFIX` on these legs deliberately, so
 * objectui#6038's prefix-filtered view still catches them.
 *
 * ## The control that stops the cheap fix
 *
 * A fix that "improved" the copy for all six legs by making it vaguer would be
 * green on the `hidden` cases alone. Group 2 pins the four NEGATED legs at
 * their existing bytes, individually, so the only way to pass this file is to
 * change the two legs that were wrong and leave the four that were right.
 *
 * ## Copy fix only — the verdict is NOT this card's to move
 *
 * The node still vanishes. That fail-soft is the shipped behaviour the
 * neighbouring family (#3862 / #3955 / #6443 / #6487 / #6445) preserved
 * deliberately. Every case here pins the VERDICT beside the line, so a run made
 * green by flipping the gate fails this file.
 *
 * ## Reverse verification, and where the prediction was WRONG
 *
 * Predicted before running: restoring `visibilityDiagnostic.ts` and
 * `SchemaRenderer.tsx` to the pinned base commit (`d7acad69d`, hash-verified
 * on disk, never `origin/main` — a shared pointer another agent's fetch moves)
 * turns groups 1, 3 and 5 RED and leaves 0, 2, 4 and 6 GREEN.
 *
 * MEASURED: 7 failed / 10 passed. Six of the seven are where predicted. The
 * seventh is group 4's dedupe case, which the prediction had in the GREEN set
 * and which fails on its closing `CONCEALMENT_CONSEQUENCE` assertion — the
 * deliberate refusal to let a rate-limit case pin only a COUNT. The prediction
 * was written per group; that one case spans two. The record is corrected here
 * rather than restated, because a false claim about which cases guard what is
 * the same class of defect this file exists to fix.
 *
 * Every RED is on a CONTENT assertion; not one is on a count or an emission.
 * The base tree printed, for a node that had VANISHED:
 *
 *     [ObjectUI] A visibility predicate could not be evaluated - node "…"
 *       hidden: "nosuchroot6503.locked == true"
 *       Reason: … nosuchroot6503 is not defined
 *     The node was treated as its safe default, which on this surface means the
 *     gate did NOT bite - …
 *
 * Group 2 is GREEN in BOTH states, and that is what a control for "unchanged"
 * must be: it asserts the four negated legs' bytes, which neither the base tree
 * nor the fixed one moves. It fails only against a fix that touched them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import {
  UNRESOLVABLE_ENABLEMENT_PREFIX,
  UNRESOLVABLE_VISIBILITY_PREFIX,
} from '../utils/visibilityDiagnostic';

const NAME = 'probe-6503';
const TYPE = 'element:probe-6503';

/* -------------------------------------------------------------------------- *
 * The two sentences, spelled out. Byte-for-byte copies of the `GATE_KIND_COPY`
 * entries — deliberately duplicated rather than imported, because importing the
 * table would make every assertion below a tautology that stays green no matter
 * what the table is changed to say.
 * -------------------------------------------------------------------------- */

/** What a VANISHED node's author must now read (objectui#6503). */
const CONCEALMENT_CONSEQUENCE =
  'The node was treated as its safe default, which on THIS leg is the one\n' +
  'that BITES: `hidden` / `hiddenOn` are NOT negated, so that default\n' +
  'REMOVED the node - it is not on the page at all, and an absent node is\n' +
  'indistinguishable from metadata that meant to hide it. Nothing is broken\n' +
  'in the renderer: the block is missing because the predicate above could\n' +
  'not be evaluated.\n';

/**
 * What the NEGATED legs said before objectui#13299. The sentence is still the
 * `'visibility'` copy (a blank SHOW gate that faults prints it), but a
 * DECLARED predicate on those legs now fails closed and prints the
 * `'withholding'` copy instead, so group 2 pins this one ABSENT there.
 */
const NEGATED_LEG_CONSEQUENCE =
  'The node was treated as its safe default, which on this surface means the\n' +
  'gate did NOT bite - a predicate that cannot be evaluated reads on screen\n' +
  'exactly like one that said yes.\n';

/** The clause the fail-closed SHOW legs carry since objectui#13299. */
const WITHHOLDING_CLAUSE = 'WITHHELD - not drawn';

/** The clause the `hidden` legs used to carry, named so it can be pinned ABSENT. */
const THE_FALSE_CLAUSE = 'gate did NOT bite';

/** A probe that renders only when the chain lets it — absence IS the verdict. */
const Probe = () => <div data-testid="probe" />;

/** The ambient scope app-shell's `ExpressionProvider` really mounts. */
const APP_SCOPE = {
  current_user: { id: 'u1' },
  user: { id: 'u1' },
  data: {},
  features: {},
};
const ADAPTER = { total: 99 };
const ROW = { id: 'r1', status: 'open' };

/**
 * Faulting predicates — an unbound ROOT identifier, the shape objectstack#11254
 * hit and the shape an AI-authored predicate reaches for.
 *
 * A DISTINCT source per DEVELOPMENT case, for the reason objectui#6445's suite
 * records: objectui#6444's `warnedEvaluationFaults` is module state on the
 * STATIC graph, so a dev case reusing another's source can have the evaluator's
 * own built-in line suppressed on its behalf, and a raw-total pin would then
 * read one on a build that reported twice. `inProduction` gets a fresh module
 * graph per case, so those may share.
 */
const FAULT_BARE = 'nosuchroot6503.locked == true';
const FAULT_HIDDEN_DEV = 'devbadroot6503hidden.locked == true';
const FAULT_HIDDENON_DEV = 'devbadroot6503hiddenon.locked == true';
const FAULT_VISIBLEWHEN_DEV = 'devbadroot6503vw.locked == true';
const FAULT_VISIBLE_DEV = 'devbadroot6503v.locked == true';
const FAULT_VISIBLEON_DEV = 'devbadroot6503von.locked == true';
const FAULT_DISABLED_DEV = 'devbadroot6503dis.locked == true';
const FAULT_TEMPLATE_HIDDEN = '${tmplbadroot6503.locked == true}';
const FAULT_CEL_HIDDEN = { dialect: 'cel', source: 'record.bad6503(' };

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
/** The VISIBILITY-prefix-filtered view — the same one objectui#6038 reads. */
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
/** The sibling gate's view, for the cross-gate control. */
const enablementReports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_ENABLEMENT_PREFIX));
const allWarnings = (warn: WarnSpy): string[] => warn.mock.calls.map((c) => String(c[0]));

/**
 * The one pre-existing line a DEVELOPMENT build prints beside these, and it is
 * not ours: `validateSchemaOnce` runs in dev only and core's `BASE_SCHEMA_RULES`
 * declares these gate keys booleans, so every EXPRESSION-valued one — the
 * authoring form this whole family is about — is also reported as an invalid
 * schema. A false positive predating this card, filed separately
 * (objectui#6505). Named rather than absorbed into a loose assertion.
 */
const DEV_SCHEMA_VALIDATOR_NOISE = '[ObjectUI] Invalid schema detected:';
const nonValidatorWarnings = (warn: WarnSpy): string[] =>
  allWarnings(warn).filter((m) => !m.includes(DEV_SCHEMA_VALIDATOR_NOISE));

/**
 * Mount in a PRODUCTION module graph.
 *
 * `__DEV__` in `SchemaRenderer` is an IIFE evaluated at module load, so the env
 * has to be stubbed before the import — hence `resetModules` and a dynamic
 * import in the test BODY (the case `object-ui/no-dynamic-import-in-test-hook`
 * exempts). The dedupe `Set` is module state of that same fresh graph, so the
 * reset must come from the fresh graph too.
 */
async function inProduction(
  fn: (mount: (schemas: Record<string, unknown>[]) => void) => void | Promise<void>,
): Promise<void> {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  try {
    const [core, prod, ctx, rec, expr, diag] = await Promise.all([
      import('@object-ui/core'),
      import('../SchemaRenderer'),
      import('../context/SchemaRendererContext'),
      import('../context/RecordContext'),
      import('../hooks/useExpression'),
      import('../utils/visibilityDiagnostic'),
    ]);
    diag.__resetVisibilityPredicateWarnings();
    core.ComponentRegistry.register(NAME, Probe as never, {
      namespace: 'element',
      skipFallback: true,
    } as never);
    const mount = (schemas: Record<string, unknown>[]) =>
      render(
        <expr.PredicateScopeProvider scope={APP_SCOPE}>
          <ctx.SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
            <rec.RecordContextProvider objectName="showcase_task" recordId={ROW.id} data={ROW}>
              {schemas.map((s, i) => (
                <prod.SchemaRenderer key={i} schema={{ type: TYPE, ...s } as never} />
              ))}
            </rec.RecordContextProvider>
          </ctx.SchemaRendererContext.Provider>
        </expr.PredicateScopeProvider>,
      );
    await fn(mount);
    core.ComponentRegistry.unregister?.(NAME, 'element');
  } finally {
    cleanup();
    vi.unstubAllEnvs();
    vi.resetModules();
  }
}

/** Mount in the ordinary (development) module graph. */
async function inDevelopment(
  fn: (mount: (schemas: Record<string, unknown>[]) => void) => void | Promise<void>,
): Promise<void> {
  const [core, dev, ctx, rec, expr, diag] = await Promise.all([
    import('@object-ui/core'),
    import('../SchemaRenderer'),
    import('../context/SchemaRendererContext'),
    import('../context/RecordContext'),
    import('../hooks/useExpression'),
    import('../utils/visibilityDiagnostic'),
  ]);
  diag.__resetVisibilityPredicateWarnings();
  core.ComponentRegistry.register(NAME, Probe as never, {
    namespace: 'element',
    skipFallback: true,
  } as never);
  try {
    const mount = (schemas: Record<string, unknown>[]) =>
      render(
        <expr.PredicateScopeProvider scope={APP_SCOPE}>
          <ctx.SchemaRendererContext.Provider value={{ dataSource: ADAPTER } as never}>
            <rec.RecordContextProvider objectName="showcase_task" recordId={ROW.id} data={ROW}>
              {schemas.map((s, i) => (
                <dev.SchemaRenderer key={i} schema={{ type: TYPE, ...s } as never} />
              ))}
            </rec.RecordContextProvider>
          </ctx.SchemaRendererContext.Provider>
        </expr.PredicateScopeProvider>,
      );
    await fn(mount);
  } finally {
    core.ComponentRegistry.unregister?.(NAME, 'element');
    cleanup();
  }
}

const shownCount = () => screen.queryAllByTestId('probe').length;

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- *
 * Group 0 — the controls that decide whether the rest of the file means
 * anything. Both are about the CAPTURE, not about the renderer.
 * -------------------------------------------------------------------------- */

describe('#6503 group 0 — capture controls', () => {
  it('POSITIVE CONTROL: the spy really observes a line carrying the visibility prefix', () => {
    // Without this, every `toHaveLength(0)` below is equally green on a capture
    // that observes nothing at all.
    const warn = spyWarn();
    console.warn(`${UNRESOLVABLE_VISIBILITY_PREFIX} - synthetic control line 6503`);
    expect(reports(warn)).toHaveLength(1);
  });

  it('DEGENERATE CONTROL: the two sentences are genuinely different strings', () => {
    // A fix that made both entries identical would satisfy "the hidden leg
    // prints X" and "the negated legs print X" at once. They must not be equal,
    // and neither may contain the other.
    expect(CONCEALMENT_CONSEQUENCE).not.toEqual(NEGATED_LEG_CONSEQUENCE);
    expect(CONCEALMENT_CONSEQUENCE).not.toContain(THE_FALSE_CLAUSE);
    expect(NEGATED_LEG_CONSEQUENCE).toContain(THE_FALSE_CLAUSE);
  });
});

/* -------------------------------------------------------------------------- *
 * Group 1 — THE acceptance criterion.
 * -------------------------------------------------------------------------- */

describe('#6503 group 1 — a faulting `hidden` says the node VANISHED, and it did', () => {
  it('THE acceptance criterion: the consequence paragraph is the concealment one, NOT "the gate did NOT bite"', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: FAULT_BARE }]);

      // The VERDICT, pinned beside the copy: the node is gone. This card moves
      // bytes an author reads, never what the gate does.
      expect(shownCount()).toBe(0);

      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      const line = lines[0];
      // Both directions. The first alone would pass on a build that printed
      // BOTH sentences; the second alone would pass on one that printed none.
      expect(line).toContain(CONCEALMENT_CONSEQUENCE);
      expect(line).not.toContain(THE_FALSE_CLAUSE);
    });
  });

  it('the report still names the node, the key and the predicate — the fix moves ONE paragraph', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: FAULT_BARE }]);
      const line = reports(warn)[0];
      expect(line).toContain(TYPE);
      expect(line).toContain('hidden');
      expect(line).toContain(FAULT_BARE);
      // And the tier advice below the consequence is untouched (objectui#6487).
      expect(line).toContain('Page-component predicates bind `record`');
    });
  });

  it('development prints the identical line — one message, not two that drift', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: FAULT_HIDDEN_DEV }]);
      expect(shownCount()).toBe(0);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(CONCEALMENT_CONSEQUENCE);
      expect(lines[0]).not.toContain(THE_FALSE_CLAUSE);
      // Nothing beyond our line and the known dev-only validator noise.
      expect(nonValidatorWarnings(warn).length).toBeGreaterThan(0);
    });
  });

  it('the CEL dialect reaches the same paragraph — the copy is per GATE, not per dialect', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: FAULT_CEL_HIDDEN }]);
      expect(shownCount()).toBe(0);
      const line = reports(warn)[0];
      expect(line).toBeDefined();
      expect(line).toContain(CONCEALMENT_CONSEQUENCE);
      expect(line).not.toContain(THE_FALSE_CLAUSE);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 2 — THE CONTROL. The negated legs must be UNCHANGED.
 * -------------------------------------------------------------------------- */

describe('#6503 group 2 — the NEGATED legs are withheld and say so (flipped by objectui#13299)', () => {
  // Each leg individually, not "one of them": `shouldHide` is an early-return
  // chain, so a single mount can only ever exercise the FIRST declared leg. A
  // loop over one schema would have measured `visibleWhen` four times.
  //
  // objectui#13299 flipped these legs: a DECLARED predicate that faults now
  // fails CLOSED, so the node is withheld and the line carries the
  // `'withholding'` consequence. The sentence this group used to pin ("the
  // gate did NOT bite") is now false here, so it is pinned ABSENT.
  const NEGATED: Array<[string, string]> = [
    ['visibleWhen', FAULT_VISIBLEWHEN_DEV],
    ['visible', FAULT_VISIBLE_DEV],
    ['visibleOn', FAULT_VISIBLEON_DEV],
  ];

  for (const [key, source] of NEGATED) {
    it(`\`${key}\` is withheld, and its line says WITHHELD rather than "did NOT bite"`, async () => {
      await inProduction((mount) => {
        const warn = spyWarn();
        mount([{ id: 'n1', [key]: source }]);
        // The fail-closed answer (objectui#13299).
        expect(shownCount()).toBe(0);
        const lines = reports(warn);
        expect(lines).toHaveLength(1);
        const line = lines[0];
        expect(line).toContain(key);
        expect(line).toContain(WITHHOLDING_CLAUSE);
        expect(line).not.toContain(NEGATED_LEG_CONSEQUENCE);
        // And the concealment copy must NOT leak onto a SHOW leg either.
        expect(line).not.toContain(CONCEALMENT_CONSEQUENCE);
        expect(line).not.toContain('REMOVED the node');
      });
    });
  }
});

/* -------------------------------------------------------------------------- *
 * Group 3 — `hiddenOn`, the second non-negated leg.
 * -------------------------------------------------------------------------- */

describe('#6503 group 3 — `hiddenOn` is the same gate and gets the same sentence', () => {
  it('a faulting `hiddenOn` prints the concealment paragraph and the node vanishes', async () => {
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hiddenOn: FAULT_BARE }]);
      expect(shownCount()).toBe(0);
      const line = reports(warn)[0];
      expect(line).toBeDefined();
      expect(line).toContain('hiddenOn');
      expect(line).toContain(CONCEALMENT_CONSEQUENCE);
      expect(line).not.toContain(THE_FALSE_CLAUSE);
    });
  });

  it('development agrees on `hiddenOn` too', async () => {
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hiddenOn: FAULT_HIDDENON_DEV }]);
      expect(shownCount()).toBe(0);
      expect(reports(warn)[0]).toContain(CONCEALMENT_CONSEQUENCE);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 4 — the objectui#6038 pins this card must NOT break.
 * -------------------------------------------------------------------------- */

describe('#6503 group 4 — emission and rate limit are unchanged', () => {
  it('the `hidden` leg still carries the VISIBILITY prefix — objectui#6038 reads through that filter', async () => {
    // The routing decision restated as a pin. A third gate kind with a third
    // PREFIX would have been the tidy-looking change that silently emptied
    // objectui#6038's prefix-filtered view (and every app console filter that
    // hard-codes the constant). It is a visibility predicate; only the
    // consequence sentence differs.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: FAULT_BARE }]);
      expect(shownCount()).toBe(0);
      const lines = reports(warn);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('hidden');
      expect(lines[0].startsWith(UNRESOLVABLE_VISIBILITY_PREFIX)).toBe(true);
      // No line escaped the prefix-filtered view.
      expect(allWarnings(warn)).toHaveLength(1);
    });
  });

  it('still ONE line for many nodes sharing a faulting `hidden`, and a SECOND distinct source still reports', async () => {
    // Both halves together — "a warning was emitted" is green on fifty, and
    // "exactly one" is green on an implementation that suppresses everything.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([
        { id: 'a', hidden: FAULT_BARE },
        { id: 'b', hidden: FAULT_BARE },
        { id: 'c', hidden: FAULT_BARE },
      ]);
      expect(shownCount()).toBe(0);
      expect(reports(warn)).toHaveLength(1);
      mount([{ id: 'd', hidden: 'anotherbadroot6503.frozen == true' }]);
      expect(reports(warn)).toHaveLength(2);
      expect(reports(warn)[1]).toContain(CONCEALMENT_CONSEQUENCE);
    });
  });

  it('a HEALTHY `hidden` predicate stays silent — the paired control', async () => {
    // Without this, "always print the concealment paragraph" satisfies group 1.
    await inProduction((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', hidden: "record.status == 'open'" }]);
      expect(shownCount()).toBe(0); // a REAL hide, not a fault
      expect(reports(warn)).toHaveLength(0);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 5 — the DYNAMIC routing site (objectui#5756).
 * -------------------------------------------------------------------------- */

describe('#6503 group 5 — the winning-key report site routes by polarity too', () => {
  it('a `${…}` template in `properties.hidden` gets the concealment paragraph', async () => {
    // This is the one call site that cannot state its gate as a literal: it
    // passes whatever `winningVisibilityKey` returned. A fix that only touched
    // the six literal legs in `shouldHide` would leave this path printing the
    // old sentence for the same authoring mistake in a different spelling.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', properties: { hidden: FAULT_TEMPLATE_HIDDEN } }]);
      const line = reports(warn)[0];
      expect(line).toBeDefined();
      expect(line).toContain('hidden');
      expect(line).toContain(CONCEALMENT_CONSEQUENCE);
      expect(line).not.toContain(THE_FALSE_CLAUSE);
    });
  });
});

/* -------------------------------------------------------------------------- *
 * Group 6 — the sibling gate is untouched.
 * -------------------------------------------------------------------------- */

describe('#6503 group 6 — the enablement gate keeps its own paragraph', () => {
  it('a faulting `disabled` still gets the enablement copy, not the concealment one', async () => {
    // Three gate kinds now share one reporter. This pins that widening the
    // union did not re-route the gate that was already correct.
    await inDevelopment((mount) => {
      const warn = spyWarn();
      mount([{ id: 'n1', disabled: FAULT_DISABLED_DEV }]);
      expect(shownCount()).toBe(1); // greyed out, not gone
      const line = enablementReports(warn)[0];
      expect(line).toBeDefined();
      expect(line).toContain('the node renders DISABLED');
      expect(line).not.toContain(CONCEALMENT_CONSEQUENCE);
      expect(line).not.toContain(THE_FALSE_CLAUSE);
      // And no visibility-prefixed line was emitted for it.
      expect(reports(warn)).toHaveLength(0);
    });
  });
});
