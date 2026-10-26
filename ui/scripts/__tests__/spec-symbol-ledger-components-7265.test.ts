import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SortDirectionEnum } from '@objectstack/spec/shared';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { scanFile } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#7265, the `@object-ui/components` slice -- the one name this package
 * held in rule 1's DEBT block, in one file.
 *
 * Sibling of `spec-symbol-ledger-core-7265.test.ts`,
 * `spec-symbol-ledger-app-shell-7265.test.ts` and
 * `spec-symbol-ledger-types-7265.test.ts`, same two-part shape, because a ledger
 * needs both halves:
 *
 *   1. THE SITE. The real scanner, run over the real file. This is the half that
 *      reds if a local copy comes back -- deleting a name from a ledger is not a
 *      burn-down unless the declaration went with it.
 *   2. THE BLOCK. Shrink-only is the card's own invariant, so it is asserted,
 *      not just respected. Stated as a ceiling rather than an equality so the
 *      next slice can shrink it further without touching this file.
 *
 * ⭐ What is specific to THIS slice: the route was decided against a third
 * state, not against a member count. The renderer declared `SortDirection` as
 * the spec's two members plus `null`, and `null` is the one thing the spec's
 * vocabulary refuses -- so the rename question was live, and the answer came
 * from what that member MEANS at the site. It is the ABSENCE of a direction,
 * written once at the end of the client-side header cycle and read only by
 * guards that guard `sortColumn` in the same breath, and `sortColumn` -- the
 * other half of the same state pair -- already spelled its own empty case at its
 * slot. So the concept is the spec's, the declaration is gone rather than
 * re-derived, and the third state is confined to the state slot. The refusal
 * that makes the confinement load-bearing is probed below in BOTH directions.
 *
 * ⚠️ What this file does NOT assert, on purpose: that the surviving DEBT rows
 * are still there. A pin on those would fail on the next slice's success -- it
 * would red on healthy progress, which is the opposite of a ratchet.
 *
 * ⚠️ The scanner is only evidence if it can fail, so the site assertion is
 * paired with a fixture of the same kind that it MUST flag. A green scan with an
 * empty `specNames` map, or over a path that does not exist, looks exactly like
 * a green scan over a burned-down site.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');

/** The name that was BURNED DOWN by binding it to the spec. */
const BOUND = 'SortDirection';
/** The subpath that owns it. */
const SUBPATH = '@objectstack/spec/shared';
/** The single site it lived at. */
const SITE = 'packages/components/src/renderers/complex/data-table.tsx';

/**
 * The names rule 1 matches on, built for the one name this slice dealt with
 * rather than typed out as a list -- a hand-written name list would keep
 * asserting a collision after the spec stopped exporting the symbol.
 */
const specNamesForBound = (): Map<string, Set<string>> => new Map([[BOUND, new Set([SUBPATH])]]);

/** Reads one `const NAME = { … };` block out of the gate's source text. */
function ledgerBlock(name: string): string {
  const text = fs.readFileSync(gateSource, 'utf8');
  const start = text.indexOf(`const ${name} = {\n`);
  expect(start, `${name} block not found in the gate source`).toBeGreaterThan(-1);
  const end = text.indexOf('\n};\n', start);
  expect(end, `${name} block is not terminated`).toBeGreaterThan(start);
  return text.slice(start, end + 3);
}

const ledgerNames = (block: string) => [...block.matchAll(/^ {4}"([^"]+)",$/gm)].map((m) => m[1]);

describe('the spec still owns the name this slice bound to', () => {
  it(`\`${BOUND}\` is still a live \`${SUBPATH}\` vocabulary`, () => {
    // The `import` above already fails the build if the enum disappears. This
    // asserts the stronger thing the route rests on -- that the name still names
    // a PARSER, not a type-only shim that would make the probes below vacuous.
    // (`SortDirection` itself is `z.input` of this enum and so is type-only; it
    // is read through the compiler in the package's own parity file.)
    expect(typeof SortDirectionEnum.safeParse).toBe('function');
    expect(SortDirectionEnum.safeParse('asc').success).toBe(true);
    expect(SortDirectionEnum.safeParse('desc').success).toBe(true);
  });

  it('…and it refuses the third state, which is why `null` had to be confined', () => {
    // Both directions of the one divergence. If the spec ever admits `null` as
    // a direction, the confinement at the state slot is spent and the comment
    // explaining it has gone false -- this is the assertion that says so out
    // loud instead of staying quiet.
    expect(SortDirectionEnum.safeParse(null).success).toBe(false);
    // Lit control: a refusal is only news if the parser accepts anything at all,
    // and the two accepted values above are read back off the enum rather than
    // restated, so a widened vocabulary shows up here rather than in prose.
    const members = Object.keys(
      (SortDirectionEnum as unknown as { _zod?: { def?: { entries?: Record<string, unknown> } } })
        ._zod?.def?.entries ?? {},
    );
    expect(members.length).toBeGreaterThan(1);
    expect(members).not.toContain('null');
  });
});

