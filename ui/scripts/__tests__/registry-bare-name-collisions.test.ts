import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS shared helpers. Their types are INFERRED from the .mjs sources by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here —
// re-adding one is itself an error (TS2578). See objectui#3494.
import {
  CONTROLS,
  FLOORS,
  KNOWN_BARE_NAME_COLLISIONS,
  checkFloors,
  claimantId,
  collectClaims,
  evaluate,
  formatFindings,
  groupBareKeys,
  isGeneratedPath,
  isTestPath,
  judgeAgainstLedger,
} from '../check-registry-bare-name-collisions.mjs';
import {
  readOwnRegistrations,
  readRegistrationClaims,
  readUnitProjectShape,
  unitProjectFiles,
} from '../unit-registry-collision.mjs';

/**
 * objectui#9264 — `Registry.register` writes a bare-name fallback next to the
 * namespaced key and the bare write is last-one-wins, so when two
 * registrations claim one bare name under DIFFERENT full types, import order
 * decides which declaration governs an authored node. A runtime `console.warn`
 * surfaces that; nothing FAILS on it, and `registerLazy` does not even warn.
 *
 * This file is the failing half. It is deliberately two kinds of test:
 *
 *   - the SWEEP over the real tree, which is the gate; and
 *   - the JUDGEMENT over planted populations, because a gate whose red path is
 *     only ever reached by breaking the repository is a gate nobody has seen
 *     fail. Every disposition below is planted and asserted in both
 *     directions.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** A claim record shaped the way the sweep produces them. */
function claim(over: Record<string, unknown> = {}) {
  return {
    type: 'widget',
    namespace: 'a',
    fullType: 'a:widget',
    skipFallback: false,
    claimsBare: true,
    guarded: false,
    method: 'register',
    receiver: 'ComponentRegistry',
    line: 1,
    origin: 'literal',
    file: 'packages/a/src/index.tsx',
    package: 'packages/a',
    ...over,
  };
}

describe('registry bare-name collisions — the sweep over this repository', () => {
  const result = evaluate(repoRoot);

  it('reports no finding: no new bare-name collision, no stale ledger entry, no blind spot', () => {
    expect(result.findings.length, `\n${formatFindings(result.findings)}\n`).toBe(0);
  });

  it('is non-vacuous — every population it depends on clears its floor', () => {
    expect(checkFloors(result.counts, FLOORS)).toEqual([]);
  });

  it('every unresolvable registration call sits in a file declared OPEN, with its reason', () => {
    // A key this gate cannot read is a key it cannot judge. The declaration is
    // what keeps that from being silent; the sweep itself fails on an
    // undeclared one, so this asserts the population is not empty for the
    // empty reason.
    expect(result.unresolved.length).toBeGreaterThan(0);
  });

  it('sees the cases this repository has ALREADY solved — the stand-down control', () => {
    // If the instrument cannot see a solved collision it cannot be trusted
    // about an unsolved one. These six are resolved by a deliberate
    // `skipFallback: true` and must come back visible.
    for (const key of CONTROLS.standDown) {
      const group = result.groups.get(key);
      expect(group?.standDowns.length, `${key} must be visible as a skipFallback stand-down`).toBeGreaterThan(0);
    }
  });

  it('sees live multi-claimant keys that AGREE — the other direction of the control', () => {
    // A sweep that stopped seeing claimants would report zero collisions for
    // the empty reason. These keys have two or more claimants naming ONE full
    // type: visible, and correctly not reported.
    for (const key of CONTROLS.agreed) {
      const group = result.groups.get(key);
      expect(group?.claimants.length, `${key} must be visible as a multi-claimant key`).toBeGreaterThan(1);
      expect(group?.owners).toHaveLength(1);
      expect(group?.verdict).toBe('agreed');
    }
  });

  it('holds every contested key in the shrink-only ledger, claimants and all', () => {
    for (const group of result.contested) {
      const entry = KNOWN_BARE_NAME_COLLISIONS.find((e: { key: string }) => e.key === group.key);
      expect(entry, `contested bare key ${group.key} must be declared in the ledger`).toBeDefined();
      expect([...group.claimants].map(claimantId).sort()).toEqual([...(entry?.claimants ?? [])].sort());
    }
  });

  it('holds no build OUTPUT — the population must not move when someone builds', () => {
    // Measured while this gate landed: 1633 files before `turbo run build`,
    // 1639 after, the six being `apps/site/.next`, `apps/site/.source` and a
    // generated `plugin.d.ts`. A population that depends on build state is one
    // no two runs agree on.
    for (const file of result.files) {
      expect(isGeneratedPath(file), `${file} is generated output and must not be in the population`).toBe(false);
    }
    expect(isGeneratedPath('apps/site/.next/types/routes.d.ts')).toBe(true);
    expect(isGeneratedPath('apps/site/.source/server.ts')).toBe(true);
    expect(isGeneratedPath('apps/console/plugin.d.ts')).toBe(true);
    expect(isGeneratedPath('apps/console/src/register-plugins.ts')).toBe(false);
  });

  it('keeps test sources out of the population — a test-body registration governs nothing', () => {
    expect(isTestPath('packages/a/src/__tests__/x.test.tsx')).toBe(true);
    expect(isTestPath('packages/a/src/x.test.ts')).toBe(true);
    expect(isTestPath('examples/schema-catalog/test/x.tsx')).toBe(true);
    expect(isTestPath('packages/a/src/index.tsx')).toBe(false);
  });
});

