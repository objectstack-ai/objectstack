import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ⛔ Named, not `import * as`: `eslint.config.js` restricts a namespace import
// of `@objectstack/spec/ui` because two of its names (`FormField`,
// `FormFieldSchema`) are two-LAYER collisions this repo must not reach for by
// accident. The sibling ledger tests namespace-import OTHER subpaths, which the
// rule does not cover.
import { UserFilterFieldSchema, UserFiltersSchema } from '@objectstack/spec/ui';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { scanFile } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#7265, the `@object-ui/types` slice -- the two names this package held
 * in rule 1's DEBT block, both declared in ONE file.
 *
 * Sibling of `spec-symbol-ledger-core-7265.test.ts` and
 * `spec-symbol-ledger-app-shell-7265.test.ts`, same two-part shape, because a
 * ledger needs both halves:
 *
 *   1. THE SITE. The real scanner, run over the real file. This is the half
 *      that reds if a local copy comes back -- deleting a name from a ledger is
 *      not a burn-down unless the declaration went with it.
 *   2. THE BLOCK. Shrink-only is the card's own invariant, so it is asserted,
 *      not just respected.
 *
 * ⭐ What is NEW here, and why this file is not a copy of its two siblings: this
 * slice is the first to use the THIRD route. `UserFilterFieldSchema` was BOUND
 * (it derives from `@objectstack/spec/ui` now, so the scanner must stop seeing
 * it), while `UserFiltersSchema` was moved to the gate's ALLOW map as a declared
 * dialect -- so the scanner must STILL see that one. A waiver excuses a real
 * violation or it is stale, and the gate's ratchet 3 fails on a stale entry; a
 * site pin that only asserted absence would therefore be asserting the opposite
 * of what this half of the slice decided. Both directions are pinned below.
 *
 * ⚠️ What this file does NOT assert, on purpose: that the three surviving DEBT
 * rows are still there. A pin on those would fail on the next slice's success --
 * it would red on healthy progress, which is the opposite of a ratchet.
 *
 * ⚠️ The scanner is only evidence if it can fail, so the site assertions are
 * paired with a fixture of the same kind that it MUST flag. A green scan with an
 * empty `specNames` map, or over a path that does not exist, looks exactly like
 * a green scan over a burned-down site.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');

/** The name that was BURNED DOWN by binding it to the spec. */
const BOUND = 'UserFilterFieldSchema';
/** The name that was triaged as a declared dialect and WAIVED instead. */
const WAIVED = 'UserFiltersSchema';

/** The single site both names live at. */
const SITE = 'packages/types/src/zod/objectql.zod.ts';

/**
 * The names rule 1 matches on, built from the spec's own exports rather than
 * typed out here -- a hand-written name list would keep asserting a collision
 * after the spec stopped exporting the symbol. Both are runtime VALUES (zod
 * schemas), so unlike the app-shell slice's type-only names they can be checked
 * against a namespace import directly.
 */
const SPEC_EXPORTS: ReadonlyArray<readonly [name: string, schema: { safeParse: (v: unknown) => { success: boolean } }]> = [
  [BOUND, UserFilterFieldSchema],
  [WAIVED, UserFiltersSchema],
];

