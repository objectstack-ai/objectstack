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

/**
 * #10952's harsher fixture: a stack that declares nothing at all, so EVERY
 * section is empty — including `Data:`, which the `blank` scaffold's one object
 * keeps populated. Before the fix this rendered the single line `UI: 0 Apps`.
 */
const ALL_ZERO_STATS: MetadataStats = { ...ZERO_APPS_STATS, objects: 0, fields: 0 };

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

  // #10504's fourth test asserted the NARROW scope it shipped with: that
  // `Logic:`/`Security:` still dropped their whole row at zero. That card named
  // this assertion as "the deliberate one to update" if #10952 landed the wider
  // fix. #10952 landed it — triage generalised the principle (a summary section
  // is never silently dropped; every section prints its zero state) — so the
  // assertion is replaced, deliberately and by name, with the per-section pins
  // in the next describe block.
});

/**
 * #10952 — the same drop, measured on the rows #10504 did not rule on.
 *
 * Reproduced at this branch's base against the real CLI (`bin/run-dev.js
 * validate`, `NO_COLOR=1`) on two fixture stacks. One object, two fields and
 * nothing else printed exactly:
 *
 *     Data: 1 Objects  2 Fields
 *     UI: 0 Apps
 *
 * No `Logic:` line, no `Security:` line — absent, not `0`. A stack declaring no
 * objects either printed the single line `UI: 0 Apps`, losing `Data:` too. Both
 * exited `0`, which is why the hole stayed invisible: nothing failed, the rows
 * just were not there, and "none of it" is indistinguishable from "not
 * reported on".
 *
 * Triage (issue comment 5380549313) generalised #10504's ruling: a summary
 * section is NEVER silently dropped; every section prints its zero state. The
 * constraint it set is consistency with the shipped `UI: 0 Apps` shape, not a
 * specific string.
 *
 * One pin PER SECTION, deliberately: each asserts only its own row, so deleting
 * one section's zero rendering fails that section's pin and no other. A single
 * aggregate assertion would go red for all four and could not tell you which
 * row regressed.
 */
describe('[#10952] printMetadataStats prints every section\'s zero state — no row is silently dropped', () => {
  it('Data: prints "Data: 0 Objects" when every Data item is 0', () => {
    const out = render(ALL_ZERO_STATS);
    // Before the fix `ALL_ZERO_STATS` rendered no `Data:` line whatsoever.
    expect(out).toContain('Data: 0 Objects');
  });

  it('UI: still prints "UI: 0 Apps" — the shipped #10504 shape, unchanged at all-zero', () => {
    const out = render(ALL_ZERO_STATS);
    expect(out).toContain('UI: 0 Apps');
  });

  it('Logic: prints "Logic: 0 Flows" when every Logic item is 0', () => {
    const out = render(ZERO_APPS_STATS);
    // `Flows` carries this section's signal the way `Apps` carries `UI:`'s.
    expect(out).toContain('Logic: 0 Flows');
  });

  it('Security: prints BOTH peers — "Security: 0 Positions  0 Permissions"', () => {
    const out = render(ZERO_APPS_STATS);
    // Two independently authorable peers and no canonical single signal, so
    // naming one would print a zero state that silently omits the other.
    // Printing both keeps the zero row's item set identical to its non-zero
    // rendering — same `<count> <Item>` fragments, same two-space join as the
    // shipped `UI: 0 Apps`.
    expect(out).toContain('Security: 0 Positions  0 Permissions');
  });

  it('a non-zero item still suppresses its section\'s zero rendering — the fallback is the empty case only', () => {
    // One flow: `Logic:` must report the real count and NOT fall back.
    const out = render({ ...ZERO_APPS_STATS, flows: 1 });
    expect(out).toContain('Logic: 1 Flows');
    expect(out).not.toContain('Logic: 0 Flows');
    // The peer section is untouched by that — asserted as ROW PRESENCE, not as
    // its exact fragments, so this test stays sensitive to `Logic:` alone and
    // the `Security:` rendering is pinned in exactly one place above.
    expect(out).toContain('Security:');
  });

  it('a partially-populated Security: reports only its non-zero peer, not the zero fallback', () => {
    const out = render({ ...ZERO_APPS_STATS, permissions: 3 });
    expect(out).toContain('Security: 3 Permissions');
    expect(out).not.toContain('0 Positions');
  });
});
