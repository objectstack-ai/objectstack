// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9318 — the wrong-layer verdict comes from `@objectstack/lint`, not
 * from a second hand-maintained copy of it.
 *
 * ## What moved
 *
 * `rowCanonAdvisory` used to answer "is this root bound on this surface?" from
 * objectui's own knowledge: `@object-ui/core`'s `detectNonCanonicalRowSpelling`
 * hard-codes ONE root (`data`) and objectui's docblock justified that from
 * `ROW_PREDICATE_ROOTS` / `FIELD_RULE_ROOTS` / `FORMULA_ROOTS`. The platform
 * publishes the same judgement as `fieldRuleRootIssue` / `FIELD_RULE_BOUND_ROOTS`.
 * Two copies of one judgement agree today and nothing keeps them agreeing.
 *
 * ## What did NOT move, and is pinned here as such
 *
 * The helper judges against `FIELD_RULE_BOUND_ROOTS` = `record` / `previous` /
 * `parent` — whatever slot name it is handed. It has no vocabulary gate of its
 * own (measured: an unrecognised slot still returns a finding, not `null`), so
 * WHICH surfaces it may answer for is objectui's call, not the platform's. Two
 * of the surfaces `rowCanonAdvisory` guards bind a set that is not that one, and
 * neither is comparable to it — they overlap on `record` alone:
 *
 *  - the conditional-formatting `condition` binds `ROW_PREDICATE_ROOTS`
 *    (`record`, `current_user`, `user`, `features`, `os`, `ctx`) — five roots
 *    the field tier does not bind, but NOT a superset: no `previous`, no
 *    `parent`;
 *  - a `formula` field's `expression` binds `FORMULA_ROOTS` (`record`) — a
 *    proper subset.
 *
 * So the helper's verdict is adopted exactly on the three slots whose bound set
 * IS the field-rule set, and the local fallback is KEPT for the rest. The two
 * "uncovered surface" pins below are live controls for the failure this card
 * exists to stop, in miniature: routing every surface through the helper to
 * make the code tidier would redden them.
 *
 * Severity stays objectui's own mapping (`warning`, never `error`) on both
 * paths — every save gate on this tier counts `severity === 'error'`.
 */

import { describe, it, expect } from 'vitest';
import { fieldRuleRootIssue, FIELD_RULE_BOUND_ROOTS } from '@objectstack/lint';
import { SCOPE_ROOTS } from '@objectstack/formula';
import { lintCelPredicate, type CelLintIssue } from './celAuthoring';
import { tFormat } from './i18n';

const HINT = { objectName: 'account', fields: ['organization_id', 'owner_id', 'status', 'amount'] };
/** A field conditional rule — a slot the published helper's vocabulary covers. */
const RULE_SLOT_HINT = { ...HINT, scope: 'record' as const, slot: 'visibleWhen' as const };
/** The same tier with no slot named — the local fallback, unchanged. */
const UNSLOTTED_HINT = { ...HINT, scope: 'record' as const };

/** objectui's own advisory sentence; the engine's never contains it. */
const OBJECTUI_MESSAGE_MARKER = /Re-root/;

/**
 * What a finding reads in English: the producer's message as written, or the
 * en row of the sentence objectui words itself, which the lint hands back as a
 * catalogue key (objectui#10862).
 */
const en = (i: CelLintIssue): string => (i.messageKey ? tFormat(i.messageKey, 'en-US', i.messageVars) : i.message);