describe('the site: the module-local mirror is gone', () => {
  const found = () => scanFile(path.join(repoRoot, SITE), specNamesForBound()).map((f: { name: string }) => f.name);

  it(`rule 1 no longer sees \`${BOUND}\` -- the renderer imports it now`, () => {
    expect(found()).toEqual([]);
  });

  it('the scanner can still see the shape it used to flag -- the control', () => {
    // Same kind as the subject: the exact declaration this slice deleted.
    // Written to a throwaway path so the control cannot be satisfied by
    // anything already in the tree.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-components-7265-'));
    try {
      const fixture = path.join(dir, 'relapse.ts');
      fs.writeFileSync(
        fixture,
        [
          "type SortDirection = 'asc' | 'desc' | null;",
          '',
          'export const used: SortDirection = null;',
          '',
        ].join('\n'),
      );
      expect(scanFile(fixture, specNamesForBound()).map((f: { name: string }) => f.name)).toEqual([BOUND]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('…and a DERIVED re-declaration is NOT flagged -- the other half of the control', () => {
    // This proves the scan judges DERIVATION rather than counting names: a
    // scanner that flagged this would make the first assertion above unpassable,
    // so its green would mean nothing. It also records what the gate does and
    // does not decide -- the union-extension spelling below is a legitimate BIND
    // form too, and the gate is indifferent between it and the outright import.
    // The site chose the import; the gate did not choose for it.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-components-7265-ok-'));
    try {
      const fixture = path.join(dir, 'derived.ts');
      fs.writeFileSync(
        fixture,
        [
          "import type { SortDirection as SpecSortDirection } from '@objectstack/spec/shared';",
          '',
          'type SortDirection = SpecSortDirection | null;',
          '',
          'export const used: SortDirection = null;',
          '',
        ].join('\n'),
      );
      expect(scanFile(fixture, specNamesForBound()).map((f: { name: string }) => f.name)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the block: shrink-only, and it shrank by exactly this package', () => {
  it(`DEBT no longer lists \`${BOUND}\``, () => {
    expect(ledgerBlock('DEBT')).not.toContain(`"${BOUND}"`);
  });

  it('the whole `@object-ui/components` group is gone', () => {
    expect(ledgerBlock('DEBT')).not.toContain('"@object-ui/components"');
  });

  it('DEBT has not grown -- 2 names is the ceiling this slice left', () => {
    // The `@object-ui/types` slice left 3. This one took one of them.
    // Any future measurement above this number is the ratchet failing, whatever
    // reason is given for it.
    expect(ledgerNames(ledgerBlock('DEBT')).length).toBeLessThanOrEqual(2);
  });

  it('CLAIM_DEBT did not grow either -- this slice removed no rule 2 claim', () => {
    // The `@object-ui/core` slice was FORCED to regenerate that block too,
    // because the const it deleted carried a `Mirrors …` comment. The
    // declaration this slice deleted carried no spec-alignment claim, so
    // `--claim-ledger` regenerates byte-identically. If a later edit here moves
    // this number, that coupling is back.
    expect(ledgerNames(ledgerBlock('CLAIM_DEBT')).length).toBeLessThanOrEqual(18);
  });

  it('ALLOW did NOT gain a waiver -- the route was BIND, and that is a fact worth pinning', () => {
    // The sibling slice put one of its two names in ALLOW instead, so "a name
    // left DEBT" does not say which route was taken. This one took none: there
    // is nothing here that deliberately differs from the spec's direction
    // vocabulary. A later hand that waives it instead has to delete this
    // assertion, which is the visibility a silent re-fork would not have.
    expect(fs.readFileSync(gateSource, 'utf8')).not.toContain(`"@object-ui/components:${BOUND}"`);
  });
});