describe('the judgement, on planted populations', () => {
  it('FAILS on two claimants naming different full types', () => {
    const groups = groupBareKeys([
      claim({ type: 'widget', namespace: 'a', fullType: 'a:widget' }),
      claim({ type: 'widget', namespace: 'b', fullType: 'b:widget', file: 'packages/b/src/index.tsx' }),
    ]);
    expect(groups.get('widget')?.verdict).toBe('contested');
    const findings = judgeAgainstLedger(groups, []);
    expect(findings.map((f: { reason: string }) => f.reason)).toEqual(['new-bare-name-collision']);
    expect(findings[0].detail).toContain('a:widget');
    expect(findings[0].detail).toContain('b:widget');
  });

  it('passes when the claimants AGREE on one full type — the console-stub shape', () => {
    const groups = groupBareKeys([
      claim({ method: 'registerLazy', file: 'apps/console/src/register-plugins.ts' }),
      claim(),
    ]);
    expect(groups.get('widget')?.verdict).toBe('agreed');
    expect(judgeAgainstLedger(groups, [])).toEqual([]);
  });

  it('passes when the second registration STOOD DOWN with skipFallback', () => {
    const groups = groupBareKeys([
      claim(),
      claim({ namespace: 'b', fullType: 'b:widget', skipFallback: true, claimsBare: false, file: 'packages/b/src/index.tsx' }),
    ]);
    const group = groups.get('widget');
    expect(group?.verdict).toBe('sole');
    expect(group?.handled).toBe(true);
    expect(judgeAgainstLedger(groups, [])).toEqual([]);
  });

  it('passes when the other claimant is GUARDED by an existence check', () => {
    const groups = groupBareKeys([
      claim(),
      claim({ namespace: 'b', fullType: 'b:widget', guarded: true, file: 'packages/b/src/index.tsx' }),
    ]);
    const group = groups.get('widget');
    expect(group?.verdict).toBe('sole');
    expect(group?.guarded).toHaveLength(1);
    expect(judgeAgainstLedger(groups, [])).toEqual([]);
  });

  it('FAILS when a new claimant joins a key already in the ledger', () => {
    const groups = groupBareKeys([
      claim({ type: 'widget', namespace: 'a', fullType: 'a:widget' }),
      claim({ type: 'widget', namespace: 'b', fullType: 'b:widget', file: 'packages/b/src/index.tsx' }),
      claim({ type: 'widget', namespace: 'c', fullType: 'c:widget', file: 'packages/c/src/index.tsx' }),
    ]);
    const ledger = [
      {
        key: 'widget',
        claimants: ['packages/a/src/index.tsx · a:widget · register', 'packages/b/src/index.tsx · b:widget · register'],
        note: 'planted',
      },
    ];
    const findings = judgeAgainstLedger(groups, ledger);
    expect(findings.map((f: { reason: string }) => f.reason)).toEqual(['ledger-entry-grew']);
    expect(findings[0].detail).toContain('packages/c/src/index.tsx · c:widget · register');
  });

  it('FAILS on a ledger entry whose collision is gone — the ledger is shrink-only', () => {
    const groups = groupBareKeys([claim()]);
    const findings = judgeAgainstLedger(groups, [{ key: 'widget', claimants: [], note: 'planted' }]);
    expect(findings.map((f: { reason: string }) => f.reason)).toEqual(['stale-ledger-entry']);
  });

  it('a registration with no namespace claims the bare name outright', () => {
    const groups = groupBareKeys([
      claim({ namespace: null, fullType: 'widget' }),
      claim({ namespace: 'b', fullType: 'b:widget', file: 'packages/b/src/index.tsx' }),
    ]);
    expect(groups.get('widget')?.verdict).toBe('contested');
  });
});

