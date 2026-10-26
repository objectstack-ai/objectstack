import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is now itself an error (TS2578). See objectui#3494.
import {
  FLOORS,
  KNOWN_SHAPE_MISMATCHES,
  conflicts,
  describeShape,
  findOverrides,
  scan,
  summarise,
} from '../check-vi-mock-override-shape.mjs';
import { COVERED_SPECIFIERS } from '../check-vi-mock-inherit.mjs';

/**
 * objectui#8903 — the test for `scripts/check-vi-mock-override-shape.mjs`.
 *
 * ## Why the ablation legs here are the whole point
 *
 * The gate is GREEN AT REST: there are zero override/declaration shape
 * mismatches in the tree today. A green run therefore proves only that the tree
 * is clean — it cannot tell a working gate from one that matches nothing, and
 * "matches nothing" is exactly what the two existing `vi.mock` gates did on this
 * class. Both printed a BYTE-IDENTICAL verdict line and exit 0 with the thirteen
 * drifted stubs sitting on disk. A gate's green on a class it is structurally
 * blind to is not a reading.
 *
 * So this file carries BOTH directions, and neither is decoration:
 *
 *   - the POSITIVE control (`the historical thirteen`): the real drift,
 *     reconstructed byte-for-byte from PR #8902's pre-image
 *     (`useRecordPresence: () => ({ viewers: [], others: [] })` against a hook
 *     declared `PresenceUser[]`), driven end to end through the CLI for the exit
 *     code, and through `scan()` for the message;
 *   - the NEGATIVE controls: the repaired form, every `unknown`-side spelling,
 *     a CALLABLE interface (which is a function at runtime and must not be read
 *     as an object), and the real tree at scale — because a gate that reddens on
 *     correct code gets deleted rather than fixed.
 *
 * ## Fixture discipline: never write a matchable call site into this source
 *
 * This file is inside the gate's own scan scope. The gate reads the TypeScript
 * AST, so it sees CALL EXPRESSIONS — a `vi.mock(...)` written as real syntax
 * here would be judged like any other. Every fixture below is therefore built as
 * a STRING and written to a temp tree; the only occurrences in this source are
 * inside template literals, which are not call expressions at all. Same
 * discipline, and the same reason, as `check-vi-mock-inherit.test.ts`.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A quote, from its code point — see "Fixture discipline" above. */
const Q = String.fromCharCode(39);

const GATE = 'check-vi-mock-override-shape.mjs';

/** Every module the gate reaches by relative import, for the probe copies. */
const GATE_MODULES = [GATE, 'check-vi-mock-inherit.mjs', 'invoked-as.mjs', 'js-comment-mask.mjs'];

/** The drifted stub, exactly as PR #8902's pre-image carried it, all 13 times. */
const DRIFTED = `useRecordPresence: () => ({ viewers: [], others: [] }),`;

/** What PR #8902 replaced it with. */
const REPAIRED = `useRecordPresence: () => [],`;

/**
 * A `vi.mock` factory over `@object-ui/collaboration` that INHERITS the real
 * module (so `check-vi-mock-inherit` is satisfied) and overrides `overrides`.
 * This is the shape all thirteen historical files had.
 */
function mockSource(overrides: string): string {
  return [
    `import { vi } from ${Q}vitest${Q};`,
    ``,
    `vi.mock(${Q}@object-ui/collaboration${Q}, async (importOriginal) => ({`,
    `  ...(await importOriginal<Record<string, unknown>>()),`,
    `  ${overrides}`,
    `  PresenceAvatars: () => null,`,
    `}));`,
    ``,
  ].join('\n');
}

/**
 * A temp tree holding a workspace package whose export shapes are declared, and
 * one test file carrying the mock. Returns the root and the relative file list
 * to hand `scan`, so nothing here depends on `git ls-files`.
 */
