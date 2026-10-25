/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#6985 (Card R) — pins on the INSTALLED `@objectstack/spec` wizard
 * door, gated on the installed schema's own behaviour.
 *
 * The objectstack Card S tightening (objectstack#13622 D2/D3/D7, ruled
 * 2026-08-31; landed as objectstack PR #13733) makes `FormViewSchema` refuse
 * the wizard-inert step keys, refuse an absent/empty-`sections` wizard, and
 * teach the `steps:` spelling at the point of refusal. That door is what keeps
 * authored metadata from ever reaching WizardForm carrying keys it drops — so
 * this repo wants pins on it. But the door ships with a spec RELEASE, and this
 * repo's lockfile pins `@objectstack/spec` 17.2.0, which predates it
 * (installability gate, objectui#6985: never assert against a contract the
 * installed dependency does not carry).
 *
 * ## How the gate works (capability probe, not a version string)
 *
 * The file probes the installed `FormViewSchema` once — does it refuse a
 * wizard step carrying `visibleWhen`? — and runs exactly ONE of the two
 * describe halves:
 *
 *  - post-tightening half: pins the refusals and their prescriptions. Skipped
 *    today; activates by itself on the lockfile bump that brings Card S in,
 *    with zero edits here.
 *  - pre-tightening half: pins TODAY's accept-set (17.2.x accepts the
 *    wizard-inert step keys and the empty-sections wizard), so a run's output
 *    records which regime it measured instead of silently skipping. It
 *    deactivates by itself on the same bump.
 *
 * A version-string gate would encode a guess about WHICH release carries the
 *  tightening; the behaviour probe measures the thing itself.
 *
 * Importing the spec's view schema here is the sanctioned drift-guard use —
 * the same class as `sectionFields.spec-parity.test.ts` (this file exists to
 * measure the installed contract, not to type a renderer against it).
 */

import { describe, it, expect } from 'vitest';
import { FormViewSchema } from '@objectstack/spec/ui';

/** A clean wizard step — the shape the two real in-corpus wizards use. */
const step = { name: 's1', label: 'Step 1', fields: ['subject'] };

const wizard = (over: Record<string, unknown> = {}) => ({
  type: 'wizard',
  sections: [step],
  ...over,
});

const parse = (view: unknown) => FormViewSchema.safeParse(view);

/** One issue-list flattening for message asserts. */
const messagesOf = (view: unknown): string => {
  const res = parse(view);
  return res.success ? '' : res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
};

// ── The capability probe ────────────────────────────────────────────────────
const stepWithPredicate = wizard({ sections: [{ ...step, visibleWhen: 'true' }] });
const installedSpecCarriesWizardTightening = !parse(stepWithPredicate).success;

describe('#6985 — the installed-spec wizard door, both regimes', () => {
  it('POSITIVE CONTROL: the minimal stepped wizard parses on every spec line', () => {
    // Every assertion below reads acceptance/refusal off fixtures derived from
    // this one. If THIS fails, the fixtures are malformed for an unrelated
    // reason and nothing else in the file is a measurement.
    expect(parse(wizard()).success).toBe(true);
  });

  it('`steps:` is refused on the strict surface — on every spec line', () => {
    // 17.2.0 already refuses it as an unknown key (strict object); the
    // tightened spec refuses it WITH the ruled prescription (pinned below).
    // Never an accepted alias, on either line (objectstack#13622 T1).
    expect(parse(wizard({ steps: [step] })).success).toBe(false);
  });
});

describe.runIf(installedSpecCarriesWizardTightening)(
  '#6985 — post-Card-S: the door refuses what WizardForm drops (active once the lockfile carries the tightening)',
  () => {
    it('refuses `visibleWhen` on a wizard step, naming the ruled reason', () => {
      const msgs = messagesOf(stepWithPredicate);
      expect(msgs).toContain('visibleWhen');
      expect(msgs).toContain('wizard steps carry no predicate slot');
    });

    it('refuses the deprecated `visibleOn` alias the same way (folded before the refinement)', () => {
      expect(parse(wizard({ sections: [{ ...step, visibleOn: 'true' }] })).success).toBe(false);
    });

    it('refuses `collapsible: true` and `collapsed: true` on a wizard step', () => {
      for (const key of ['collapsible', 'collapsed'] as const) {
        const msgs = messagesOf(wizard({ sections: [{ ...step, [key]: true }] }));
        expect(msgs, key).toContain(key);
        expect(msgs, key).toContain('wizard steps do not collapse');
      }
    });

    it('accepts an authored `false` for both collapse keys — it declares exactly what a wizard delivers', () => {
      // The measured boundary Card S calls out: both keys carry
      // `.default(false)`, so only `true` declares behaviour a step lacks.
      expect(parse(wizard({ sections: [{ ...step, collapsible: false, collapsed: false }] })).success).toBe(true);
    });

    it('refuses the empty-`sections` wizard — the shape that silently rendered simple', () => {
      const msgs = messagesOf(wizard({ sections: [] }));
      expect(msgs).toContain('must declare its steps');
    });

    it('refuses the absent-`sections` wizard the same way', () => {
      expect(parse({ type: 'wizard' }).success).toBe(false);
    });

    it('carries the `steps:` prescription — sections ARE the steps, in array order', () => {
      const msgs = messagesOf(wizard({ steps: [step] }));
      expect(msgs).toContain('steps');
      expect(msgs).toContain('sections');
    });

    it('CONTROL: the refusal is wizard-scoped — a tabbed section keeps its predicate slot', () => {
      expect(parse({ type: 'tabbed', sections: [{ ...step, visibleWhen: 'true' }] }).success).toBe(true);
    });
  },
);

describe.runIf(!installedSpecCarriesWizardTightening)(
  '#6985 — pre-Card-S: the installed 17.2.x accept-set, recorded (deactivates on the lockfile bump)',
  () => {
    it('still accepts the wizard-inert step keys and the empty-sections wizard', () => {
      // NOT an endorsement — this is the accept-set the Card S door closes,
      // pinned so this suite's output states which spec line it measured.
      // objectui's own guards for this regime are the renderer-side pins
      // (`wizardRuledSemantics-6985.test.tsx`: the keys are dropped, the
      // empty wizard degrades to simple) and the compile-time step type.
      expect(parse(stepWithPredicate).success).toBe(true);
      expect(parse(wizard({ sections: [{ ...step, collapsible: true, collapsed: true }] })).success).toBe(true);
      expect(parse(wizard({ sections: [] })).success).toBe(true);
      expect(parse({ type: 'wizard' }).success).toBe(true);
    });
  },
);
