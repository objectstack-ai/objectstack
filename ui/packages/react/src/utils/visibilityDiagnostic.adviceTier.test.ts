/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6487 — the advice paragraph is chosen by the SCOPE the predicate was
 * evaluated against, not printed in one tier's spelling for every surface.
 *
 * ## The defect this file pins
 *
 * The reporter closed every line with the NODE tier's roots — `record`,
 * `current_user`, `page.<var>`. Since objectui#6443 the same reporter also
 * prints for the app-shell chrome gate, whose evaluator
 * (`ExpressionProvider.tsx`) is built from
 * `{ current_user, user, ctx: { user }, os: { user }, data, features }`.
 * There is no `record` and no `page` in that bag at all, so an author whose nav
 * or area `visible` faulted was sent to check two roots that cannot exist at
 * their tier, while the identity aliases and `features` — which do — went
 * unnamed.
 *
 * ⛔ That bag quote carried an `app` root until objectui#8155 (ruled
 * 2026-09-07) removed it from `buildExpressionScope`. This file's app-shell
 * cells asserted `app` was NAMED in the advice, which is what held the false
 * sentence in place after the root was gone; they now assert the opposite, and
 * the sibling coupling pin in
 * `packages/app-shell/src/providers/ExpressionProvider.visibleFaultDiagnostic.test.ts`
 * reddens if the root returns to the BAG while the copy stays silent.
 *
 * ## Why the assertions sit where the tiers DISAGREE
 *
 * `current_user` is named at BOTH tiers, so a cell asserting "the advice
 * mentions `current_user`" is green against the defect and green after it: it
 * measures nothing. Every load-bearing cell below is therefore a root that one
 * tier names and the other must not, and the one agreeing root is kept, marked
 * as degenerate, for exactly the reason it cannot be trusted alone.
 *
 * ## Reverse verification — direction predicted BEFORE the run
 *
 * Restoring `SCOPE_TIER_ADVICE['app-shell']` to the node tier's paragraph (the
 * pre-fix state, reached by passing `'page-component'` at
 * `ExpressionProvider.tsx`'s call site) turns RED every cell in the
 * `app-shell tier` group and the two cross-tier cells, and leaves the whole
 * `page-component tier` group and every control GREEN. The asymmetry is the
 * card restated: the node tier's copy was correct and is unchanged; only the
 * surface it was wrongly reused on moves.
 *
 * Deleting the root NAMES instead — the "generalise the copy" fork the card
 * measured and the triage fenced off — turns red BOTH groups at once, which is
 * how this file also refuses that shape: advice that names no roots is correct
 * everywhere and useful nowhere.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatUnresolvableVisibilityMessage,
  reportUnresolvableVisibilityPredicate,
  __resetVisibilityPredicateWarnings,
  UNRESOLVABLE_VISIBILITY_PREFIX,
} from './visibilityDiagnostic';

/** Unique to this file: the dedupe `Set` is module state shared with every other suite. */
const SOURCE = 'nosuchroot6487.x > 1';
const REASON = 'unknown identifier: nosuchroot6487';

const nodeTier = (source = SOURCE) =>
  formatUnresolvableVisibilityMessage('element:text', 'el1', 'visibleWhen', source, REASON, 'page-component');
const appShellTier = (source = SOURCE) =>
  formatUnresolvableVisibilityMessage('app-shell:visible', undefined, 'visible', source, REASON, 'app-shell');

type WarnSpy = { mock: { calls: unknown[][] } };
const spyWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const reports = (warn: WarnSpy): string[] =>
  warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes(UNRESOLVABLE_VISIBILITY_PREFIX));
const allWarnings = (warn: WarnSpy): string[] => warn.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  __resetVisibilityPredicateWarnings();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- *
 * Group 0 — capture controls. Green both ways, and without them every
 * `toHaveLength(0)` and every `not.toContain` in this file is equally green on
 * a reporter that stopped reporting.
 * -------------------------------------------------------------------------- */

describe('#6487 group 0 — controls', () => {
  it('POSITIVE CONTROL: the spy observes a line carrying the prefix', () => {
    const warn = spyWarn();
    console.warn(`${UNRESOLVABLE_VISIBILITY_PREFIX} - synthetic control line 6487`);
    expect(reports(warn)).toHaveLength(1);
  });

  it('DEGENERATE CONTROL: unrelated console output does not satisfy the pin', () => {
    const warn = spyWarn();
    console.warn('[object-ui] an entirely unrelated warning 6487');
    expect(allWarnings(warn)).toHaveLength(1);
    expect(reports(warn)).toHaveLength(0);
  });

  it('DEGENERATE CELL, kept and labelled: `current_user` is named at BOTH tiers', () => {
    // The shape the card's census clause warns about. This cell is green
    // against the defect and green after it, so it is evidence about NOTHING on
    // its own — it is here so the file states which root is shared, and so a
    // future reader cannot mistake the cells below for an arbitrary split.
    expect(nodeTier()).toContain('`current_user`');
    expect(appShellTier()).toContain('`current_user`');
  });
});