function fixture(
  overrides: string,
  opts: { provider?: string; index?: string; filler?: number } = {},
): { root: string; files: string[]; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-mock-override-shape-'));
  const pkg = path.join(root, 'packages', 'collaboration');
  fs.mkdirSync(path.join(pkg, 'src'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@object-ui/collaboration' }));
  fs.writeFileSync(
    path.join(pkg, 'src', 'index.ts'),
    opts.index ?? `export { useRecordPresence, PresenceAvatars } from './PresenceProvider.js';\n`,
  );
  fs.writeFileSync(
    path.join(pkg, 'src', 'PresenceProvider.tsx'),
    opts.provider ??
      [
        `export interface PresenceUser { userId: string }`,
        ``,
        `export function useRecordPresence(`,
        `  objectName: string | undefined,`,
        `  recordId: string | undefined,`,
        `): PresenceUser[] {`,
        `  return [];`,
        `}`,
        ``,
        `export function PresenceAvatars(): JSX.Element | null {`,
        `  return null;`,
        `}`,
        ``,
      ].join('\n'),
  );

  const testDir = path.join(root, 'packages', 'app-shell', 'src', 'views');
  fs.mkdirSync(testDir, { recursive: true });
  fs.writeFileSync(path.join(testDir, 'RecordDetailView.fixture.test.tsx'), mockSource(overrides));

  const files = [
    'packages/collaboration/package.json',
    'packages/collaboration/src/index.ts',
    'packages/collaboration/src/PresenceProvider.tsx',
    'packages/app-shell/src/views/RecordDetailView.fixture.test.tsx',
  ];

  // A clean population around the one site under test, so that a red run means
  // the MISMATCH and not the vacuity floor. Without it the probe tree collapses
  // and both legs exit 1 -- which would make the exit code prove nothing, the
  // exact confound this gate exists to catch one level up.
  const filler = opts.filler ?? 0;
  if (filler > 0) {
    const dir = path.join(root, 'packages', 'app-shell', 'src', 'filler');
    fs.mkdirSync(dir, { recursive: true });
    const body = mockSource(`useRecordPresence: () => [],`);
    for (let i = 0; i < filler; i++) {
      fs.writeFileSync(path.join(dir, `filler-${i}.test.tsx`), body);
      files.push(`packages/app-shell/src/filler/filler-${i}.test.tsx`);
    }
  }

  return {
    root,
    files,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

/** Enough clean sites to clear every floor in `FLOORS`. */
const CLEAN_POPULATION = 1001;

/** `scan` with the vacuity floors disabled — those have their own cases. */
function scanFixture(overrides: string, opts: Parameters<typeof fixture>[1] = {}) {
  const f = fixture(overrides, opts);
  try {
    return scan(f.root, { files: f.files, floors: {} });
  } finally {
    f.cleanup();
  }
}

/**
 * A runnable copy of the gate over an arbitrary root, for the exit code. The
 * gate resolves its own repo root from its file location, so the copy has to
 * live in the probe. `node_modules` is symlinked rather than copied because the
 * gate imports `typescript` — which is the whole reason it cannot live in the
 * pre-install workflow its two siblings share.
 */
function runGateIn(root: string): { status: number; stdout: string; stderr: string } {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  for (const m of GATE_MODULES) fs.copyFileSync(path.join(repoRoot, 'scripts', m), path.join(root, 'scripts', m));
  fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  try {
    const stdout = execFileSync('node', [`scripts/${GATE}`], { cwd: root, encoding: 'utf8' });
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// ---------------------------------------------------------------------------
// The positive control — the direction that matters
// ---------------------------------------------------------------------------

describe('the historical thirteen (objectui#8083 / PR #8902)', () => {
  it('reddens the drifted stub and names the export, the declared shape and the stub shape', () => {
    const result = scanFixture(DRIFTED);

    expect(result.unregistered, 'the drift must be a finding — a green here is the defect itself').toHaveLength(1);
    const [m] = result.unregistered;
    expect(m.exportName).toBe('useRecordPresence');
    expect(m.specifier).toBe('@object-ui/collaboration');
    expect(m.declared).toBe('a function returning an array');
    expect(m.actual).toBe('a function returning an object');
    expect(m.file).toContain('RecordDetailView.fixture.test.tsx');
    expect(m.declaredAt).toContain('PresenceProvider.tsx');
    expect(m.text).toContain('viewers');
  });

  it('goes GREEN on the repaired stub — the other leg of the same mutation', () => {
    const result = scanFixture(REPAIRED);
    expect(result.unregistered).toHaveLength(0);

    // Not merely silent: the site must still be JUDGED, and judged to the
    // RETURN shape -- the depth the drift lives at.
    const site = result.sites.find((x) => x.exportName === 'useRecordPresence');
    expect(site?.verdict).toBe('match');
    expect(site?.declared).toBe('a function returning an array');
    expect(site?.actual).toBe('a function returning an array');
    expect(result.census.deep).toBeGreaterThan(0);
  });

  it('exits 1 end to end on the drift, and 0 on the repair', () => {
    for (const [overrides, expected] of [
      [DRIFTED, 1],
      [REPAIRED, 0],
    ] as const) {
      const f = fixture(overrides, { filler: CLEAN_POPULATION });
      try {
        const run = runGateIn(f.root);
        // The population clears every floor either way, so the exit code here
        // is about the OVERRIDE and nothing else.
        expect(run.stderr, 'the probe tree must not be vacuous, or the exit code proves nothing').not.toContain('COLLAPSED');
        expect(run.status, `${overrides} must exit ${expected}`).toBe(expected);
        if (expected === 1) {
          expect(run.stderr).toContain('1 override(s) do not match the declared export');
          expect(run.stderr).toContain('useRecordPresence');
          expect(run.stderr).toContain('a function returning an array');
          expect(run.stderr).toContain('a function returning an object');
        } else {
          expect(run.stdout).toContain('check-vi-mock-override-shape: OK');
        }
      } finally {
        f.cleanup();
      }
    }
  }, 60_000);
});

// ---------------------------------------------------------------------------
// The negative controls — a gate that reddens correct code gets deleted
// ---------------------------------------------------------------------------

describe('never reddens what it cannot read with certainty', () => {
  // Nothing about the VALUE is readable, so the site is counted and never judged.
  const opaqueOverrides = [
    ['a vi.fn()', `useRecordPresence: vi.fn(),`],
    ['an identifier', `useRecordPresence: stubPresence,`],
    ['a call', `useRecordPresence: makeStub(),`],
  ] as const;

  for (const [label, override] of opaqueOverrides) {
    it(`counts but never judges ${label}`, () => {
      const result = scanFixture(override);
      expect(result.unregistered).toHaveLength(0);
      expect(result.census.overrides, 'it must still be COUNTED — an uncounted site is an invisible one').toBeGreaterThan(0);
      const site = result.sites.find((s) => s.exportName === 'useRecordPresence');
      expect(site?.verdict).toBe('opaque');
    });
  }

  // The value IS a function, so the KIND is judged; what it returns is not.
  // This is the honest middle of the gate's reach and is pinned as such: the
  // stub is compared at the level the gate can read, and never below it.
  const shallowOverrides = [
    ['a function returning an identifier', `useRecordPresence: () => stubValue,`],
    ['a function returning a call', `useRecordPresence: () => makeStub(),`],
  ] as const;

  for (const [label, override] of shallowOverrides) {
    it(`judges the KIND of ${label} but never its return`, () => {
      const result = scanFixture(override);
      expect(result.unregistered).toHaveLength(0);
      const site = result.sites.find((s) => s.exportName === 'useRecordPresence');
      expect(site?.verdict).toBe('match');
      expect(site?.declared).toBe('a function returning an array');
      expect(site?.actual).toBe('a function returning unknown');
    });
  }

  it('still reddens a wrong KIND even when the return is unreadable', () => {
    // The reach above is not an escape hatch: stub the function export with a
    // plain array and the top-level kind conflict is still a finding.
    const result = scanFixture(`useRecordPresence: [],`);
    expect(result.unregistered).toHaveLength(1);
    expect(result.unregistered[0].declared).toBe('a function returning an array');
    expect(result.unregistered[0].actual).toBe('an array');
  });

  it('does not judge an export that is exported as a TYPE', () => {
    const result = scanFixture(`useRecordPresence: () => ({ viewers: [] }),`, {
      index: `export type { useRecordPresence } from './PresenceProvider.js';\n`,
    });
    expect(result.unregistered).toHaveLength(0);
    expect(result.census.unresolved).toBeGreaterThan(0);
  });

  it('reads a CALLABLE interface as unknown, never as an object', () => {
    // `interface Api { (): void }` is a FUNCTION at runtime. Reading it as an
    // object would redden a correct function stub — a false positive in exactly
    // the direction that gets a gate deleted rather than fixed.
    const provider = [
      `export interface PresenceApi { (): void; reset(): void }`,
      `export const useRecordPresence: PresenceApi = Object.assign(() => {}, { reset() {} });`,
      `export const PresenceAvatars = () => null;`,
      ``,
    ].join('\n');
    const result = scanFixture(`useRecordPresence: () => undefined,`, { provider });
    expect(result.unregistered).toHaveLength(0);
  });

  it('reads a NON-callable interface as an object, so a wrong-kind stub still reddens', () => {
    const provider = [
      `export interface PresenceState { viewers: string[] }`,
      `export const useRecordPresence: PresenceState = { viewers: [] };`,
      `export const PresenceAvatars = () => null;`,
      ``,
    ].join('\n');
    const result = scanFixture(`useRecordPresence: [],`, { provider });
    expect(result.unregistered).toHaveLength(1);
    expect(result.unregistered[0].declared).toBe('an object');
    expect(result.unregistered[0].actual).toBe('an array');
  });

  it('never conflicts when either side is unknown, in either direction', () => {
    const unknown = { kind: 'unknown' };
    const array = { kind: 'array' };
    const object = { kind: 'object' };
    expect(conflicts(unknown, array)).toBe(false);
    expect(conflicts(array, unknown)).toBe(false);
    expect(conflicts(unknown, unknown)).toBe(false);
    expect(conflicts(array, object)).toBe(true);
    expect(conflicts(array, array)).toBe(false);
    expect(conflicts({ kind: 'function', returns: array }, { kind: 'function', returns: object })).toBe(true);
    expect(conflicts({ kind: 'function', returns: array }, { kind: 'function', returns: unknown })).toBe(false);
    expect(conflicts({ kind: 'function', returns: unknown }, { kind: 'function', returns: object })).toBe(false);
  });

  it('describes shapes in the words the failure message uses', () => {
    expect(describeShape({ kind: 'function', returns: { kind: 'array' } })).toBe('a function returning an array');
    expect(describeShape({ kind: 'unknown' })).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// The real tree — the negative control at scale, and the anti-vacuity floor
// ---------------------------------------------------------------------------

describe('this repository', () => {
  const result = scan(repoRoot);

  it('has no unregistered shape mismatch', () => {
    const detail = result.unregistered.map((m) => `${m.file}:${m.line} ${m.exportName}: ${m.declared} vs ${m.actual}`);
    expect(detail).toEqual([]);
  });

  it('actually judges a substantial population — a green over nothing is not coverage', () => {
    // Floors with room, deliberately. These exist to catch a walk that broke,
    // not to pin today's figures. Measured on `aeaa0f6`: 1496 overrides, 923
    // judged, 391 of those to the RETURN shape.
    expect(result.census.overrides).toBeGreaterThan(500);
    expect(result.census.judged).toBeGreaterThan(300);
    expect(result.census.deep, 'the depth THIS card’s drift lives at').toBeGreaterThan(100);
  });

  it('shares ONE covered-specifier list with check-vi-mock-inherit', () => {
    // A population that drifted between the two gates is a hole neither one
    // reports. This gate imports the list rather than restating it, so the only
    // way to break the parity is to stop importing it.
    expect(result.covered).toEqual([...COVERED_SPECIFIERS]);
    const source = fs.readFileSync(path.join(repoRoot, 'scripts', GATE), 'utf8');
    expect(source).toContain("import { COVERED_SPECIFIERS } from './check-vi-mock-inherit.mjs';");
  });

  it('prints a census rather than a bare OK', () => {
    expect(summarise(result)).toContain('override(s)');
    expect(summarise(result)).toContain('judged');
  });
});

describe('green at rest is not green over nothing', () => {
  it('fails when the population collapses', () => {
    const empty = scan(repoRoot, { files: [] });
    expect(empty.vacuous.length).toBeGreaterThan(0);
    expect(Object.keys(FLOORS)).toContain('judged');
  });

  it('exits 1 end to end on an empty tree', () => {
    const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'vi-mock-override-shape-empty-'));
    try {
      const run = runGateIn(probe);
      expect(run.status, 'an empty scan must be RED — a green here is the defect itself').toBe(1);
      expect(run.stderr).toContain('COLLAPSED');
    } finally {
      fs.rmSync(probe, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The ledger — SHRINK-ONLY, or it becomes a blanket
// ---------------------------------------------------------------------------

describe('KNOWN_SHAPE_MISMATCHES', () => {
  it('is empty — nothing in this tree had to be grandfathered', () => {
    expect([...KNOWN_SHAPE_MISMATCHES]).toEqual([]);
  });

  it('suppresses a registered mismatch, and only that one', () => {
    const f = fixture(DRIFTED);
    try {
      const bare = scan(f.root, { files: f.files, floors: {} });
      const id = bare.mismatches[0].id;
      const registered = scan(f.root, { files: f.files, floors: {}, baseline: [id] });
      expect(registered.unregistered).toHaveLength(0);
      expect(registered.mismatches, 'a registered entry is still a MISMATCH, just a tolerated one').toHaveLength(1);
      expect(registered.stale).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  it('fails on a registered entry that no longer mismatches', () => {
    const f = fixture(REPAIRED);
    try {
      const result = scan(f.root, { files: f.files, floors: {}, baseline: ['a/fixed/file.test.tsx:@object-ui/collaboration:useRecordPresence'] });
      expect(result.stale).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Wiring — a gate nobody runs is indistinguishable from a gate that passes
// ---------------------------------------------------------------------------

describe('wiring', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };
  const lint = fs.readFileSync(path.join(repoRoot, '.github/workflows/lint.yml'), 'utf8');

  it('is reachable as a pnpm script', () => {
    expect(pkg.scripts['check:vi-mock-override-shape']).toBe(`node scripts/${GATE}`);
  });

  it('runs in lint.yml, AFTER the install it needs', () => {
    const gateAt = lint.indexOf(`node scripts/${GATE}`);
    const installAt = lint.indexOf('pnpm install --frozen-lockfile');
    expect(gateAt, 'the gate must be run by a workflow').toBeGreaterThan(-1);
    expect(installAt).toBeGreaterThan(-1);
    expect(gateAt, 'the gate imports `typescript`; before the install there is no node_modules').toBeGreaterThan(installAt);
  });

  it('is NOT run by the pre-install vi-mock workflow', () => {
    // `check-pre-install-import-graph.mjs` would fail the moment it were: this
    // gate reaches the package `typescript`, and that workflow deliberately has
    // no install step. Measured on this tree by injecting the same import into
    // `check-vi-mock-inherit.mjs`: that gate went from exit 0 to exit 1.
    const sibling = fs.readFileSync(path.join(repoRoot, '.github/workflows/repo-gates.yml'), 'utf8');
    expect(sibling).not.toContain(GATE);
  });

  it('the lint.yml skip switch cannot hide a change this gate judges', () => {
    // The switch skips the expensive steps when only ignored paths changed.
    // Both halves of what this gate compares live in TypeScript files, so no
    // ignored pattern may match one. If a pattern that does is ever added, the
    // gate silently stops seeing the pull requests most likely to trip it.
    const patterns = [...lint.matchAll(/:\(exclude,glob\)([^'"\s]+)/g)].map((m) => m[1]);
    expect(patterns.length, 'the ignore list moved — re-read this switch').toBeGreaterThan(0);

    const toRe = (glob: string) =>
      new RegExp(
        `^${glob
          .split('**')
          .map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
          .join('.*')}$`,
      );
    const tsPaths = [
      'packages/app-shell/src/views/RecordDetailView.headerRefresh.test.tsx',
      'packages/collaboration/src/PresenceProvider.tsx',
      'scripts/check-vi-mock-override-shape.mjs',
      'packages/collaboration/src/index.ts',
    ];
    for (const glob of patterns) {
      for (const p of tsPaths) {
        expect(toRe(glob).test(p), `ignore pattern ${glob} matches ${p} — this gate would go blind`).toBe(false);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The reader — what it sees, and what it declines to see
// ---------------------------------------------------------------------------

describe('findOverrides', () => {
  it('reads the own properties of the returned object, never the spread', () => {
    const found = findOverrides('x.test.tsx', mockSource(REPAIRED));
    expect(found.map((o) => o.exportName)).toEqual(['useRecordPresence', 'PresenceAvatars']);
  });

  it('ignores a mock on a specifier outside the covered list', () => {
    const src = mockSource(REPAIRED).replace('@object-ui/collaboration', 'sonner');
    expect(findOverrides('x.test.tsx', src)).toHaveLength(0);
  });

  it('reads a block-bodied factory as well as a concise one', () => {
    const src = [
      `import { vi } from ${Q}vitest${Q};`,
      ``,
      `vi.mock(${Q}@object-ui/collaboration${Q}, async (importOriginal) => {`,
      `  const actual = await importOriginal<Record<string, unknown>>();`,
      `  return { ...actual, ${REPAIRED} };`,
      `});`,
      ``,
    ].join('\n');
    expect(findOverrides('x.test.tsx', src).map((o) => o.exportName)).toEqual(['useRecordPresence']);
  });

  it('does not see a call that lives inside a string literal', () => {
    const src = `const sample = ${Q}vi.mock("@object-ui/collaboration", () => ({ useRecordPresence: () => ({}) }))${Q};\n`;
    expect(findOverrides('x.test.tsx', src)).toHaveLength(0);
  });
});
