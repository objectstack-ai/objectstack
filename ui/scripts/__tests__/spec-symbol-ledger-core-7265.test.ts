import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as specData from '@objectstack/spec/data';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { scanFile, scanFileForClaims } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#7265, the `@object-ui/core` slice — 2 of the entries the DEBT block
 * was seeded with at objectui#6291.
 *
 * `CONTEXT_TOKEN_SUGGESTIONS` and `isContextToken` were module-local copies of
 * two `@objectstack/spec/data` exports living in `filter-tokens.ts`. They are
 * imports now, so both left rule 1's DEBT block and the map's alignment claim
 * left rule 2's CLAIM_DEBT block with the declaration that carried it — all
 * three removals mechanical (`--ledger` / `--claim-ledger`), never hand-edited.
 *
 * Two different things are pinned here, and a ledger needs both:
 *
 *   1. THE SITE. The real scanner, run over the real file. This is the half
 *      that reds if the local copies come back — deleting a name from a ledger
 *      is not a burn-down unless the declaration went with it.
 *   2. THE BLOCK. Shrink-only is the card's own invariant, so it is asserted,
 *      not just respected: the two names are gone AND the block did not grow.
 *      Stated as a ceiling rather than an equality so the next slice can shrink
 *      it further without touching this file.
 *
 * ⚠️ The scanner is only evidence if it can fail, so each site assertion is
 * paired with a fixture of the same kind that it MUST flag. A green scan with
 * an empty `specNames` map, or over a path that does not exist, looks exactly
 * like a green scan over a burned-down site.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');
const site = path.join(repoRoot, 'packages/core/src/utils/filter-tokens.ts');

const BURNED = ['CONTEXT_TOKEN_SUGGESTIONS', 'isContextToken'] as const;

/**
 * The names rule 1 matches on, built from the spec's own runtime exports rather
 * than typed out here — a hand-written name list would keep asserting a
 * collision after the spec stopped exporting the symbol.
 */
function specNamesFor(names: readonly string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const name of names) {
    expect(
      Object.prototype.hasOwnProperty.call(specData, name),
      `@objectstack/spec/data must still export ${name} for this to be a collision at all`,
    ).toBe(true);
    out.set(name, new Set(['@objectstack/spec/data']));
  }
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

describe('the site: filter-tokens.ts declares neither symbol any more', () => {
  it('rule 1 finds no local declaration under either spec name', () => {
    const findings = scanFile(site, specNamesFor(BURNED));
    expect(findings.map((f: { name: string }) => f.name)).toEqual([]);
  });

  it('rule 2 finds no spec-alignment claim left behind by the deleted map', () => {
    const claims = scanFileForClaims(site, specNamesFor(BURNED));
    expect(claims.map((c: { name: string }) => c.name)).toEqual([]);
  });

  it('the scanner can still see both shapes — the control for the two above', () => {
    // Same kind as the subject: one module-local `const` under the spec's name
    // carrying an alignment claim, one module-local `function` under the other.
    // Written to a throwaway path so the control cannot be satisfied by
    // anything already in the tree.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-7265-'));
    try {
      const fixture = path.join(dir, 'relapse.ts');
      fs.writeFileSync(
        fixture,
        [
          "import { CONTEXT_TOKENS } from '@objectstack/spec/data';",
          '',
          '/** Mirrors `CONTEXT_TOKEN_SUGGESTIONS` in `@objectstack/spec`. */',
          'const CONTEXT_TOKEN_SUGGESTIONS: Record<string, string> = { me: "current_user_id" };',
          '',
          'function isContextToken(token: string): boolean {',
          '  return (CONTEXT_TOKENS as readonly string[]).includes(token);',
          '}',
          '',
          'export const used = [CONTEXT_TOKEN_SUGGESTIONS, isContextToken];',
          '',
        ].join('\n'),
      );

      const names = specNamesFor(BURNED);
      expect(scanFile(fixture, names).map((f: { name: string }) => f.name).sort()).toEqual(
        [...BURNED].sort(),
      );
      expect(scanFileForClaims(fixture, names).map((c: { name: string }) => c.name)).toEqual([
        'CONTEXT_TOKEN_SUGGESTIONS',
      ]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the block: shrink-only, and it shrank by exactly these entries', () => {
  it('DEBT no longer lists either name', () => {
    const block = ledgerBlock('DEBT');
    for (const name of BURNED) expect(block).not.toContain(`"${name}"`);
    expect(block).not.toContain('"@object-ui/core"'); // the whole group went
  });

  it('DEBT has not grown — 11 names is the ceiling this slice left', () => {
    // The seeding card counted 14 names; `TreeConfig` (@object-ui/plugin-tree)
    // had already gone before this slice, and this slice took two more. Any
    // future measurement above this number is the ratchet failing, whatever the
    // reason given for it.
    expect(ledgerNames(ledgerBlock('DEBT')).length).toBeLessThanOrEqual(11);
  });

  it('CLAIM_DEBT lost that alignment claim and did not grow either', () => {
    const block = ledgerBlock('CLAIM_DEBT');
    expect(block).not.toContain('"CONTEXT_TOKEN_SUGGESTIONS"');
    expect(ledgerNames(block).length).toBeLessThanOrEqual(18);
  });
});
