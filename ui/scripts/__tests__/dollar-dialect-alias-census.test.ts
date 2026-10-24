/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Pins for `scripts/dollar-dialect-alias-census.mjs` (objectui#8568).
 *
 * Every assertion below corresponds to a way this instrument can lie, and all
 * but one of them lie in the SAME DIRECTION: an alias the scanner cannot see is
 * an alias the census reports as absent, with exit 0 and no error — and the
 * number it prints is the one the maintainer is being asked to price a BREAKING
 * change against. A confident zero is the expensive failure here.
 *
 * The one that lies in the other direction is the sibling dialect. Counting a
 * `FILTER_OPERATOR_ALIASES` row as `$`-dialect reliance would make option 1
 * look expensive for filters option 1 does not touch, which is the mirror-image
 * mistake and just as decision-breaking.
 *
 * Five groups, failing for five different reasons:
 *
 * 1. THE DERIVATION. The alias set comes out of the map and the spec, so a
 *    changed map changes the census. A regression here silently freezes the
 *    census on a dialect the code no longer speaks.
 * 2. THE SYNTAXES. One case per shape an author can write. A regression here
 *    shrinks the population without changing what was scanned.
 * 3. THE CONFLATION GUARD. Case-sensitivity and the `$` requirement, which are
 *    the two things separating this dialect from the tolerant sibling one.
 * 4. THE CLASSIFICATION. Payload vs mention, and role by path — the axes that
 *    stop a flat total from reading as adoption.
 * 5. THE CONTROLS AND THE TREE. The controls must be capable of failing, and
 *    the tree as it stands today must still satisfy them.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CONVERTER_PATH,
  IMPOSSIBLE_SPELLING,
  SIBLING_DIALECT_FILE,
  AUTHORED_ROLE,
  operatorMapKeysFromSource,
  deriveAliases,
  canonicalTwin,
  scanText,
  roleOf,
  isTestPath,
  SELF_FILES,
  siblingDialectBait,
  evaluateControls,
  runCensus,
} from '../dollar-dialect-alias-census.mjs';

const REPO_ROOT = join(__dirname, '..', '..');

/** The two files the census carves out of its own population, by name. */
const CENSUS_PATH = 'scripts/dollar-dialect-alias-census.mjs';
const SUITE_PATH = 'scripts/__tests__/dollar-dialect-alias-census.test.ts';

const SPEC_OPERATORS = [
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$between',
  '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains', '$null', '$exists',
];

const mapSource = (rows: string) => `
export function convertOperatorToAST(operator: string): string | null {
  const operatorMap: Record<string, string> = {
${rows}
  };

  return operatorMap[operator] || null;
}
`;

const shapes = (text: string, spelling: string) =>
  (scanText(text, spelling) as Array<{ shape: string; line: number }>).map((h) => `${h.shape}@${h.line}`);

describe('the alias set is DERIVED from the map and the spec, never listed', () => {
  it('reads the map keys out of the source, quoted or bare', () => {
    const keys = operatorMapKeysFromSource(mapSource(
      "    '$eq': '=',\n    $ne: '!=',\n    '$startswith': 'startswith',",
    ));
    expect(keys).toEqual(['$eq', '$ne', '$startswith']);
  });

  it('calls a spelling the spec does not carry an alias, and nothing else', () => {
    const keys = ['$eq', '$nin', '$notin', '$startsWith', '$startswith'];
    expect(deriveAliases(keys, SPEC_OPERATORS)).toEqual(['$notin', '$startswith']);
  });

  it('derives an EMPTY set on a tree where the aliases were retired', () => {
    // This is the shape of the tree after objectui#8568's option 1. A census
    // that still hunted four hardcoded spellings would keep reporting on a
    // dialect the code no longer speaks.
    const keys = ['$eq', '$nin', '$notContains', '$startsWith', '$endsWith'];
    expect(deriveAliases(keys, SPEC_OPERATORS)).toEqual([]);
  });

  it('picks up a FIFTH alias the day somebody adds one', () => {
    const keys = ['$eq', '$startsWith', '$startswith', '$ncontains'];
    expect(deriveAliases(keys, SPEC_OPERATORS)).toEqual(['$startswith', '$ncontains']);
  });

  it('THROWS rather than reading an empty map when the anchor is gone', () => {
    // Silently reading zero keys would derive zero aliases and print a zero
    // that means "this instrument broke", indistinguishable from "no author
    // relies on the tolerance".
    expect(() => operatorMapKeysFromSource('export const somethingElse = {};'))
      .toThrow(/no longer declares `const operatorMap`/);
    expect(() => operatorMapKeysFromSource(mapSource('    // nothing here')))
      .toThrow(/parsed to zero keys/);
  });

  it('pairs an alias with its canonical twin only when the spec has one', () => {
    expect(canonicalTwin('$startswith', SPEC_OPERATORS)).toBe('$startsWith');
    expect(canonicalTwin('$notcontains', SPEC_OPERATORS)).toBe('$notContains');
    // `$notin` is an alias OF `$nin`, not a case variant of it — the census
    // must not invent a twin for it.
    expect(canonicalTwin('$notin', SPEC_OPERATORS)).toBeNull();
  });
});

