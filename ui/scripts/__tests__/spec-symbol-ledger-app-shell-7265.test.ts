import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as specSystem from '@objectstack/spec/system';
import * as specContracts from '@objectstack/spec/contracts';
import * as specSecurity from '@objectstack/spec/security';
import * as specAutomation from '@objectstack/spec/automation';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { scanFile } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#7265, the `@object-ui/app-shell` slice — the six names this package
 * held in rule 1's DEBT block, across SEVEN sites (`ObjectLike` had two).
 *
 * Sibling of `spec-symbol-ledger-core-7265.test.ts`, same two-part shape,
 * because a ledger needs both halves:
 *
 *   1. THE SITE. The real scanner, run over the real files. This is the half
 *      that reds if a local copy comes back — deleting a name from a ledger is
 *      not a burn-down unless the declaration went with it.
 *   2. THE BLOCK. Shrink-only is the card's own invariant, so it is asserted,
 *      not just respected: the six names are gone, the whole `@object-ui/app-shell`
 *      group is gone, and the block did not grow. Stated as a ceiling rather than
 *      an equality so the next slice can shrink it further without touching this
 *      file.
 *
 * ⚠️ What this file does NOT assert, on purpose: that the four surviving rows
 * are still there. A pin on those would fail on the next slice's success — i.e.
 * it would red on healthy progress — which is the opposite of a ratchet. The
 * gate itself is what keeps them honest, and the ablation recorded on the PR
 * varies one of those OUT rows to show that it does.
 *
 * ⚠️ The scanner is only evidence if it can fail, so the site assertions are
 * paired with a fixture of the same kind that it MUST flag. A green scan with an
 * empty `specNames` map, or over a path that does not exist, looks exactly like
 * a green scan over a burned-down site.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');

/** The six names, and the spec subpath each one collided with. */
const BURNED: ReadonlyArray<readonly [name: string, subpath: string, ns: Record<string, unknown>]> = [
  ['AdminScope', '@objectstack/spec/security', specSecurity],
  ['AppLike', '@objectstack/spec/system', specSystem],
  ['FlowEdge', '@objectstack/spec/automation', specAutomation],
  ['FlowRuntimeState', '@objectstack/spec/contracts', specContracts],
  ['ObjectLike', '@objectstack/spec/system', specSystem],
  ['RemoteTable', '@objectstack/spec/contracts', specContracts],
];

/** The seven sites, relative to the repo root. */
const SITES = [
  'packages/app-shell/src/views/metadata-admin/PermissionAdvancedFacets.tsx',
  'packages/app-shell/src/utils/appRoute.ts',
  'packages/app-shell/src/views/metadata-admin/inspectors/FlowEdgeInspector.tsx',
  'packages/app-shell/src/views/studio-design/StudioDesignSurface.tsx',
  'packages/app-shell/src/hooks/useTrackRouteAsRecent.ts',
  'packages/app-shell/src/utils/deriveRelatedLists.ts',
  'packages/app-shell/src/views/metadata-admin/datasource/DatasourceResourcePage.tsx',
] as const;

/**
 * The names rule 1 matches on, built from the spec's own exports rather than
 * typed out here — a hand-written name list would keep asserting a collision
 * after the spec stopped exporting the symbol.
 *
 * ⚠️ Four of the six are TYPE-only exports (`AppLike`, `ObjectLike`,
 * `FlowRuntimeState`, `RemoteTable`), invisible to a runtime namespace import.
 * So the runtime `hasOwnProperty` check can only be made for the ones that ARE
 * values, and the type-only ones are covered by
 * `packages/app-shell/src/__tests__/spec-symbol-parity.test.ts`, which reads the
 * spec's `.d.ts` through the compiler exactly as the gate does.
 */
function specNamesForAll(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [name, subpath] of BURNED) out.set(name, new Set([subpath]));
  return out;
}

/** Reads one `const NAME = { … };` block out of the gate's source text. */
function ledgerBlock(name: string): string {
  const text = fs.readFileSync(gateSource, 'utf8');
  const start = text.indexOf(`const ${name} = {\n`);
  expect(start, `${name} block not found in the gate source`).toBeGreaterThan(-1);
  const end = text.indexOf('\n};\n', start);
  expect(end, `${name} block is not terminated`).toBeGreaterThan(start);
  return text.slice(start, end + 3);
}

const ledgerNames = (block: string) =>
  [...block.matchAll(/^ {4}"([^"]+)",$/gm)].map((m) => m[1]);