/**
 * objectui#9717 made INDIRECT_REGISTRATIONS' coverage COLLECTION-keyed, so one
 * file legitimately carries several entries. This gate attributes an indirect
 * key to the entry's FILE — the same file-vs-collection mismatch that card is
 * about, one gate over — so `at`, `names`, `bare` and the guard are a function
 * of the file and the namespace and of nothing else in the entry. Iterating
 * entries therefore pushed the SAME claim once per entry.
 *
 * ⛔ The duplicates are not extra claims to deduplicate downstream: they are one
 * claim counted twice, and this gate's whole verdict is a count of DISTINCT
 * claimants. Two claims where the tree has one reads as `agreed` — "two
 * registrations, one owner" — when the truth is `sole`.
 *
 * ⭐ Both directions are pinned. A dedupe that also merged two DIFFERENT
 * namespaces would be a weakening wearing a bug fix's clothes, so the case that
 * must SURVIVE is asserted beside the case that must collapse.
 */
describe('one pass per (site, namespace), not per table entry', () => {
  const withTree = <T,>(files: Record<string, string>, run: (dir: string) => T): T => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'registry-bare-name-collisions-'));
    try {
      for (const [rel, contents] of Object.entries(files)) {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
      }
      return run(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  const at = (site: string, collection: string, namespace: string) => ({
    site,
    collection,
    kind: 'array',
    namespace,
    reason: 'fixture',
  });

  const SITE = 'packages/demo/src/index.tsx';

  /** Two collections under ONE namespace, and two under two — in one file. */
  const source = [
    "const THINGS = [\n  'alpha',\n];",
    "const MORE = [\n  'gamma',\n];",
    "const OTHERS = [\n  'beta',\n];",
    'function reg(type) {',
    "  ComponentRegistry.register(type, C, { namespace: 'ui' });",
    '}',
    'function other(type) {',
    "  ComponentRegistry.register(type, C, { namespace: 'proto' });",
    '}',
    'THINGS.forEach(reg);',
    'MORE.forEach(reg);',
    'OTHERS.forEach(other);',
  ].join('\n');

  it('⛔ counts a claim ONCE when two entries share a site and a namespace', () => {
    const { claims, counters } = withTree({ [SITE]: source + '\n' }, (dir) =>
      collectClaims(dir, {
        indirectRegistrations: [at(SITE, 'THINGS', 'ui'), at(SITE, 'MORE', 'ui'), at(SITE, 'OTHERS', 'proto')],
        openRegistrationSites: {},
        guardedIndirectSites: {},
      }),
    );
    const indirect = claims.filter((c: { origin: string }) => c.origin === 'indirect');
    expect(indirect.map((c: { fullType: string }) => c.fullType).sort()).toEqual(['proto:beta', 'ui:alpha', 'ui:gamma']);
    expect(new Set(indirect.map(claimantId)).size).toBe(indirect.length);
    expect((counters as { indirectClaims: number }).indirectClaims).toBe(3);
  });

  it('⭐ still counts BOTH when two entries share a site under different namespaces', () => {
    // The case that must survive. Collapsing this one would hide exactly the
    // second claimant this gate exists to report.
    const { claims } = withTree({ [SITE]: source + '\n' }, (dir) =>
      collectClaims(dir, {
        indirectRegistrations: [at(SITE, 'THINGS', 'ui'), at(SITE, 'OTHERS', 'proto')],
        openRegistrationSites: {},
        guardedIndirectSites: {},
      }),
    );
    const namespaces = claims
      .filter((c: { origin: string }) => c.origin === 'indirect')
      .map((c: { namespace: string }) => c.namespace);
    expect([...new Set(namespaces)].sort()).toEqual(['proto', 'ui']);
  });
});