describe('the scanner sees every shape an author can write a filter in', () => {
  it('reads a bare operator key in an object literal', () => {
    expect(shapes("const f = { email: { $startswith: 'a' } };", '$startswith')).toEqual(['payload@1']);
  });

  it('reads a quoted key, single or double — JSON metadata is the double form', () => {
    expect(shapes("{ email: { '$startswith': 'a' } }", '$startswith')).toEqual(['payload@1']);
    expect(shapes('{ "email": { "$startswith": "a" } }', '$startswith')).toEqual(['payload@1']);
  });

  it('reads a key written with space before the colon', () => {
    expect(shapes('{ "$endswith" : ".com" }', '$endswith')).toEqual(['payload@1']);
  });

  it('reads the spelling handed to the converter as its whole argument', () => {
    expect(shapes("expect(convertOperatorToAST('$notin')).toBe('nin');", '$notin')).toEqual(['payload@1']);
  });

  it('counts a payload once per line and calls the rest of that line mentions', () => {
    // Two spellings on one line is a doc table row, not two filters.
    expect(shapes("{ $notin: [] } // $notin again", '$notin')).toEqual(['payload@1', 'mention@1']);
  });

  it('finds payloads on the lines they are on, across a multi-line literal', () => {
    const text = ['const f = {', "  a: { $notin: [1] },", '  b: 2,', "  c: { $notin: [3] },", '};'].join('\n');
    expect(shapes(text, '$notin')).toEqual(['payload@2', 'payload@4']);
  });
});

describe('the $ and the case are what separate this dialect from the tolerant sibling one', () => {
  it('does NOT count the $-free row of the same name', () => {
    // `FILTER_OPERATOR_ALIASES` really carries these rows, and
    // `normalizeFilterOperator` lowercases before the lookup, so that dialect
    // accepts every casing BY DESIGN. It is not objectui#8568's subject.
    const table = ["  starts_with: 'startswith',", "  startswith: 'startswith',", "  notin: 'nin',"].join('\n');
    expect(scanText(table, '$startswith')).toEqual([]);
    expect(scanText(table, '$notin')).toEqual([]);
  });

  it('is CASE-SENSITIVE in both directions', () => {
    // A case-insensitive probe reports the canonical corpus as alias reliance,
    // and a case-insensitive exclusion erases the aliases entirely. Both were
    // live hazards while this census was being written.
    expect(scanText("{ $startsWith: 'a' }", '$startswith')).toEqual([]);
    expect(scanText("{ $startswith: 'a' }", '$startsWith')).toEqual([]);
  });

  it('will not match a longer identifier that merely begins with the spelling', () => {
    expect(scanText("{ $notinclude: 1 }", '$notin')).toEqual([]);
    expect(scanText("{ $startswithPrefix: 1 }", '$startswith')).toEqual([]);
  });

  it('will not match a spelling glued to the left of a longer token', () => {
    expect(scanText('const x$notin = 1;', '$notin')).toEqual([]);
  });

  it('reads the impossible control spelling nowhere', () => {
    expect(scanText(`{ ${IMPOSSIBLE_SPELLING}: 1 }`, '$startswith')).toEqual([]);
  });
});

