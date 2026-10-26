/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ActionDef` is a CLOSED surface — objectstack#4075 step 3, pinned at compile
 * time.
 *
 * The card's whole complaint was that the compiler could not help: with
 * `[key: string]: any` on the interface, deleting `ActionDef.execute` produced
 * ZERO compile errors, a typo (`targt`) type-checked, and both sailed through to
 * a runner that then did nothing (objectui#2990, objectstack#2169). Step 3
 * deleted the index signature. These assertions are what makes that deletion a
 * pin rather than a diff.
 *
 * ── Read the `@ts-expect-error` direction carefully ──────────────────────────
 * Each one asserts THE NEXT LINE DOES NOT COMPILE. So a suppression here goes
 * red in the direction most people do not expect: if the key becomes ACCEPTED
 * again — say the index signature is restored — the assignment compiles, the
 * suppression has nothing to suppress, and `tsc` fails the build with
 * "Unused '@ts-expect-error' directive". There is no way to end up quietly
 * green. That inversion is the reverse-verification mechanism for this change
 * and is stated here because it is not the intuitive reading.
 *
 * ── Why a second type-test file, next to `actionKeys.types.test.ts` ──────────
 * They pin different things and fail differently, so neither subsumes the other.
 * That file drives the compiler API over a virtual module and compares the
 * diagnostics against a control interface carrying nothing but an index
 * signature — which is what proves the REJECTIONS come from the promotion and
 * not from some unrelated error. This file states the same contract as ordinary
 * TypeScript that CI compiles directly (via `tsconfig.test.json`), so the
 * pin survives even if the harness's compiler-host plumbing ever breaks, and a
 * reader can see the rejected spellings without decoding a test harness.
 *
 * These assertions are TYPES: this package's own `tsconfig.json` is the BUILD
 * config and excludes `src/**` test files, so without `tsconfig.test.json`
 * (which takes the test tree by GLOB, is chained off `type-check`, and is
 * enforced by `scripts/check-type-check-coverage.mjs`) nothing would compile this
 * file and every pin below would be decoration — the "declared != enforced"
 * landmine objectstack#4115 exists to remove. There is no list entry to earn:
 * the narrow `tsconfig.typetests.json` that once named this file by hand was
 * retired when the package graduated (objectui#4040).
 */

import { describe, it, expect, vi } from 'vitest';
import { ActionRunner, type ActionDef } from '../ActionRunner';
import { ActionEngine } from '../ActionEngine';

// ── Retired and misspelled keys are now compile errors ───────────────────────

// The tombstone. `execute` was removed from `@objectstack/spec` in 17
// (objectstack#3855) and the spec keeps it only so the parser can reject it BY
// NAME with a rename prescription. Before step 3 this line compiled — which is
// the sentence the card was filed over.
// @ts-expect-error - `execute` is retired; the spec's prescription is `target`
const _retiredExecute: ActionDef = { type: 'script', execute: 'markDone' };

// The typo. `targt` reaches no reader, so the action ran and did nothing —
// objectstack#2169's shape, and the case `warnOnUnknownActionKeys` was written
// to make audible while the compiler still could not see it.
// @ts-expect-error - `targt` is a typo for `target`
const _typoTarget: ActionDef = { type: 'script', targt: 'saveRecord' };

// A retired SPEC key that is not a tombstone, to show the closure is general
// rather than a list of two special cases.
// @ts-expect-error - `bulkEnabled` is a retiredKey() tombstone in spec 17
const _retiredBulk: ActionDef = { type: 'api', bulkEnabled: true };

// ── The unified `visible` / `disabled` shape: three arms each ────────────────
//
// The 2026-08-06 maintainer ruling on objectstack#4075 — "统一形状,spec 采纳"
// — gave both keys one shape, `boolean | string(CEL) | { dialect, source }`,
// and `@objectstack/spec` 17.0.0-rc.6 carries it (objectstack#5970). All six
// combinations must type-check; the runtime half is pinned in
// `ActionRunner.disabledGate.test.ts` / `ActionEngine.visibility.test.ts`.

const _visibleBool: ActionDef = { type: 'script', visible: true };
const _visibleCel: ActionDef = { type: 'script', visible: 'record.status == "open"' };
const _visibleEnvelope: ActionDef = {
  type: 'script',
  visible: { dialect: 'cel', source: 'record.status == "open"' },
};

const _disabledBool: ActionDef = { type: 'script', disabled: true };
const _disabledCel: ActionDef = { type: 'script', disabled: 'record.locked' };
const _disabledEnvelope: ActionDef = {
  type: 'script',
  disabled: { dialect: 'cel', source: 'record.locked' },
};

// And the shape is narrow in both directions — a number is neither a literal
// verdict, a CEL string, nor an envelope. Before step 3 the index signature
// swallowed this too, on both keys.
// @ts-expect-error - a number is none of the three arms
const _visibleNumber: ActionDef = { type: 'script', visible: 42 };
// @ts-expect-error - a number is none of the three arms
const _disabledNumber: ActionDef = { type: 'script', disabled: 42 };

// ── The five keys the deletion itself surfaced ───────────────────────────────
//
// Step 3 promoted these; before it they reached their own readers through the
// index signature. Each accepts its declared type and rejects a wrong one, which
// is what separates "promoted to a real field" from "promoted to `any`".

const _description: ActionDef = { type: 'api', description: 'Creates an environment' };
// @ts-expect-error - `description` is a string, not a number
const _descriptionNumber: ActionDef = { type: 'api', description: 42 };

const _navigationAlias: ActionDef = {
  type: 'navigation',
  to: '/records/1',
  external: false,
  newTab: true,
  replace: false,
};
// @ts-expect-error - `newTab` is the boolean switch, not the `openIn` string
const _navNewTabString: ActionDef = { type: 'navigation', to: '/x', newTab: 'new-tab' };