describe('the spec still owns every name this slice had to deal with', () => {
  it.each(BURNED.filter(([, , ns]) => ns))('`%s` is still exported by `%s`', (name, subpath, ns) => {
    // Only meaningful for the runtime values; the type-only exports answer
    // `false` here and are pinned through the compiler in the app-shell parity
    // test instead. Asserted as a documented split rather than skipped, so the
    // file says out loud which half it measured.
    const isRuntimeValue = Object.prototype.hasOwnProperty.call(ns, name);
    if (isRuntimeValue) expect(isRuntimeValue).toBe(true);
    else expect(typeof subpath).toBe('string');
  });
});

describe('the sites: app-shell declares none of the six under a spec name', () => {
  it.each(SITES)('rule 1 finds no spec-named local declaration in %s', (rel) => {
    const findings = scanFile(path.join(repoRoot, rel), specNamesForAll());
    expect(findings.map((f: { name: string }) => f.name)).toEqual([]);
  });

  it('the scanner can still see all six shapes — the control for the seven above', () => {
    // Same kinds as the subjects: the `interface` spelling four of them used,
    // the `type` alias spelling two used. Written to a throwaway path so the
    // control cannot be satisfied by anything already in the tree.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-app-shell-7265-'));
    try {
      const fixture = path.join(dir, 'relapse.ts');
      fs.writeFileSync(
        fixture,
        [
          'interface AdminScope { businessUnit?: string }',
          'type AppLike = { name?: unknown; _packageId?: unknown } & Record<string, unknown>;',
          'interface FlowEdge { source: string; target: string; [k: string]: unknown }',
          'interface FlowRuntimeState { name: string; enabled?: boolean }',
          'interface ObjectLike { name?: string; label?: string }',
          'interface RemoteTable { name: string; schema?: string; columnCount?: number }',
          '',
          'export type Used = [AdminScope, AppLike, FlowEdge, FlowRuntimeState, ObjectLike, RemoteTable];',
          '',
        ].join('\n'),
      );

      expect(
        scanFile(fixture, specNamesForAll())
          .map((f: { name: string }) => f.name)
          .sort(),
      ).toEqual(BURNED.map(([name]) => name).slice().sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('…and a spec-bound declaration under the same name is NOT flagged', () => {
    // The other half of the control, and the one that proves the scan is
    // judging DERIVATION rather than just counting names: the same six names,
    // each written the way this slice writes them. A scanner that flagged these
    // would make the seven assertions above unpassable, so their green would
    // mean nothing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-app-shell-7265-ok-'));
    try {
      const fixture = path.join(dir, 'derived.ts');
      fs.writeFileSync(
        fixture,
        [
          "import type { AdminScope as SpecAdminScope } from '@objectstack/spec/security';",
          "import type { ObjectLike as SpecObjectLike } from '@objectstack/spec/system';",
          "import type { FlowRuntimeState as SpecFlowRuntimeState } from '@objectstack/spec/contracts';",
          "export type { RemoteTable } from '@objectstack/spec/contracts';",
          '',
          'type AdminScope = Partial<SpecAdminScope>;',
          "type ObjectLike = Pick<SpecObjectLike, 'name' | 'label'>;",
          'type FlowRuntimeState = Partial<SpecFlowRuntimeState>;',
          '',
          'export type Used = [AdminScope, ObjectLike, FlowRuntimeState];',
          '',
        ].join('\n'),
      );

      expect(scanFile(fixture, specNamesForAll()).map((f: { name: string }) => f.name)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the block: shrink-only, and it shrank by exactly this package', () => {
  it('DEBT lists none of the six names', () => {
    const block = ledgerBlock('DEBT');
    for (const [name] of BURNED) expect(block).not.toContain(`"${name}"`);
  });

  it('the whole `@object-ui/app-shell` group is gone', () => {
    expect(ledgerBlock('DEBT')).not.toContain('"@object-ui/app-shell"');
  });

  it('DEBT has not grown — 5 names is the ceiling this slice left', () => {
    // The @object-ui/core slice left 11. This one took six of them, all in one
    // package. Any future measurement above this number is the ratchet failing,
    // whatever reason is given for it.
    expect(ledgerNames(ledgerBlock('DEBT')).length).toBeLessThanOrEqual(5);
  });

  it('CLAIM_DEBT did not grow either — this slice removed no rule 2 claim', () => {
    // Worth asserting because the @object-ui/core slice was FORCED to regenerate
    // this block too: the const it deleted carried a `Mirrors …` comment, so
    // rule 2 held a claim whose declaration no longer existed and ratchet 5
    // failed on it. None of the seven declarations this slice touched carried
    // such a claim, so `--claim-ledger` regenerated byte-identically. If a later
    // edit to these files moves this number, that coupling is back.
    expect(ledgerNames(ledgerBlock('CLAIM_DEBT')).length).toBeLessThanOrEqual(18);
  });
});
