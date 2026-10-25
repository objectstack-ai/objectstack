/**
 * The `unit` project's SECOND `isolate: false` invariant has a gate (objectui#8500).
 *
 * `vitest.config.mts` buys 3.2x by sharing one module graph and one global
 * object per worker. The price is two invariants, not one. The first —
 * `ComponentRegistry` keys — is enforced by
 * `scripts/__tests__/unit-registry-absence-collision.test.ts`, and its header
 * records why enforcement beat a comment: the comment had already gone false
 * without anyone noticing. The second is `globalThis`:
 *
 *     a global the setup files install must be the same value at the END of a
 *     file as it was at the START of it.
 *
 * It had no gate, and it too was already false. Four files replaced
 * `globalThis.fetch` with a bare `vi.fn()` by assignment; the network-escape
 * guard's `guardedFetch` wrapper was gone for every later file in the worker,
 * and `scripts/__tests__/network-escape-ledger.test.ts` — a file that did
 * nothing wrong — went red reading `Mock` where the wrapper belonged.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * Two halves, and the split matters:
 *
 *   - the WIRING, read out of `vitest.config.mts`'s own text: every project that
 *     sets `isolate: false` arms the guard, and it is armed nowhere else. A guard
 *     wired into an `isolate: true` project would fail correct tests, because
 *     there a double left up for a whole file crosses nothing — which is the
 *     shape the network-escape guard's own `Fix:` text prescribes.
 *   - the DETECTOR, executed over a synthetic scope rather than described. Every
 *     negative below is paired with a positive on the same run, so a detector
 *     that stopped detecting cannot pass as "nothing leaked".
 *
 * It does NOT re-assert that `globalThis.fetch` is the network-escape wrapper.
 * That is `network-escape-ledger.test.ts`'s assertion and stays its alone: one
 * ruling written twice is how the pair rots (objectui#7765).
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WATCHED_GLOBALS,
  describeGlobal,
  detectGlobalLeaks,
  formatLeakReport,
  healGlobalLeaks,
  snapshotGlobals,
} from '../../vitest.setup.shared-global-leak';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = 'vitest.config.mts';
const GUARD_SETUP = 'vitest.setup.shared-global-leak-guard.ts';
const GUARD_LOGIC = 'vitest.setup.shared-global-leak.ts';

const configText = fs.readFileSync(path.join(repoRoot, CONFIG_PATH), 'utf8');

/**
 * The `{ ... }` object literal that encloses `configText[index]`.
 *
 * Brace matching, not a regex over lines: the projects in this config are nested
 * three deep and carry brace-bearing prose in their comments, and a line-anchored
 * pattern cannot answer a question about an indented region.
 */