/* -------------------------------------------------------------------------- *
 * Group 1 — the node tier's paragraph, unchanged by this card.
 * -------------------------------------------------------------------------- */

describe('#6487 group 1 — page-component tier', () => {
  it('names the three roots the spec declares for a node gate', () => {
    // `ui/page.zod.ts`: "Binds `record`, `current_user`, `page.<var>`" — and
    // `SchemaRenderer` builds exactly those (plus `data` = the adapter).
    const msg = nodeTier();
    expect(msg).toContain('`record`');
    expect(msg).toContain('`current_user`');
    expect(msg).toContain('`page.<var>`');
  });

  it('does NOT name the app-shell-only roots', () => {
    // The other half of the tier split. `features` and the ADR-0068 alias
    // spellings reach a node predicate only when a host mounted them ambiently;
    // the node tier's own contract does not promise them, so its advice does
    // not send an author to check them.
    const msg = nodeTier();
    expect(msg).not.toContain('`features`');
    expect(msg).not.toContain('`ctx.user`');
    expect(msg).not.toContain('`os.user`');
  });

  it('is the DEFAULT, byte for byte: the five-argument call is unchanged', () => {
    // The compatibility half of the signature change. A caller outside this
    // repo that has not been updated must keep printing what it printed before
    // — not approximately, exactly.
    const withoutTier = formatUnresolvableVisibilityMessage(
      'element:text', 'el1', 'visibleWhen', SOURCE, REASON,
    );
    expect(withoutTier).toBe(nodeTier());
  });
});

/* -------------------------------------------------------------------------- *
 * Group 2 — the app-shell tier. Every cell here is RED against the defect.
 * -------------------------------------------------------------------------- */

describe('#6487 group 2 — app-shell tier', () => {
  it('THE acceptance criterion: the node tier`s paragraph is gone from this tier', () => {
    // The sentence that did the damage, asserted by its own text rather than by
    // a root name: this tier still MENTIONS `record`, and must, because saying
    // it is absent is the single most useful thing to tell an author who copied
    // a node predicate into a nav item. "Sent to check it" and "told it is not
    // here" are opposite guidance that share a word, so the pin is on which.
    const msg = appShellTier();
    expect(msg).not.toContain('Page-component predicates bind');
    expect(msg).toContain('Neither `record` nor `page.<var>` exists at this tier.');
  });

  it('the ONLY mention of either absent root is the sentence declaring it absent', () => {
    // The precise form of "does not send the author there". A future edit that
    // reintroduced `record` as a bindable root anywhere in this tier`s copy adds
    // a second matching line and turns this red, while the negation sentence
    // above keeps passing — which is why both cells exist.
    const msg = appShellTier();
    const ABSENT = 'Neither `record` nor `page.<var>` exists at this tier.';
    for (const root of ['`record`', '`page.<var>`']) {
      const lines = msg.split('\n').filter((l) => l.includes(root));
      expect(lines).toEqual([ABSENT]);
    }
  });

  it('names every root the provider actually binds and the node tier left out', () => {
    // Derived from `ExpressionProvider.tsx`'s own bag:
    // `{ current_user, user, ctx: { user }, os: { user }, data, features }`.
    const msg = appShellTier();
    expect(msg).toContain('`current_user`');
    expect(msg).toContain('`user`');
    expect(msg).toContain('`ctx.user`');
    expect(msg).toContain('`os.user`');
    expect(msg).toContain('`features`');
  });

  it('still names CONCRETE roots — it is not the generalisation the card refused', () => {
    // The fence the triage put on this card, pinned rather than trusted: the
    // fix is not allowed to buy correctness at every tier by naming roots at
    // none. Five concrete roots is measurably not "check whatever this surface
    // binds".
    const msg = appShellTier();
    const named = ['`current_user`', '`user`', '`ctx.user`', '`os.user`', '`features`'];
    expect(named.filter((root) => msg.includes(root))).toHaveLength(named.length);
  });

  /* ------------------------------------------------------------------------ *
   * objectui#8155 — `app` is not a bound root, so this paragraph must not name
   * it. Three cells, each red for a different way of putting the sentence back,
   * modelled on the three-sided pin PR #8164 left on
   * `ConditionalFormattingEditor.test.tsx`.
   * ------------------------------------------------------------------------ */

  it('objectui#8155 — `app` is named NOWHERE in this tier`s advice', () => {
    // The face that was false on `main` after PR #8164: this paragraph is
    // printed at exactly the moment a saved `app.*` predicate faults, so
    // naming `app` answered "why did this not resolve?" with the reason.
    // Asserted on the whole message, not on one line, so re-adding the root to
    // ANY sentence of this tier`s copy reddens here.
    expect(appShellTier()).not.toContain('`app`');
  });

  it('objectui#8155 — the paragraph is pinned by its TEXT, not by a root census', () => {
    // A census (`not.toContain`) alone cannot tell "the root was removed" from
    // "the paragraph was deleted", and the message is the deliverable here —
    // it is published `@object-ui/react` output an author reads in production.
    // Byte-exact, so a re-worded re-introduction ("plus the app metadata") that
    // slips past the census above still reddens.
    expect(appShellTier()).toContain(
      'App-shell predicates bind `current_user` - also spelled `user`, `ctx.user`\n' +
      'and `os.user` - plus `features` (the deployment flags).\n' +
      'Neither `record` nor `page.<var>` exists at this tier.\n' +
      'Check those roots and the CEL syntax.',
    );
  });

  it('objectui#8155 CONTROL: the node tier`s paragraph never named `app` and is untouched', () => {
    // The other half of the acceptance predicate — "nothing that was true
    // before #8164 and unrelated to `app` was changed". This cell was green
    // before the removal and stays green, so on its own it is evidence about
    // nothing; it is here because a fix that reached the node tier's copy
    // (which was already correct) would take it red.
    expect(nodeTier()).not.toContain('`app`');
    expect(nodeTier()).toContain(
      'Page-component predicates bind `record` (the row on a record page),\n' +
      '`current_user`, and page state as `page.<var>`. Check those roots and the\n' +
      'CEL syntax.',
    );
  });
});