function specNamesForBoth(): Map<string, Set<string>> {
  return new Map([
    [BOUND, new Set(['@objectstack/spec/ui'])],
    [WAIVED, new Set(['@objectstack/spec/ui'])],
  ]);
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

const ledgerNames = (block: string) => [...block.matchAll(/^ {4}"([^"]+)",$/gm)].map((m) => m[1]);

describe('the spec still owns both names this slice had to deal with', () => {
  it.each(SPEC_EXPORTS)('`%s` is still a live `@objectstack/spec/ui` schema', (_name, schema) => {
    // The import above already fails the build if the name disappears; this
    // asserts the stronger thing the routes rest on — that the name still names
    // a PARSER, not a type-only shim that would make every probe below vacuous.
    expect(typeof schema.safeParse).toBe('function');
    expect(schema.safeParse(undefined).success).toBe(false);
  });
});

describe('the site: one name burned down, one still a real violation', () => {
  const found = () => scanFile(path.join(repoRoot, SITE), specNamesForBoth()).map((f: { name: string }) => f.name);

  it(`rule 1 no longer sees \`${BOUND}\` -- the declaration derives now`, () => {
    expect(found()).not.toContain(BOUND);
  });

  it(`rule 1 DOES still see \`${WAIVED}\` -- its ALLOW entry excuses a live violation`, () => {
    // The other half, and the one a naive "the ledger is empty" pin would get
    // backwards. If this ever goes quiet, the waiver in ALLOW is stale and the
    // gate's own ratchet 3 should be failing on it.
    expect(found()).toContain(WAIVED);
  });

  it('and the file declares nothing else under a spec name from this pair', () => {
    expect(found()).toEqual([WAIVED]);
  });

  it('the scanner can still see BOTH shapes -- the control for the three above', () => {
    // Same kind as the subjects: a plain `z.object({…})` const, the spelling
    // both names used before this slice. Written to a throwaway path so the
    // control cannot be satisfied by anything already in the tree.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-types-7265-'));
    try {
      const fixture = path.join(dir, 'relapse.ts');
      fs.writeFileSync(
        fixture,
        [
          "import { z } from 'zod';",
          '',
          'const UserFilterFieldSchema = z.object({ field: z.string() });',
          'const UserFiltersSchema = z.object({ element: z.enum(["dropdown", "tabs"]) });',
          '',
          'export const used = [UserFilterFieldSchema, UserFiltersSchema];',
          '',
        ].join('\n'),
      );

      expect(
        scanFile(fixture, specNamesForBoth())
          .map((f: { name: string }) => f.name)
          .sort(),
      ).toEqual([BOUND, WAIVED].slice().sort());
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('…and the spelling this slice used for the bound one is NOT flagged', () => {
    // The other half of the control, and the one that proves the scan judges
    // DERIVATION rather than counting names: a scanner that flagged this would
    // make the first assertion above unpassable, so its green would mean nothing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-symbol-types-7265-ok-'));
    try {
      const fixture = path.join(dir, 'derived.ts');
      fs.writeFileSync(
        fixture,
        [
          "import { z } from 'zod';",
          "import { UserFilterFieldSchema as SpecUserFilterFieldSchema } from '@objectstack/spec/ui';",
          "import { stripImportedDefaults } from './imported-defaults.js';",
          '',
          'const UserFilterFieldSchema = stripImportedDefaults(SpecUserFilterFieldSchema)',
          '  .extend({ label: z.string().optional() })',
          '  .strip();',
          '',
          'export const used = [UserFilterFieldSchema];',
          '',
        ].join('\n'),
      );

      expect(scanFile(fixture, specNamesForBoth()).map((f: { name: string }) => f.name)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the block: shrink-only, and it shrank by exactly this package', () => {
  it('DEBT lists neither name', () => {
    const block = ledgerBlock('DEBT');
    for (const name of [BOUND, WAIVED]) expect(block).not.toContain(`"${name}"`);
  });

  it('the whole `@object-ui/types` group is gone', () => {
    expect(ledgerBlock('DEBT')).not.toContain('"@object-ui/types"');
  });

  it('DEBT has not grown — 3 names is the ceiling this slice left', () => {
    // The app-shell slice left 5. This one took two of them, both in one file.
    // Any future measurement above this number is the ratchet failing, whatever
    // reason is given for it.
    expect(ledgerNames(ledgerBlock('DEBT')).length).toBeLessThanOrEqual(3);
  });

  it('CLAIM_DEBT did not grow either — this slice removed no rule 2 claim', () => {
    // The @object-ui/core slice was FORCED to regenerate this block too, because
    // the const it deleted carried a `Mirrors …` comment. Neither declaration
    // this slice touched carried a spec-alignment claim, so `--claim-ledger`
    // regenerated byte-identically. If a later edit here moves this number, that
    // coupling is back.
    expect(ledgerNames(ledgerBlock('CLAIM_DEBT')).length).toBeLessThanOrEqual(18);
  });

  it(`ALLOW carries the \`${WAIVED}\` waiver, with a reason and this card`, () => {
    const text = fs.readFileSync(gateSource, 'utf8');
    const key = `"@object-ui/types:${WAIVED}"`;
    const at = text.indexOf(key);
    expect(at, `${key} not found in the gate source`).toBeGreaterThan(-1);
    const entry = text.slice(at, text.indexOf('\n  },\n', at));
    // Not a shape assertion for its own sake: an entry with no reason is the
    // "declared, reasoned, shrink-only" governance broken at the only point a
    // reader can check it.
    expect(entry).toContain('reason:');
    expect(entry).toContain('issue: 7265');
  });
});