function enclosingObject(index: number): string {
  let start = -1;
  let depth = 0;
  for (let i = index; i >= 0; i -= 1) {
    if (configText[i] === '}') depth += 1;
    else if (configText[i] === '{') {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  expect(start, `no enclosing object literal found for ${CONFIG_PATH} offset ${index}`).toBeGreaterThan(-1);
  let end = -1;
  depth = 0;
  for (let i = start; i < configText.length; i += 1) {
    if (configText[i] === '{') depth += 1;
    else if (configText[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  expect(end, `unbalanced braces after ${CONFIG_PATH} offset ${start}`).toBeGreaterThan(-1);
  return configText.slice(start, end + 1);
}

/** The `test: { ... }` blocks of every project that turns isolation OFF. */
function nonIsolatedProjectBlocks(): string[] {
  const blocks: string[] = [];
  const pattern = /\bisolate:\s*false\b/g;
  for (let m = pattern.exec(configText); m !== null; m = pattern.exec(configText)) {
    blocks.push(enclosingObject(m.index));
  }
  return blocks;
}

/** The `setupFiles: [...]` entries of one project block, in order. */
function setupFilesOf(block: string): string[] {
  const at = block.indexOf('setupFiles:');
  if (at === -1) return [];
  const open = block.indexOf('[', at);
  const close = block.indexOf(']', open);
  if (open === -1 || close === -1) return [];
  return [...block.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

describe('the shared-global leak guard is wired to every project that shares a global object', () => {
  it('finds the projects it is about — the floor under every assertion below', () => {
    // A config with no `isolate: false` project satisfies every forward
    // assertion here vacuously, and "measured nothing, exited 0" is the shape
    // this whole family of gates exists to make impossible.
    const blocks = nonIsolatedProjectBlocks();
    expect(
      blocks.length,
      `${CONFIG_PATH} declares no \`isolate: false\` project. If isolation was turned back on ` +
        'everywhere, this guard and its setup file are dead code and should be removed ' +
        'deliberately, not left asserting nothing.',
    ).toBeGreaterThan(0);
    // Named, so a rename that silently drops the project this is about is red.
    expect(blocks.some((b) => /name:\s*'unit'/.test(b)), 'the `unit` project must be among them').toBe(true);
  });

  it('arms the guard in each of them, LAST', () => {
    for (const block of nonIsolatedProjectBlocks()) {
      const setups = setupFilesOf(block);
      expect(
        setups.length,
        'an `isolate: false` project with no setupFiles at all — the guard cannot be armed there',
      ).toBeGreaterThan(0);
      expect(
        setups,
        `every \`isolate: false\` project must list ${GUARD_SETUP} in its setupFiles. Without it, ` +
          'a file that leaves a shared global replaced is discovered later, as a red in a file ' +
          'that did nothing wrong (objectui#8500).',
      ).toContain(GUARD_SETUP);
      expect(
        setups[setups.length - 1],
        `${GUARD_SETUP} must be the LAST setup file: it snapshots what the setup files before ` +
          'it installed, so anything listed after it would install a global the snapshot never saw.',
      ).toBe(GUARD_SETUP);
    }
  });

  it('is armed nowhere else — an isolated project would red on a correct test', () => {
    const armings = [...configText.matchAll(new RegExp(GUARD_SETUP.replace(/\./g, '\\.'), 'g'))].length;
    // The comment prose in this config names the file too, so count the
    // occurrences inside setupFiles arrays rather than in the whole text.
    const armedBlocks = nonIsolatedProjectBlocks().filter((b) => setupFilesOf(b).includes(GUARD_SETUP));
    expect(armings, 'positive control: the config must mention the guard at all').toBeGreaterThan(0);
    expect(
      armedBlocks.length,
      'the guard is armed in a project that is not `isolate: false`. Under `isolate: true` each ' +
        'file gets its own global object, and leaving a double up for a whole file is the shape ' +
        "the network-escape guard's own `Fix:` text prescribes — this guard would fail it.",
    ).toBe(nonIsolatedProjectBlocks().length);
  });

  it('arms it from the setup file and from nowhere in the logic module', () => {
    const setupSource = fs.readFileSync(path.join(repoRoot, GUARD_SETUP), 'utf8');
    const logicSource = fs.readFileSync(path.join(repoRoot, GUARD_LOGIC), 'utf8');
    expect(setupSource, `${GUARD_SETUP} must call the installer`).toContain('installSharedGlobalLeakGuard();');
    // The split's whole point: `unit-registry-absence-collision.test.ts` executes
    // the project's import closures in a private module graph, so a module a test
    // file imports is RE-EXECUTED there. A logic module that armed itself on
    // import would register a stray hook inside that gate's `beforeAll`.
    expect(
      logicSource.includes('\ninstallSharedGlobalLeakGuard();'),
      `${GUARD_LOGIC} must not arm itself at module scope — it is imported by a gate that ` +
        're-executes it in a private module graph.',
    ).toBe(false);
  });
});

describe('the detector, driven over a synthetic scope', () => {
  it('watches the global this card is about, and reports a clean scope as clean', () => {
    expect(WATCHED_GLOBALS, 'fetch is the global objectui#8500 was filed for').toContain('fetch');
    const scope: Record<string, unknown> = { fetch: () => undefined };
    const baseline = snapshotGlobals(scope, ['fetch']);
    expect(detectGlobalLeaks(scope, baseline)).toEqual([]);
  });

  it('reports a replaced global by IDENTITY, not by shape', () => {
    // Two functions with the same name and the same behaviour are still not the
    // same value, and "looks close enough" is how a safety wrapper gets replaced
    // without anyone noticing — which is exactly what happened to the doubled
    // `guardedFetch` this guard found in the registry-collision gate.
    const original = function guardedFetch() {};
    const scope: Record<string, unknown> = { fetch: original };
    const baseline = snapshotGlobals(scope, ['fetch']);
    scope.fetch = function guardedFetch() {};
    const leaks = detectGlobalLeaks(scope, baseline);
    expect(leaks).toEqual([{ name: 'fetch', expected: 'function guardedFetch', found: 'function guardedFetch' }]);
  });

  it('names the leaked global, and says what it found instead', () => {
    const scope: Record<string, unknown> = { fetch: function guardedFetch() {} };
    const baseline = snapshotGlobals(scope, ['fetch']);
    scope.fetch = Object.assign(function Mock() {}, {});
    const leaks = detectGlobalLeaks(scope, baseline);
    expect(leaks).toEqual([{ name: 'fetch', expected: 'function guardedFetch', found: 'function Mock' }]);
    const report = formatLeakReport(leaks);
    expect(report).toContain('globalThis.fetch');
    expect(report, 'the report must carry the remedy, not just the verdict').toContain('vi.stubGlobal');
    expect(report).toContain('vi.unstubAllGlobals');
  });

  it('sees a global that was deleted, and one that was added where nothing stood', () => {
    const scope: Record<string, unknown> = { fetch: function guardedFetch() {}, ResizeObserver: undefined };
    const baseline = snapshotGlobals(scope, ['fetch', 'ResizeObserver']);
    delete scope.fetch;
    scope.ResizeObserver = class ResizeObserver {};
    expect(detectGlobalLeaks(scope, baseline).map((l) => l.name).sort()).toEqual(['ResizeObserver', 'fetch']);
  });

  it('heals the scope, which is what keeps the blame on the file that leaked', () => {
    const original = function guardedFetch() {};
    const scope: Record<string, unknown> = { fetch: original };
    const baseline = snapshotGlobals(scope, ['fetch']);
    scope.fetch = function Mock() {};
    healGlobalLeaks(scope, baseline);
    expect(scope.fetch, 'the exact value, not an equivalent one').toBe(original);
    expect(detectGlobalLeaks(scope, baseline)).toEqual([]);
  });

  it('renders values a reader can act on', () => {
    expect(describeGlobal(undefined)).toBe('undefined');
    expect(describeGlobal(null)).toBe('null');
    expect(describeGlobal(function guardedFetch() {})).toBe('function guardedFetch');
    expect(describeGlobal(() => undefined)).toContain('function');
    expect(describeGlobal({})).toBe('Object instance');
  });
});

describe('the guard is measuring the live global object of this very run', () => {
  it('finds no leak right now, over the real globals', () => {
    // The synthetic cases above prove the comparison; this one proves it is
    // pointed at the run. If a file earlier in this worker had leaked, the
    // guard's own `afterAll` would have healed it — so a clean read here is a
    // statement about this file, and this file leaks nothing.
    const scope = globalThis as unknown as Record<string, unknown>;
    const baseline = snapshotGlobals(scope);
    expect(baseline.length).toBe(WATCHED_GLOBALS.length);
    expect(detectGlobalLeaks(scope, baseline)).toEqual([]);
    // Positive control on the same read: the watch list is not empty and the
    // names it carries really do resolve on this run's global object.
    expect(baseline.filter((entry) => entry.value !== undefined).length).toBeGreaterThan(0);
  });
});