describe('payload versus mention, and role by path', () => {
  it('calls a backticked prose span and a table cell mentions, not filters', () => {
    expect(shapes('Lowercase aliases (`$startswith`, `$notcontains`) are accepted.', '$startswith'))
      .toEqual(['mention@1']);
    expect(shapes('| `$startsWith` / `$startswith` | `startswith` | … |', '$startswith'))
      .toEqual(['mention@1']);
  });

  it('calls a roster entry a mention — an it.each list is a claim, not a filter', () => {
    expect(shapes("it.each(['$startswith', '$notcontains', '$notin'])(", '$startswith'))
      .toEqual(['mention@1']);
  });

  it('routes the map itself to implementation and its suites to the ledger', () => {
    expect(roleOf(CONVERTER_PATH)).toBe('implementation');
    expect(roleOf('packages/core/src/utils/__tests__/filter-converter.test.ts')).toBe('converter-ledger');
    expect(roleOf('packages/data-objectstack/README.md')).toBe('converter-ledger');
    expect(roleOf('packages/core/src/adapters/README.md')).toBe('refusal-ledger');
    // ⛔ A synthetic name, never a PENDING declaration this repository carries
    // (objectui#9583). `roleOf` routes by path PREFIX — see the `.changeset/`
    // row of the census's role map — so the basename carries no meaning here
    // beyond sitting under the changeset directory, while a real one makes this
    // literal a `markdown-test-inputs` ledger entry that `changeset version`
    // deletes out from under. `check-pending-changeset-literals.mjs` holds it.
    expect(roleOf('.changeset/fixture-pending-declaration.md')).toBe('release-notes');
  });

  it('routes the trees an author writes in to the authored corpus', () => {
    for (const p of [
      'examples/schema-catalog/src/schemas/x.json',
      'apps/console/src/pages/system/AuditLogPage.tsx',
      'content/docs/guide/dashboard-filters.md',
      'e2e/x.spec.ts',
    ]) expect(roleOf(p)).toBe(AUTHORED_ROLE);
  });

  it('puts the map ahead of the tree-wide prefixes, so first match wins', () => {
    // `packages/core/src/adapters/` would otherwise swallow nothing here, but
    // the ordering is what keeps the converter out of `other`.
    expect(roleOf(CONVERTER_PATH)).not.toBe('other');
    expect(roleOf('packages/plugin-grid/src/ObjectGrid.tsx')).toBe('other');
  });

  it('knows a test inside an authored tree is still a test', () => {
    expect(isTestPath('apps/console/src/pages/system/AuditLogPage.test.tsx')).toBe(true);
    expect(isTestPath('scripts/__tests__/anything.ts')).toBe(true);
    expect(isTestPath('apps/console/src/pages/system/AuditLogPage.tsx')).toBe(false);
  });
});

describe('the controls can fail, which is the only reason their passing means anything', () => {
  const base = {
    aliases: ['$notin', '$startswith'],
    specOperators: SPEC_OPERATORS,
    byRole: { canonicalTotals: { $startsWith: 12 } },
    authoredPayloadCanonical: [{ file: 'apps/x.ts', line: 1, spelling: '$gte' }],
    siblingHits: 0,
    siblingBait: 4,
    impossibleHits: 0,
  };
  const idsFailing = (over: Record<string, unknown>) =>
    (evaluateControls({ ...base, ...over }) as Array<{ id: string; ok: boolean }>)
      .filter((c) => !c.ok).map((c) => c.id);

  it('passes all four on a healthy reading', () => {
    expect(idsFailing({})).toEqual([]);
  });

  it('fails canonical-twin when the scanner cannot see the camelCase spellings', () => {
    expect(idsFailing({ byRole: { canonicalTotals: {} } })).toEqual(['canonical-twin']);
  });

  it('fails authored-reach when no $-dialect payload was found outside the tests', () => {
    expect(idsFailing({ authoredPayloadCanonical: [] })).toEqual(['authored-reach']);
  });

  it('fails impossible when the scanner matches a spelling nobody wrote', () => {
    expect(idsFailing({ impossibleHits: 1 })).toEqual(['impossible']);
  });

  it('fails sibling-dialect the moment a $-free row is counted', () => {
    expect(idsFailing({ siblingHits: 1 })).toEqual(['sibling-dialect']);
  });

  it('fails sibling-dialect when its BAIT is gone, rather than passing vacuously', () => {
    // "The census counted zero sibling rows" and "there are no sibling rows
    // left to count" are the same reading unless the bait is measured. A
    // negative control that cannot be tripped is not evidence.
    expect(idsFailing({ siblingBait: 0 })).toEqual(['sibling-dialect']);
  });

  it('does not demand a lit twin on a tree that has no aliases left', () => {
    // After option 1 there is nothing to light, and a control that cannot be
    // satisfied would make the post-retirement census permanently "not a
    // reading".
    expect(idsFailing({ aliases: [], byRole: { canonicalTotals: {} } })).toEqual([]);
  });
});

