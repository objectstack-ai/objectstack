import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeFilterOperator,
  VIEW_FILTER_OPERATORS,
  VIEW_FILTER_OPERATOR_ALIASES,
} from '@objectstack/spec/ui';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { scanFile } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#7265, the `@object-ui/data-objectstack` slice -- the one name this
 * package held in rule 1's DEBT block, in one file, and the first of the card's
 * slices where that name belonged to a FUNCTION.
 *
 * Sibling of `spec-symbol-ledger-core-7265.test.ts`,
 * `spec-symbol-ledger-app-shell-7265.test.ts`,
 * `spec-symbol-ledger-types-7265.test.ts` and
 * `spec-symbol-ledger-components-7265.test.ts`, same two-part shape, because a
 * ledger needs both halves:
 *
 *   1. THE SITE. The real scanner, run over the real file. This is the half that
 *      reds if a local copy comes back -- deleting a name from a ledger is not a
 *      burn-down unless the declaration went with it.
 *   2. THE BLOCK. Shrink-only is the card's own invariant, so it is asserted,
 *      not just respected. Stated as a ceiling rather than an equality so the
 *      last slice can shrink it to nothing without touching this file.
 *
 * ...and a third half this slice had to add, because a FUNCTION is decided by
 * what it DOES and a type is decided by what it holds:
 *
 *   3. THE BEHAVIOUR THAT REFUSED BIND. The spec really does publish a
 *      `normalizeFilterOperator`, this repo really does import it in several
 *      other packages, and none of that made it the same function. The probes
 *      below measure the spec's half of that claim at the RESOLVED pin; the
 *      local half is measured beside the table it belongs to, in
 *      `packages/data-objectstack/src/filter-operator-ast-parity.test.ts`.
 *
 * WHY THE ROUTE WAS RENAME, in one line: the spec's folds an authored spelling
 * to the canonical VIEW vocabulary so `ViewFilterRuleSchema`'s enum can judge
 * it; this package's translated the same input into the server's filter-AST
 * SYMBOLS. Same input, different codomain, so binding would have changed what
 * goes on the wire.
 *
 * WHAT THE MEASUREMENT OVERTURNED, and the reason it is pinned rather than
 * narrated: the seeding note expected the `?? op` tail to be the divergence --
 * this one lenient, the spec's refusing. It is the other way round. Both hand an
 * unrecognised STRING through unchanged, so the tail is COMMON ground; and on
 * the non-string arm it is the SPEC that is lenient (`return op as string`)
 * while this package refuses with a `null` its caller turns into a
 * `MalformedFilterError`. Binding would therefore have WIDENED what this adapter
 * accepts onto the wire. Both directions are probed below.
 *
 * ⚠️ The scanner is only evidence if it can fail, so the site assertion is
 * paired with fixtures of the same kind that it MUST flag. A green scan with an
 * empty `specNames` map, or over a path that does not exist, looks exactly like
 * a green scan over a burned-down site.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');

/** The name that was BURNED DOWN by renaming off it. */
const FORMERLY = 'normalizeFilterOperator';
/** What it is called now -- the codomain that makes it a different function. */
const RENAMED = 'toAstFilterOperator';
/** The subpath the spec owns the old name on. */
const SUBPATH = '@objectstack/spec/ui';
/** The single site it lived at. */
const SITE = 'packages/data-objectstack/src/index.ts';
/** The ledger key a waiver would have been written under. */
const ALLOW_KEY = `@object-ui/data-objectstack:${FORMERLY}`;

/**
 * The names rule 1 matches on, built for the one name this slice dealt with
 * rather than typed out as a list -- a hand-written name list would keep
 * asserting a collision after the spec stopped exporting the symbol.
 */
const specNamesForFormerly = (): Map<string, Set<string>> =>
  new Map([[FORMERLY, new Set([SUBPATH])]]);

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