/* -------------------------------------------------------------------------- *
 * Group 3 — what the tiers must NOT disagree about.
 * -------------------------------------------------------------------------- */

describe('#6487 group 3 — only the last paragraph is per-tier', () => {
  it('everything above the advice is identical on both tiers', () => {
    // The card's own boundary: the first paragraph ("the gate did NOT bite") is
    // true on every surface wired to this reporter, INCLUDING the fail-open
    // app-shell gate, and this card does not get to touch it. Compared as
    // TEXT — the two messages are built from different (type, id, key) inputs,
    // so the shared part is the two trailing sentences of the fault paragraph.
    const shared = [
      'The node was treated as its safe default, which on this surface means the',
      'gate did NOT bite - a predicate that cannot be evaluated reads on screen',
      'exactly like one that said yes.',
    ].join('\n');
    expect(nodeTier()).toContain(shared);
    expect(appShellTier()).toContain(shared);
  });

  it('both tiers still carry the prefix, the key, the source and the engine reason', () => {
    for (const msg of [nodeTier(), appShellTier()]) {
      expect(msg).toContain(UNRESOLVABLE_VISIBILITY_PREFIX);
      expect(msg).toContain(SOURCE);
      expect(msg).toContain(REASON);
    }
    expect(nodeTier()).toContain('visibleWhen:');
    expect(appShellTier()).toContain('visible:');
  });

  it('both tiers close on the same instruction', () => {
    expect(nodeTier()).toContain('Check those roots and the');
    expect(appShellTier()).toContain('Check those roots and the');
  });
});

/* -------------------------------------------------------------------------- *
 * Group 4 — the EMITTER, not the formatter. A fault has to actually reach the
 * console in the same run, or every string assertion above is a statement about
 * a function nobody calls.
 * -------------------------------------------------------------------------- */

describe('#6487 group 4 — the tier reaches the console', () => {
  it('the app-shell tier prints ONE line, and it is the app-shell paragraph', () => {
    const warn = spyWarn();
    reportUnresolvableVisibilityPredicate(
      'app-shell:visible', undefined, 'visible', 'nosuchroot6487emit.x > 1', REASON, 'app-shell',
    );
    const lines = reports(warn);
    // Ghost-assertion guard: the fault reached the reporter in THIS run.
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('`features`');
    expect(lines[0]).not.toContain('Page-component predicates bind');
  });

  it('the page-component tier prints ONE line, and it is the node paragraph', () => {
    const warn = spyWarn();
    reportUnresolvableVisibilityPredicate(
      'element:text', 'el2', 'visibleWhen', 'nosuchroot6487node.x > 1', REASON, 'page-component',
    );
    const lines = reports(warn);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('`record`');
    expect(lines[0]).not.toContain('`features`');
  });

  it('the tier is NOT in the dedupe key — the objectui#6038 rate limit is untouched', () => {
    // Stated as a consequence rather than discovered later. Adding `tier` to the
    // key could only LOOSEN the limit, and it would take one `type` shared
    // across two tiers to loosen anything — which production cannot produce,
    // since the app-shell site's `type` is the constant `'app-shell:visible'`.
    // This cell reaches it only by calling the reporter directly.
    const warn = spyWarn();
    const shared = 'nosuchroot6487dedupe.x > 1';
    reportUnresolvableVisibilityPredicate('app-shell:visible', undefined, 'visible', shared, REASON, 'app-shell');
    reportUnresolvableVisibilityPredicate('app-shell:visible', undefined, 'visible', shared, REASON, 'page-component');
    expect(reports(warn)).toHaveLength(1);
  });

  it('a SECOND distinct source still reports — a dedupe that suppressed everything would look the same', () => {
    const warn = spyWarn();
    reportUnresolvableVisibilityPredicate('app-shell:visible', undefined, 'visible', 'nosuchroot6487two_a.x > 1', REASON, 'app-shell');
    reportUnresolvableVisibilityPredicate('app-shell:visible', undefined, 'visible', 'nosuchroot6487two_b.y == 3', REASON, 'app-shell');
    expect(reports(warn)).toHaveLength(2);
  });
});