describe('the tree as it stands today', () => {
  it('still declares the operatorMap this census reads', () => {
    const source = readFileSync(join(REPO_ROOT, CONVERTER_PATH), 'utf8');
    expect(() => operatorMapKeysFromSource(source)).not.toThrow();
    expect(operatorMapKeysFromSource(source)).toContain('$eq');
  });

  it('carves ITSELF out, both files, by name', () => {
    expect(SELF_FILES.has(CENSUS_PATH)).toBe(true);
    expect(SELF_FILES.has(SUITE_PATH)).toBe(true);
  });

  it('keeps the bait in the CENSUS and out of the SUITE, which is what makes one entry control-backed', () => {
    // `IMPOSSIBLE_SPELLING` as a LITERAL is the whole reason dropping the census
    // from SELF_FILES fires the `impossible` control instead of printing a
    // quietly wrong number. This suite must NOT carry that literal — it hands
    // the imported binding to `scanText` — or the ablation below would fire for
    // the wrong file and the two entries would look interchangeable.
    //
    // ⚠️ The comment this replaced claimed BOTH files carried the impossible
    // spelling. Measured, only one does, and the pin below is what keeps the
    // corrected claim honest.
    const censusSource = readFileSync(join(REPO_ROOT, CENSUS_PATH), 'utf8');
    const suiteSource = readFileSync(join(REPO_ROOT, SUITE_PATH), 'utf8');
    expect(
      scanText(censusSource, IMPOSSIBLE_SPELLING).length,
      'the census must carry the impossible spelling, or its carve-out has no control behind it',
    ).toBeGreaterThan(0);
    expect(
      scanText(suiteSource, IMPOSSIBLE_SPELLING),
      'this suite must reach the impossible spelling through the import, never as a literal',
    ).toEqual([]);
  });

  it('is asymmetric, measured by ABLATION rather than asserted: only the census entry is control-backed', async () => {
    // objectui#9891 asked whether the `fixture-address: <reason>` class should
    // replace this by-name list. The answer turns on what the list actually
    // blocks, so this case REMOVES each entry and reads the controls, instead of
    // taking either entry's justification on trust.
    const controlsOf = async (dropped: string) => {
      SELF_FILES.delete(dropped);
      try {
        const r = await runCensus(REPO_ROOT) as { controls: Array<{ id: string; ok: boolean; detail: string }> };
        return r.controls;
      } finally {
        SELF_FILES.add(dropped);
      }
    };

    // Leg 1 — the census. Scanning it must make its own negative control fire,
    // so a drifted entry REFUSES to print a number rather than printing a wrong
    // one. That is the property a declaration would otherwise have had to buy.
    const withoutCensus = await controlsOf(CENSUS_PATH);
    const impossible = withoutCensus.find((c) => c.id === 'impossible');
    expect(
      impossible?.ok,
      'scanning this census must fire its own `impossible` control — that is what backs the by-name entry',
    ).toBe(false);

    // Leg 2 — the suite. ⚠️ Nothing fires. Recorded rather than implied: this
    // entry rests on the plain argument only, and a reader who generalises the
    // first leg to both would be wrong. If a control is ever added that DOES
    // back it, this case goes red and the census docblock has to be corrected
    // in the same change.
    const withoutSuite = await controlsOf(SUITE_PATH);
    expect(
      withoutSuite.filter((c) => !c.ok).map((c) => c.id),
      'no control witnesses the suite carve-out today; the docblock says so and this pins it',
    ).toEqual([]);

    // Both entries restored, so no later case inherits a mutated carve-out.
    expect([...SELF_FILES].sort()).toEqual([SUITE_PATH, CENSUS_PATH].sort());
  });

  it('still carries the $-free sibling rows the conflation control is aimed at', () => {
    // If this file ever stops carrying them, the `sibling-dialect` control is
    // testing nothing and the census needs a new anchor rather than a green
    // control that cannot fail.
    const source = readFileSync(join(REPO_ROOT, SIBLING_DIALECT_FILE), 'utf8');
    expect(source).toMatch(/^\s*startswith:\s*'startswith',$/m);
    expect(source).toMatch(/^\s*notin:\s*'nin',$/m);
    expect(siblingDialectBait(source)).toBeGreaterThan(0);
  });

  it('counts bait only where the $ is absent, so the probe is not just a second alias grep', () => {
    expect(siblingDialectBait("  startswith: 'startswith',\n  notin: 'nin',\n")).toBe(2);
    expect(siblingDialectBait("  $startswith: 'startswith',\n")).toBe(0);
  });

  it('passes every control on a real run, so the printed number is a reading', async () => {
    const r = await runCensus(REPO_ROOT) as {
      mapKeys: string[];
      specOperators: string[];
      aliases: string[];
      controls: Array<{ id: string; ok: boolean; detail: string }>;
      rows: Array<{ role: string }>;
      selfCarved: number;
    };
    const failed = r.controls.filter((c) => !c.ok).map((c) => `${c.id}: ${c.detail}`);
    expect(failed, 'a census run whose controls fail is not a reading').toEqual([]);

    // objectui#8568 has since been RULED (option 1) and the four aliases are
    // retired, so on this tree the derived set is legitimately EMPTY. That is
    // the DESIGNED post-ruling reading, not blindness: the census models it (its
    // canonical-twin arm), and the synthetic case above pins the same thing.
    //
    // ⚠️ This case used to assert `aliases.length > 0`, `rows.length > 0` and
    // `selfCarved > 0` unconditionally, and the retirement made all three false
    // at once. The blindness guard they carried is real and is re-expressed
    // rather than deleted: on an empty tree the instrument's reach is proved by
    // `authored-reach`, which counts CANONICAL `$`-operator payloads in
    // non-test authored files and therefore cannot be satisfied by a scanner
    // that never opened the authored corpus.
    const reach = r.controls.find((c) => c.id === 'authored-reach');
    expect(reach?.ok, 'the scanner must be shown to reach the authored corpus on either tree').toBe(true);

    if (r.aliases.length === 0) {
      // An empty set has to be DERIVED, not the residue of a failed read on
      // either side — that is the one way this branch could pass vacuously.
      expect(r.mapKeys.length, 'an empty alias set read off an EMPTY operatorMap is a read failure').toBeGreaterThan(0);
      expect(r.specOperators.length, 'an empty alias set read against an EMPTY spec list is a read failure').toBeGreaterThan(0);
      // Recomputed HERE rather than by calling `deriveAliases` again: measured,
      // a stubbed `deriveAliases` that returns `[]` satisfies its own output and
      // this branch would pass while witnessing nothing. Asking the question
      // independently — every accepted key must be a canonical one — is what
      // makes an alias re-added to the map red here even if the census's own
      // derivation is what broke.
      expect(
        r.mapKeys.filter((key) => !r.specOperators.includes(key)),
        'the alias set is accepted-minus-canonical; a non-canonical accepted key means the empty set is wrong',
      ).toEqual([]);
      // No alias exists, so no occurrence of one can, and there is nothing for
      // the self carve-out to remove.
      expect(r.rows.length).toBe(0);
      expect(r.selfCarved).toBe(0);
      return;
    }

    // The pre-retirement shape, kept intact so this case still holds on any
    // tree that carries an alias again — including a revert of the retirement.
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.selfCarved).toBeGreaterThan(0);
  });
});
