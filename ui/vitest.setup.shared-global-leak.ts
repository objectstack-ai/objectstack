/**
 * ObjectUI — shared-global leak detection (objectui#8500)
 *
 * The logic half of `vitest.setup.shared-global-leak-guard.ts`, which is the
 * SETUP FILE that arms it. Split for the same reason `vitest.setup.i18n-global.ts`
 * is split out of `vitest.setup.base.ts`, plus one specific to this guard:
 *
 * `scripts/__tests__/unit-registry-absence-collision.test.ts` executes the unit
 * project's import closures in a private module graph, so ANY module a test file
 * names as an import specifier is re-executed there. A module whose body calls
 * `afterAll` would register a stray hook in the middle of that gate's `beforeAll`.
 * This file's body registers nothing and touches no global, so its consumers —
 * that gate included — can import it freely; the arming happens only where
 * `installSharedGlobalLeakGuard()` is CALLED, which is the setup file alone.
 *
 * Why the guard exists at all, and why an `afterAll` in a setup file is the only
 * place it can live, is written out in that setup file's header.
 */
import { afterAll } from 'vitest';

/**
 * The globals the root setup graph installs, and that a later file therefore
 * inherits rather than builds.
 *
 * `fetch` is `vitest.setup.network-escape-guard.ts`'s recording wrapper. The
 * three below it are `vitest.setup.base.ts`'s: the `Storage` pair it rebuilds
 * per file (objectui#7271) and the `ResizeObserver` polyfill Radix reaches for.
 *
 * Deliberately a NAMED list rather than a diff of every own property of
 * `globalThis`: a test that installs a global of its own is not the defect here,
 * and a guard that reds on those would be turned off within the week.
 */
export const WATCHED_GLOBALS = [
  'fetch',
  'localStorage',
  'sessionStorage',
  'ResizeObserver',
] as const;

/** What `globalThis` held for each watched name when the file started. */
export type GlobalBaseline = ReadonlyArray<{ name: string; value: unknown }>;

/** One watched global that a file replaced and did not put back. */
export type GlobalLeak = { name: string; expected: string; found: string };

/** A short, comparable rendering of a global's value for the failure message. */
export function describeGlobal(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return `function ${value.name === '' ? '<anonymous>' : value.name}`;
  if (typeof value === 'object') {
    const ctor = (value as { constructor?: { name?: string } }).constructor;
    return `${ctor?.name ?? 'Object'} instance`;
  }
  return typeof value;
}

/** Read the current value of each watched global out of `scope`. */
export function snapshotGlobals(
  scope: Record<string, unknown>,
  names: ReadonlyArray<string> = WATCHED_GLOBALS,
): GlobalBaseline {
  return names.map((name) => ({ name, value: scope[name] }));
}

/**
 * Which watched globals no longer hold the value they held at `baseline`.
 *
 * Identity, not shape: a double that behaves like `fetch` is still not the
 * wrapper the run is guarded by, and "looks close enough" is how a safety guard
 * gets silently replaced.
 */
export function detectGlobalLeaks(
  scope: Record<string, unknown>,
  baseline: GlobalBaseline,
): GlobalLeak[] {
  const leaks: GlobalLeak[] = [];
  for (const entry of baseline) {
    if (scope[entry.name] === entry.value) continue;
    leaks.push({
      name: entry.name,
      expected: describeGlobal(entry.value),
      found: describeGlobal(scope[entry.name]),
    });
  }
  return leaks;
}

/** Put every leaked global back, so the next file in this worker starts clean. */
export function healGlobalLeaks(scope: Record<string, unknown>, baseline: GlobalBaseline): void {
  for (const entry of baseline) {
    if (scope[entry.name] === entry.value) continue;
    scope[entry.name] = entry.value;
  }
}

/** The message the leaking file goes red with. */
export function formatLeakReport(leaks: ReadonlyArray<GlobalLeak>): string {
  return [
    `Shared-global leak: this test FILE left ${leaks.length === 1 ? 'a global' : 'globals'} replaced.`,
    ...leaks.map((l) => `  - globalThis.${l.name}: expected ${l.expected}, found ${l.found}`),
    '',
    'This project runs `isolate: false` — one global object per worker — so the',
    'value above is what every LATER file in this worker would have inherited. It',
    'has been put back, so this file is the only one that reds; without that, the',
    'failure would have surfaced in a file that did nothing wrong, in some shards',
    'and not others (objectui#8500).',
    '',
    'Fix: install the double with `vi.stubGlobal(name, double)` and hand it back',
    'with `vi.unstubAllGlobals()` in an `afterAll`. A bare `globalThis.x = ...` /',
    '`global.x = ...` assignment cannot be undone by `vi.unstubAllGlobals()` or by',
    '`vi.restoreAllMocks()` — neither knows the value was ever replaced.',
    '',
    'If the global genuinely has to stay replaced for the whole file (a component',
    'that reads after the test body returns), that is still fine: install it once',
    'at module scope with `vi.stubGlobal` and unstub in `afterAll`, which runs',
    'after the last test and before this check.',
  ].join('\n');
}

/**
 * Register the per-file check. Called at module scope below; exported so the pin
 * test can assert the wiring rather than infer it.
 */
export function installSharedGlobalLeakGuard(
  scope: Record<string, unknown> = globalThis as unknown as Record<string, unknown>,
): void {
  const baseline = snapshotGlobals(scope);
  afterAll(() => {
    const leaks = detectGlobalLeaks(scope, baseline);
    // Heal FIRST: a throw below must not also cost the next file its globals.
    healGlobalLeaks(scope, baseline);
    if (leaks.length > 0) throw new Error(formatLeakReport(leaks));
  });
}