describe('the shared walker', () => {
  const tsx = [
    "ComponentRegistry.register('calendar',",
    '  ({ schema }: { schema: CalendarSchema }) => (<Calendar mode={schema.mode as any} />),',
    "  { namespace: 'ui', skipFallback: true },",
    ');',
  ].join('\n');

  it('parses a .tsx source as TSX — otherwise the JSX swallows the meta object', () => {
    // The direction that matters: mis-parsed, this registration loses its meta
    // entirely and a `skipFallback: true` call reads as a bare-name claimant,
    // manufacturing a finding that is not there (objectui#9264).
    const [asTsx] = readRegistrationClaims(tsx, 'calendar.tsx').claims;
    expect([asTsx.fullType, asTsx.skipFallback, asTsx.claimsBare]).toEqual(['ui:calendar', true, false]);
  });

  it('resolves a key that arrives through a loop — but only when asked', () => {
    const source = [
      "const TAGS = ['aside', 'main'] as const;",
      'for (const tag of TAGS) {',
      "  ComponentRegistry.register(tag, C, { namespace: 'ui' });",
      '}',
    ].join('\n');
    expect(readRegistrationClaims(source, 'f.ts').claims).toHaveLength(0);
    const opened = readRegistrationClaims(source, 'f.ts', { resolveLoops: true });
    expect(opened.claims.map((c: { fullType: string }) => c.fullType)).toEqual(['ui:aside', 'ui:main']);
    expect(opened.claims.every((c: { origin: string }) => c.origin === 'loop')).toBe(true);
  });

  it('reads the `forEach` spelling of the same loop', () => {
    const source = [
      "const tags = ['header', 'footer'] as const;",
      'tags.forEach((tag) => {',
      "  ComponentRegistry.register(tag, C, { namespace: 'ui' });",
      '});',
    ].join('\n');
    const { claims } = readRegistrationClaims(source, 'f.ts', { resolveLoops: true });
    expect(claims.map((c: { fullType: string }) => c.fullType)).toEqual(['ui:header', 'ui:footer']);
  });

  it('marks a registration behind an existence check as guarded', () => {
    const source = [
      'function registerPlaceholder(type: string) {',
      '  if (!ComponentRegistry.get(type)) {',
      "    ComponentRegistry.register('x', P, { namespace: 'protocol-placeholder' });",
      '  }',
      '}',
      "ComponentRegistry.register('y', P, { namespace: 'ui' });",
    ].join('\n');
    const { claims } = readRegistrationClaims(source, 'f.ts');
    expect(claims.map((c: { type: string; guarded: boolean }) => [c.type, c.guarded])).toEqual([
      ['x', true],
      ['y', false],
    ]);
  });

  it('leaves `readOwnRegistrations` answering exactly what objectui#7134 reads', () => {
    // The factoring must not move that gate's population. A loop key stays
    // UNRESOLVED there, because that gate floors the sites it reports.
    const source = [
      "ComponentRegistry.register('grid', C, { namespace: 'view', skipFallback: true });",
      "ComponentRegistry.register('x', C);",
      "for (const v of ['a', 'b']) ComponentRegistry.registerLazy(v, l, { namespace: 'ns' });",
    ].join('\n');
    const read = readOwnRegistrations(source, 'f.ts');
    expect(read.keys).toEqual(['view:grid', 'x']);
    expect(read.unresolved).toHaveLength(1);
  });

  it('the TSX fix cannot move objectui#7134’s population: that project holds no .tsx file', () => {
    const shape = readUnitProjectShape(fs.readFileSync(path.join(repoRoot, 'vitest.config.mts'), 'utf8'));
    const files: string[] = unitProjectFiles(repoRoot, shape);
    expect(files.length).toBeGreaterThan(500);
    expect(files.filter((f) => f.endsWith('.tsx'))).toEqual([]);
  });
});