describe('celAuthoring · the field-rule verdict is the published one (objectui#9318)', () => {
  it('TRUE POSITIVE — a covered slot takes BOTH the verdict and the message from `fieldRuleRootIssue`', async () => {
    const source = "data.status == 'x'";
    const issues = await lintCelPredicate(source, RULE_SLOT_HINT);
    const engine = fieldRuleRootIssue('visibleWhen', source);
    // The helper has something to say about this source — if it ever stops,
    // this pin is measuring nothing and must be re-derived, not relaxed.
    expect(engine).not.toBeNull();
    const advisory = issues.filter((i) => i.severity === 'warning' && en(i) === engine!.message);
    // Verbatim equality against the helper's OWN output, evaluated here rather
    // than transcribed: this asserts "objectui ships the engine's message" and
    // can never drift with upstream wording the way a quoted string would.
    expect(advisory).toHaveLength(1);
  });

  it('ships ONE message, never both — objectui\'s sentence is gone from the covered path', async () => {
    const issues = await lintCelPredicate("data.status == 'x'", RULE_SLOT_HINT);
    expect(issues.filter((i) => OBJECTUI_MESSAGE_MARKER.test(en(i)))).toEqual([]);
    expect(issues.filter((i) => i.severity === 'warning')).toHaveLength(1);
  });

  it('LIVE CONTROL — the ACCEPT SET is not narrowed: the covered path raises no error', async () => {
    // Every save gate on this tier counts `severity === 'error'` and nothing
    // else, so "zero errors" IS "still accepted". Reddens on exactly one
    // change — promoting the advisory to `error`.
    const issues = await lintCelPredicate("data.status == 'x'", RULE_SLOT_HINT);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('a root the platform DOES bind comes back clean THROUGH the new path', async () => {
    // The ablation target: `previous` and `parent` are clean here because
    // `FIELD_RULE_BOUND_ROOTS` says the field level binds them, not because
    // objectui's detector only ever looked at `data`.
    expect(await lintCelPredicate("previous.status == 'x'", RULE_SLOT_HINT)).toEqual([]);
    expect(await lintCelPredicate('parent.status == "paid"', RULE_SLOT_HINT)).toEqual([]);
    expect(await lintCelPredicate("record.status == 'x'", RULE_SLOT_HINT)).toEqual([]);
  });

  it('takes the WIDER verdict on a covered slot: a root no field rule binds is advised too', async () => {
    // A declared behaviour change, and the substance of adopting the published
    // verdict: `current_user` is in the engine's baseline `SCOPE_ROOTS`, so
    // `validateExpression` says nothing about it, while the FIELD level does
    // not bind it. objectui's one-root detector could never reach this.
    // "WIDER" in the name is this verdict against the ONE-ROOT detector it
    // replaces — ⛔ not a set relation between the two surfaces' bound roots,
    // which are incomparable (see the header).
    const issues = await lintCelPredicate('current_user.isAdmin', RULE_SLOT_HINT);
    const advisory = issues.filter((i) => i.severity === 'warning' && /current_user/.test(en(i)));
    expect(advisory).toHaveLength(1);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('stands down on a parse error and on a non-CEL dialect, like the path it replaces', async () => {
    const broken = await lintCelPredicate('data.status ==', RULE_SLOT_HINT);
    expect(broken.some((i) => i.severity === 'error')).toBe(true);
    expect(broken.filter((i) => i.severity === 'warning' && /\bdata\b/.test(en(i)))).toEqual([]);
    const legacy = await lintCelPredicate('${data.status}', RULE_SLOT_HINT);
    expect(legacy.filter((i) => i.severity === 'warning' && /\bdata\b/.test(en(i)))).toEqual([]);
  });
});

describe('celAuthoring · the UNCOVERED surfaces keep the local fallback (objectui#9318 part 3)', () => {
  it('LIVE CONTROL — a formula `expression` still gets objectui\'s message, not the engine\'s', async () => {
    // `FORMULA_ROOTS` is `['record']` — a proper SUBSET of
    // `FIELD_RULE_BOUND_ROOTS`. Routing this through the helper would not shrink
    // coverage: measured, `previous.*` / `parent.*` report nothing on this
    // surface today either. It would report them CLEAN on the helper's own
    // authority — asserting they are bound where this surface binds only
    // `record`. A false green, which is worse than the silence it replaces.
    const issues = await lintCelPredicate('data.amount * 0.2', { ...UNSLOTTED_HINT, role: 'value' as const });
    const advisory = issues.filter((i) => i.severity === 'warning' && OBJECTUI_MESSAGE_MARKER.test(en(i)));
    expect(advisory).toHaveLength(1);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('LIVE CONTROL — a conditional-formatting condition is NOT advised for the roots it binds', async () => {
    // `ROW_PREDICATE_ROOTS` carries `current_user`, `user`, `features`, `os`,
    // `ctx` on top of `record` — five roots the field tier does not bind. It is
    // NOT a superset of `FIELD_RULE_BOUND_ROOTS` though: it lacks `previous` and
    // `parent`, so the two sets overlap on `record` alone. This is the pin that
    // reddens if someone routes every `scope: 'record'` surface through the
    // helper: the author would be told to rewrite five roots that work here.
    expect(await lintCelPredicate('current_user.isAdmin', UNSLOTTED_HINT)).toEqual([]);
    expect(await lintCelPredicate("os.name == 'x'", UNSLOTTED_HINT)).toEqual([]);
  });

  it('an unknown slot name falls back rather than guessing', async () => {
    const issues = await lintCelPredicate('current_user.isAdmin', { ...UNSLOTTED_HINT, slot: 'someFutureWhen' });
    expect(issues).toEqual([]);
  });
});

describe('celAuthoring · platform drift tripwire (objectui#9318)', () => {
  it('the published bound set is still the one objectui measured its coverage answer against', async () => {
    // NOT a second copy of the verdict — the verdict is read from the helper at
    // runtime and this assertion is never consulted by product code. It exists
    // so that the next root the platform binds or unbinds arrives as a RED test
    // in objectui, with the instruction to re-derive which of this repo's
    // surfaces the helper's vocabulary still covers (PR objectui#9318 part 3).
    expect([...FIELD_RULE_BOUND_ROOTS]).toEqual(['record', 'previous', 'parent']);
  });

  it('SWEEPS the whole unbound population: every root is advised EXCEPT `app`', async () => {
    // The instrument behind the docblock's universal. The published prose says
    // "every root the field level leaves unbound is advised, except `app`" and
    // ⛔ names no others — because any written-down list goes stale the next
    // time the platform moves a root. This sweep re-derives the population on
    // every run instead, so the claim cannot rot silently: it reddens when a
    // root stops being advised, when a SECOND root starts being blocked, or
    // when any root goes silent.
    //
    // ⚠️ The universe is RECONSTRUCTED, and that is a declared limit, not an
    // oversight: `@objectstack/lint` keeps both `FIELD_RULE_JUDGED_ROOTS` and
    // `FIELD_RULE_AMBIENT_ROOTS` module-private (neither is in its export list
    // at 17.4.0), so the judged set is rebuilt here as `SCOPE_ROOTS` plus the
    // one ambient root. A NEW ambient root added upstream would be invisible to
    // this sweep until that literal is updated — nothing in this repo can see
    // it. The `app` leg below pins the reconstruction itself.
    const judged: readonly string[] = [...SCOPE_ROOTS, 'app'];
    const bound: readonly string[] = FIELD_RULE_BOUND_ROOTS;
    const candidates = judged.filter((r) => !bound.includes(r));
    expect(candidates.length).toBeGreaterThan(1); // the sweep is measuring something

    const advised: string[] = [];
    const blocked: string[] = [];
    const silent: string[] = [];
    for (const root of candidates) {
      const source = `${root}.x == 1`;
      const issues = await lintCelPredicate(source, RULE_SLOT_HINT);
      const engine = fieldRuleRootIssue('visibleWhen', source);
      // Verbatim equality with the helper's own output, as elsewhere in this
      // file — never a transcribed string.
      if (engine && issues.some((i) => i.severity === 'warning' && en(i) === engine.message)) advised.push(root);
      else if (issues.some((i) => i.severity === 'error')) blocked.push(root);
      else silent.push(root);
    }

    // The universal, and the single documented exception.
    expect(silent).toEqual([]);
    expect(blocked).toEqual(['app']);
    expect(advised).toEqual(candidates.filter((r) => r !== 'app'));
  });

  it('WHY `app` is the exception: the helper judges it, the platform does not DECLARE it', async () => {
    // The exception is a mechanism, not a special case: the advisory is gated
    // behind `issues.every((i) => i.severity !== 'error')`, and a root the
    // engine does not declare raises a bare-reference ERROR first. `app` is the
    // only judged root in that position — it is AMBIENT (renderer-mounted),
    // which is exactly why the engine's own message for it refuses the
    // `record.app` rewrite by name.
    expect(SCOPE_ROOTS).not.toContain('app');
    expect(fieldRuleRootIssue('visibleWhen', 'app.theme == "dark"')).not.toBeNull();
    const issues = await lintCelPredicate('app.theme == "dark"', RULE_SLOT_HINT);
    expect(issues.some((i) => i.severity === 'error')).toBe(true);
    expect(issues.filter((i) => i.severity === 'warning')).toEqual([]);
  });
});