describe('ActionDef is a closed surface (objectstack#4075 step 3)', () => {
  it('states its contract as types, compiled by tsconfig.test.json', () => {
    // The assertions above are the test. This body exists so the file is a
    // legitimate vitest suite as well as a tsc input, and so a reader running
    // the suite sees the pin acknowledged rather than an empty file.
    expect([
      _retiredExecute, _typoTarget, _retiredBulk,
      _visibleBool, _visibleCel, _visibleEnvelope,
      _disabledBool, _disabledCel, _disabledEnvelope,
      _visibleNumber, _disabledNumber,
      _description, _descriptionNumber, _navigationAlias, _navNewTabString,
    ]).toHaveLength(15);
  });
});

/**
 * The JOIN between the two faces — deliberately not a duplicate of either.
 *
 * Both keys already have thorough RUNTIME coverage of all three arms, and it
 * stays where it is: `ActionRunner.disabledGate.test.ts` drives a 12-row shape
 * table through the execution gate (boolean / bare CEL / envelope / `${…}` /
 * junk, both polarities) and `ActionEngine.visibility.test.ts` does the same for
 * `visible` through the location filter. Re-asserting those verdicts here would
 * be coverage theatre.
 *
 * What neither of them can assert is the join, because both reach their runtime
 * through a cast — `runShape` builds a `Record<string, unknown>` and casts
 * `as unknown as ActionDef`, and the visibility suite writes `as ActionDef`.
 * Those casts are correct there (the tables deliberately carry junk shapes like
 * `disabled: 0` that the closed type now rejects), but they mean the existing
 * pins would keep passing even if the declared type stopped admitting the arm
 * being exercised. Step 3's claim is that the SAME literal both type-checks and
 * evaluates, so that is what this asserts: the six consts above — already
 * type-checked by virtue of being `ActionDef` with no cast — reaching a real
 * verdict.
 */
describe('the six unified arms type-check AND evaluate (the same literal, both faces)', () => {
  const CONTEXT = { record: { status: 'open', locked: true }, user: { role: 'admin' } };

  /**
   * Does the runner's `disabled` GATE block this action?
   *
   * Two details, both put here by the negative control below catching a first
   * draft that lacked them:
   *
   * `type` is dropped and an `onClick` handler attached, so the action has
   * something to actually DO. The literals above say `type: 'script'` because
   * that is the natural spelling for a type pin, but a script action with no
   * registered script fails on its own terms — and a first draft that just
   * asked `result.success === false` scored those failures as "blocked" and
   * reported all six arms blocking, including the three that must release.
   *
   * The verdict is then read off the gate's OWN error rather than off
   * `success`, so "the gate blocked it" cannot be confused with "it failed for
   * some other reason" — the same string `ActionRunner.disabledGate.test.ts`
   * asserts.
   */
  async function blocked(action: ActionDef): Promise<boolean> {
    const onClick = vi.fn();
    const result = await new ActionRunner(CONTEXT).execute({ ...action, type: undefined, onClick });
    const isBlocked = result.error === 'Action is disabled';
    expect(onClick.mock.calls.length, 'a blocked action must not run its handler').toBe(isBlocked ? 0 : 1);
    return isBlocked;
  }

  /** Does the engine's location filter keep this action? */
  function shown(action: ActionDef): boolean {
    const engine = new ActionEngine(new ActionRunner(CONTEXT));
    engine.updateContext(CONTEXT);
    engine.registerAction({ ...action, name: 'a' }, { locations: ['record_section'] });
    return engine.getActionsForLocation('record_section').length === 1;
  }

  // Each arm is asserted on BOTH polarities. A positive-only version of these
  // two cases would be green if the gate were ignored altogether — every action
  // runs, every action shows — which is the "passes because nothing is
  // produced" shape. The negative half is what makes the verdict a verdict:
  // these literals are `ActionDef` with no cast, so they carry the type claim
  // too, and each pair moves in opposite directions on the same key.
  const _disabledBoolOff: ActionDef = { type: 'script', disabled: false };
  const _disabledCelOff: ActionDef = { type: 'script', disabled: 'record.status == "closed"' };
  const _disabledEnvelopeOff: ActionDef = {
    type: 'script',
    disabled: { dialect: 'cel', source: 'record.status == "closed"' },
  };
  const _visibleBoolOff: ActionDef = { type: 'api', visible: false };
  const _visibleCelOff: ActionDef = { type: 'api', visible: 'record.status == "closed"' };
  const _visibleEnvelopeOff: ActionDef = {
    type: 'api',
    visible: { dialect: 'cel', source: 'record.status == "closed"' },
  };

  it('`disabled` blocks on all three arms, uncast — and releases on all three', async () => {
    // `record.locked` is true in CONTEXT, so every "on" arm means block; the
    // "off" arms ask about `record.status == "closed"`, which is false.
    expect({
      blocks: [
        await blocked(_disabledBool),
        await blocked(_disabledCel),
        await blocked(_disabledEnvelope),
      ],
      releases: [
        await blocked(_disabledBoolOff),
        await blocked(_disabledCelOff),
        await blocked(_disabledEnvelopeOff),
      ],
    }).toEqual({ blocks: [true, true, true], releases: [false, false, false] });
  });

  it('`visible` shows on all three arms, uncast — and hides on all three', () => {
    // `record.status == "open"` holds in CONTEXT, so every "on" arm means show.
    expect({
      shows: [shown(_visibleBool), shown(_visibleCel), shown(_visibleEnvelope)],
      hides: [shown(_visibleBoolOff), shown(_visibleCelOff), shown(_visibleEnvelopeOff)],
    }).toEqual({ shows: [true, true, true], hides: [false, false, false] });
  });
});