/** A throwaway file, so a control cannot be satisfied by anything in the tree. */
function withFixture(prefix: string, name: string, body: string, check: (file: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    const file = path.join(dir, name);
    fs.writeFileSync(file, body);
    check(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('the behaviour that refused BIND', () => {
  it(`the spec really does still export a callable \`${FORMERLY}\``, () => {
    // If it ever stops, the rename's reason is spent and the plain name can be
    // taken back -- which is what this package's own RENAMES ratchet says out
    // loud. Asserted as CALLABLE, not merely present: a type-only shim would
    // make every probe below vacuous while leaving them green.
    expect(typeof normalizeFilterOperator).toBe('function');
  });

  it('…and it folds to the canonical VIEW vocabulary, which is not the AST symbol set', () => {
    // The whole route, in two reads. Both spellings of the same operator arrive
    // at a VIEW word, never at the symbol this package puts on the wire.
    const vocabulary = new Set<string>(VIEW_FILTER_OPERATORS);
    for (const spelling of ['eq', 'equals']) {
      const folded = String(normalizeFilterOperator(spelling));
      expect(vocabulary.has(folded), `${spelling} -> ${folded}`).toBe(true);
      expect(folded).toBe('equals');
    }
    // Lit control: the fold is only news if it moves something. `eq` is an alias
    // the spec's own table carries, read off that table rather than restated, so
    // a retirement shows up here rather than in prose.
    expect(VIEW_FILTER_OPERATOR_ALIASES.eq).toBe('equals');
    // …and the symbol this package emits for the same input is not a member, so
    // the two codomains cannot be confused for one.
    expect(vocabulary.has('=')).toBe(false);
  });

  it('every canonical view operator comes back unchanged — the spec folds, it does not translate', () => {
    // Collected rather than asserted per entry (same call as the sibling
    // ratchet in `filter-operator-ast-parity.test.ts`): a vocabulary change
    // lands as a family, and failing on the first would hide the rest.
    const moved = VIEW_FILTER_OPERATORS.filter((op) => String(normalizeFilterOperator(op)) !== op);
    expect(
      moved,
      'the spec\'s `normalizeFilterOperator` now rewrites canonical view operators. It used to '
        + 'return them untouched, which is the property that made it a FOLD to the view '
        + 'vocabulary rather than a translation to anything else — re-read whether '
        + `\`${RENAMED}\` is still a different function before trusting the rename.`,
    ).toEqual([]);
  });

  it('the `?? op` tail is COMMON ground, not the divergence', () => {
    // The reading the seeding note got backwards. An unrecognised STRING is
    // handed through unchanged by the spec's too, so "the spec refuses instead"
    // is not a difference that exists.
    expect(normalizeFilterOperator('totally_unknown')).toBe('totally_unknown');
  });

  it('…and on the NON-string arm it is the SPEC that is lenient', () => {
    // The half that actually refuses BIND. The spec hands a non-string straight
    // back; this package returns `null` there, and `objectFilterEntryToAST`
    // turns that into a `MalformedFilterError` rather than sending a number in
    // an operator slot. That refusal is pinned end-to-end, through the real
    // adapter and both `find()` routes, by the `operator: 42` case in
    // `packages/data-objectstack/src/filter-entry-translation.test.ts`; what is
    // asserted HERE is the other side of the comparison — that swapping the
    // spec's in would have removed it.
    expect(normalizeFilterOperator(42 as unknown)).toBe(42);
    expect(normalizeFilterOperator(null as unknown)).toBe(null);
  });
});

describe('the site: the module-local mirror is gone', () => {
  const found = () =>
    scanFile(path.join(repoRoot, SITE), specNamesForFormerly()).map((f: { name: string }) => f.name);

  it(`rule 1 no longer sees \`${FORMERLY}\` — the declaration is \`${RENAMED}\` now`, () => {
    expect(found()).toEqual([]);
  });

  it('the scanner can still see the shape it used to flag — the control', () => {
    // Same kind as the subject: the exact declaration this slice renamed.
    withFixture(
      'spec-symbol-data-objectstack-7265-',
      'relapse.ts',
      [
        `function ${FORMERLY}(op: unknown): string | null {`,
        "  if (typeof op !== 'string') return null;",
        '  return op;',
        '}',
        '',
        `export const used = ${FORMERLY}('eq');`,
        '',
      ].join('\n'),
      (file) =>
        expect(
          scanFile(file, specNamesForFormerly()).map((f: { name: string; kind: string }) => ({
            name: f.name,
            kind: f.kind,
          })),
        ).toEqual([{ name: FORMERLY, kind: 'function' }]),
    );
  });

  it('…and a FUNCTION cannot be derived out of the finding — which is why the route set is small', () => {
    // The other half of the control, and the place this slice differs from its
    // type-shaped siblings. For a type, wrapping the spec's is a legitimate BIND
    // form the gate accepts; for a function there is no such form — rule 1
    // records every function declaration with `derived: false`, so importing the
    // spec's and re-declaring a wrapper under the same name is STILL flagged.
    // That is what left exactly three exits (delete the declaration and import,
    // rename, or waive) before the site was read at all, and it is asserted
    // rather than remembered because a later `rendersJsx`-style narrowing that
    // exempted functions would make the first assertion in this block unpassable
    // and its green meaningless.
    withFixture(
      'spec-symbol-data-objectstack-7265-wrapped-',
      'wrapped.ts',
      [
        `import { ${FORMERLY} as spec${FORMERLY} } from '${SUBPATH}';`,
        '',
        `function ${FORMERLY}(op: unknown): string | null {`,
        `  return typeof op === 'string' ? String(spec${FORMERLY}(op)) : null;`,
        '}',
        '',
        `export const used = ${FORMERLY}('eq');`,
        '',
      ].join('\n'),
      (file) =>
        expect(scanFile(file, specNamesForFormerly()).map((f: { name: string }) => f.name)).toEqual([
          FORMERLY,
        ]),
    );
  });
});

describe('the block: shrink-only, and it shrank by exactly this package', () => {
  it(`DEBT no longer lists \`${FORMERLY}\``, () => {
    expect(ledgerBlock('DEBT')).not.toContain(`"${FORMERLY}"`);
  });

  it('the whole `@object-ui/data-objectstack` group is gone', () => {
    expect(ledgerBlock('DEBT')).not.toContain('"@object-ui/data-objectstack"');
  });

  it('DEBT has not grown — 1 name is the ceiling this slice left', () => {
    // The `@object-ui/components` slice left 2. This one took one of them.
    // Any future measurement above this number is the ratchet failing, whatever
    // reason is given for it.
    expect(ledgerNames(ledgerBlock('DEBT')).length).toBeLessThanOrEqual(1);
  });

  it('CLAIM_DEBT did not grow either — this slice removed no rule 2 claim', () => {
    // Measured, not assumed: `--claim-ledger` regenerates that block
    // byte-identically across this change, because the declaration that moved
    // carried no spec-alignment claim. The `@object-ui/core` slice was forced to
    // regenerate both; if a later edit here moves this number, that coupling is
    // back.
    expect(ledgerNames(ledgerBlock('CLAIM_DEBT')).length).toBeLessThanOrEqual(18);
  });

  it('ALLOW did NOT gain a waiver — the route was RENAME, and that is a fact worth pinning', () => {
    // A sibling slice put one of its names in ALLOW instead, so "a name left
    // DEBT" does not say which route was taken. This one took none: the
    // collision is gone rather than excused. A later hand that waives it instead
    // has to delete this assertion, which is the visibility a silent re-fork
    // would not have.
    expect(fs.readFileSync(gateSource, 'utf8')).not.toContain(`"${ALLOW_KEY}"`);
  });
});

describe('the stale figure this slice was authorised to delete stays deleted', () => {
  /** The `DEBT_ISSUE` note — from the rule-1 ledger header down to the const. */
  function debtIssueNote(): string {
    const text = fs.readFileSync(gateSource, 'utf8');
    const end = text.indexOf('const DEBT_ISSUE =');
    expect(end, 'the DEBT_ISSUE anchor is gone').toBeGreaterThan(-1);
    const start = text.lastIndexOf('// ⚠️ `CLAIM_DEBT_ISSUE`', end);
    expect(start, 'the CLAIM_DEBT_ISSUE note is gone').toBeGreaterThan(-1);
    return text.slice(start, end);
  }

  it('carries no entry count at all', () => {
    // AGENTS.md #9, and the reason this act was worth a line of the card: the
    // sentence used to say how many entries objectui#7265 had burned out of each
    // block, which was a figure derived once and re-derived never. It is not
    // enough to have deleted it — a later hand "helpfully" re-deriving it to a
    // NEW number is the same defect wearing a fresh answer, and that is the move
    // this assertion exists to make loud rather than silent.
    const note = debtIssueNote();
    const counts = [...note.matchAll(/\b(?:one|two|three|four|five|six|\d+)[- ]entr/gi)].map(
      (m) => m[0],
    );
    expect(
      counts,
      'the `DEBT_ISSUE` note has a ledger size written into it again. Point at the instrument '
        + 'instead: `--ledger` and `--claim-ledger` regenerate the blocks and the run banner '
        + 'prints both counts.',
    ).toEqual([]);
  });

  it('…and names the instrument in its place', () => {
    // The positive half, so "no count" cannot be satisfied by deleting the
    // sentence outright and telling the reader nothing.
    const note = debtIssueNote();
    expect(note).toContain('--ledger');
    expect(note).toContain('--claim-ledger');
  });
});
