// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #10504 — `os validate` dropped the whole `UI:` row at zero apps, so a
 * project with no navigable UI read identically to one whose summary simply
 * does not report on UI at all.
 *
 * Measured on the `blank` scaffold (published 17.1.0) and reproduced at this
 * branch's head against the real CLI (`bin/run-dev.js validate`): the only
 * difference between a zero-apps run and a one-app run was one `*.app.ts`
 * plus two config lines, and the `UI:` line was ABSENT (not printed as `0`)
 * for the zero-apps run. Both exited `0`.
 *
 * Triage ruled the shape in issue comment 5366623624: print `UI: 0 Apps`
 * rather than warn — the `blank`/`crud`/`full` templates all ship zero apps
 * deliberately (`src/objects/` only, no `*.app.ts` has ever existed under
 * `packages/create-objectstack/src/templates/**`), so a warning would fire on
 * every clean scaffold's first run.
 *
 * This pins `printMetadataStats` directly (the function `os validate`,
 * `os info` and `os compile` all share) rather than spawning the full CLI —
 * faster, and it isolates the assertion to the rendering logic the fix
 * actually touches, following the `formatZodErrors` unit-test pattern in
 * `format-zod-union.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { printMetadataStats, type MetadataStats } from '../src/utils/format.js';

/** Drop SGR sequences so an assertion reads the words, not chalk's opinion. */
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

/** Run `printMetadataStats` and return everything it printed, as one string. */
function render(stats: MetadataStats): string {
  const captured: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    captured.push(args.map(String).join(' '));
  };
  try {
    printMetadataStats(stats);
  } finally {
    console.log = original;
  }
  return stripAnsi(captured.join('\n'));
}

/** The card's own shape: one object, two fields, no apps — the `blank` scaffold. */
const ZERO_APPS_STATS: MetadataStats = {
  objects: 1,
  objectExtensions: 0,
  fields: 2,
  views: 0,
  pages: 0,
  apps: 0,
  dashboards: 0,
  reports: 0,
  actions: 0,
  flows: 0,
  workflows: 0,
  agents: 0,
  apis: 0,
  positions: 0,
  permissions: 0,
  datasources: 0,
  translations: 0,
  plugins: 0,
  devPlugins: 0,
};

/** The card's "one app" run: identical, plus one app. */
const ONE_APP_STATS: MetadataStats = { ...ZERO_APPS_STATS, apps: 1 };

describe('[#10504] printMetadataStats renders the UI: row at zero apps', () => {
  it('prints "UI: 0 Apps" — not an absent row — when apps=0', () => {
    const out = render(ZERO_APPS_STATS);
    // The regression: before the fix this line was NOT in the output at all,
    // and `out` would contain no `UI:` line whatsoever.
    expect(out).toContain('UI: 0 Apps');
  });

  it('the 0→1 transition triage said should become legible: prints "UI: 1 Apps" for one app', () => {
    const out = render(ONE_APP_STATS);
    expect(out).toContain('UI: 1 Apps');
    // And NOT the zero-apps line — the two ends must read differently.
    expect(out).not.toContain('UI: 0 Apps');
  });

  it('control: Data: keeps rendering unaffected (its section carries no zeroFallback)', () => {
    const out = render(ZERO_APPS_STATS);
    expect(out).toContain('Data: 1 Objects  2 Fields');
  });

  it('does not widen the fix to Logic:/Security: — those sections still drop the whole row at zero (tracked separately in #10952)', () => {
    // Every Logic/Security item is 0 in ZERO_APPS_STATS. This asserts today's
    // (still-general, unresolved) drop behavior for the sections #10504's
    // triage ruling did NOT name, so an unrelated future change that widens
    // zeroFallback to them fails HERE first, loudly, rather than silently
    // drifting past this card's narrow scope. If #10952 lands the wider fix,
    // this assertion is the deliberate one to update — name it in that PR.
    const out = render(ZERO_APPS_STATS);
    expect(out).not.toContain('Logic:');
    expect(out).not.toContain('Security:');
  });
});
