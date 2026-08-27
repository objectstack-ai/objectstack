// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#12563] THE CLI's COPY OF THE CONTESTED-FLOW PHRASE, HELD EQUAL TO THE
// ENGINE's — by agreement, not by a shared runtime import.
//
// ## What was wrong
//
// One event — a flow name claimed by more than one definition — was described
// to an operator in three places, each with its own private `const describe`:
// twice inside `@objectstack/service-automation` and once here, in the startup
// banner. Nothing held them equal, and two axes had ALREADY drifted before
// anyone noticed: the engine's precedence warning double-quoted the package id
// while the other two single-quoted it, and the two engine copies interpolated
// a bare `undefined` where this one renders a real fallback.
//
// The two engine copies are now one exported renderer, `renderFlowContender`.
// This file is what holds the THIRD copy — the one in this package — to it.
//
// ## ⛔ Why this is a TEST-only import and `format.ts` still renders its own
//
// The obvious fix is for `format.ts` to import the renderer and call it. It is
// the wrong fix here, and the reason is measured rather than stylistic:
//
//   - `packages/cli` takes ZERO static value imports of
//     `@objectstack/service-automation` today. Its only value import of that
//     package is a DYNAMIC `await import()` in `utils/data-migration-plugins.ts`,
//     deferred behind `opts.automation === true`.
//   - `collectAutomationSummary` reads the engine STRUCTURALLY and feature-
//     detects every probe (#12028/#12562) precisely so a host running an OLDER
//     automation package still boots its banner. A value import states a
//     guarantee that runtime deliberately does not make.
//   - `utils/format.ts` is imported by ~56 command modules in this package. A
//     static import here would pull the whole automation package into the
//     module graph of `os whoami`, `os init`, `os login` — every command.
//
// A TEST is not the shipped runtime path, and `@objectstack/service-automation`
// is already a workspace dependency, so importing the renderer HERE costs none
// of that. The banner keeps its own spelling; this file is what makes the two
// spellings a fact rather than a coincidence.
//
// ⚠️ This specifier resolves through the package's `exports` to its **dist**,
// not its source — it is already registered for this package in
// `KNOWN_UNALIASED_TEST_IMPORTS['@objectstack/cli']` (that shrink-only ledger is
// NOT widened by this file; the specifier was already reachable via the dynamic
// import named above). `turbo.json` declares `@objectstack/cli#test`
// `dependsOn: ["build"]`, so CI builds it first. Locally: build
// `@objectstack/service-automation` before running this, or the named import
// below fails to link and says so.
//
// ⛔ Deliberately NOT aliased to source in `vitest.config.ts`. Aliasing a dep to
// source imports that dep's ENTIRE import surface into this package's
// resolution domain (see `scripts/check-test-source-alias.mjs` and this
// package's vitest config header) — a config change reaching all ~185 test
// files here, to buy staleness-resistance on one three-branch pure function.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderFlowContender } from '@objectstack/service-automation';
import { printServerReady, type ServerReadyOptions, type AutomationReadySummary } from './format.js';

type Contender = { source: 'package' | 'runtime'; packageId?: string };

const base: ServerReadyOptions = {
  externalBaseOrigin: 'http://localhost:3000',
  configFile: 'objectstack.config.ts',
  isDev: true,
  pluginCount: 1,
};

/**
 * The banner summary shaped by hand rather than through
 * `collectAutomationSummary`: this file is about the RENDERING of one contender,
 * so the collection step is deliberately not in the loop. The end-to-end path
 * from a fake engine through the collector is covered by
 * `commands/serve-automation-shadowing.test.ts`.
 */
const summaryWith = (armed: Contender, shadowedCount = 1): AutomationReadySummary => ({
  enabled: true,
  declaredFlowCount: 1,
  flowCount: 1,
  boundCount: 1,
  triggerTypes: ['record_change'],
  unbound: [],
  unknownObject: [],
  draftCount: 0,
  shadowed: [{ flowName: 'send-welcome', armed, shadowedCount }],
});

describe('#12563 — the banner phrase for a contested flow agrees with the engine renderer', () => {
  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    // stderr, not stdout (#7915) — the whole banner is a diagnostic.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      lines.push(args.join(' '));
    });
  });
  afterEach(() => spy.mockRestore());

  const shadowLine = (armed: Contender) => {
    printServerReady({ ...base, automation: summaryWith(armed) });
    const shown = lines.filter((l) => l.includes('is claimed by'));
    expect(shown).toHaveLength(1);
    return shown[0];
  };

  // One row per branch of the renderer, so a drift on ONE axis fails the row
  // for that axis instead of collapsing the file. The assertion is
  // `toContain(renderFlowContender(c))`, which is red in BOTH directions: it
  // fails if this package's `describeFlowBody` changes, and it fails if the
  // engine's renderer changes underneath it.
  it('spells a packaged contender exactly as the engine spells it', () => {
    const armed: Contender = { source: 'package', packageId: 'crm' };
    expect(shadowLine(armed)).toContain(renderFlowContender(armed));
  });

  it('spells a runtime overlay row exactly as the engine spells it', () => {
    const armed: Contender = { source: 'runtime' };
    expect(shadowLine(armed)).toContain(renderFlowContender(armed));
  });

  it('spells an absent package id exactly as the engine spells it — and never as `undefined`', () => {
    const armed: Contender = { source: 'package' };
    const line = shadowLine(armed);
    expect(line).toContain(renderFlowContender(armed));
    // The axis this pin exists for, stated independently of the renderer: if
    // BOTH sides regressed to interpolation at once the agreement above would
    // still hold, and this row would not.
    expect(line).not.toContain('undefined');
  });

  // ── The instrument can say no ─────────────────────────────────────────────
  it('would notice a disagreement — the comparison is not vacuous', () => {
    const armed: Contender = { source: 'package', packageId: 'crm' };
    const line = shadowLine(armed);
    // The pre-#12563 engine spelling of the SAME contender. If `toContain`
    // could not tell the two apart, every row above would pass no matter what
    // either side rendered.
    expect(line).not.toContain(`package "${armed.packageId}"`);
    expect(renderFlowContender(armed)).not.toBe(`package "${armed.packageId}"`);
  });
});
