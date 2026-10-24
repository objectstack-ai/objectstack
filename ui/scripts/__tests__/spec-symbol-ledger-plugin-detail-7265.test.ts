import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { scanFile, specExportNames } from '../check-spec-symbol-derivation.mjs';

/**
 * objectui#7265, the `@object-ui/plugin-detail` slice -- the LAST group, and the
 * one whose landing leaves rule 1's `DEBT` block empty for the first time since
 * objectui#6291 re-seeded it.
 *
 * Sibling of `spec-symbol-ledger-core-7265.test.ts`,
 * `spec-symbol-ledger-app-shell-7265.test.ts`,
 * `spec-symbol-ledger-types-7265.test.ts`,
 * `spec-symbol-ledger-components-7265.test.ts` and
 * `spec-symbol-ledger-data-objectstack-7265.test.ts`, same two-part shape,
 * because a ledger needs both halves:
 *
 *   1. THE SITE. The real scanner, run over the real file. This is the half that
 *      reds if a local copy comes back -- deleting a name from a ledger is not a
 *      burn-down unless the declaration went with it.
 *   2. THE BLOCK. Shrink-only is the card's own invariant, so it is asserted,
 *      not just respected. This slice is the one that can finally state it as an
 *      equality, because the floor and the ceiling have met.
 *
 * ...plus two halves that belong to nobody else, because nothing after this
 * slice will be in a position to add them:
 *
 *   3. THE EMPTY-LEDGER PATH, live for the first time. `DEBT`, `DEBT_ISSUE` and
 *      the ratchet that reads them are the guard against RE-SEEDING, so an empty
 *      ledger is the end state rather than the cue to delete the machinery.
 *   4. THE STALE-ENTRY MESSAGE's wording. That message is quoted into pull
 *      requests by design on this card; the reason its wording is constrained is
 *      written at the ratchet that emits it, and this is what makes the
 *      constraint fail loudly instead of being remembered.
 *
 * WHY THE ROUTE WAS RENAME, in one line: at the resolved pin the spec's
 * `RecordAlertProps` is the AUTHORED property bag of the `record:alert` block,
 * while the local declaration was the React props its RENDERER is called with --
 * the spec's bag nested one level down inside it. Different concepts under one
 * name, and the directory's other renderers already spell the difference.
 *
 * ⚠️ The scanner is only evidence if it can fail, so every site reading here is
 * paired with a fixture of the same kind that it MUST flag. A green scan with an
 * empty `specNames` map, or over a path that does not exist, looks exactly like
 * a green scan over a burned-down site.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-spec-symbol-derivation.mjs');
const gateTestSource = path.join(repoRoot, 'scripts/__tests__/check-spec-symbol-derivation.test.ts');

/** The name that was BURNED DOWN by renaming off it. */
const FORMERLY = 'RecordAlertProps';
/** What it is called now -- the `…RendererProps` spelling its siblings already use. */
const RENAMED = 'RecordAlertRendererProps';
/** The subpath the spec owns the old name on. */
const SUBPATH = '@objectstack/spec/ui';
/** The single file it lived in. */
const SITE = 'packages/plugin-detail/src/renderers/record-alert.tsx';
/** The ledger key a waiver would have been written under. */
const ALLOW_KEY = `@object-ui/plugin-detail:${FORMERLY}`;

/**
 * The gate's OWN view of what `@objectstack/spec` exports, per subpath -- read
 * from the gate rather than rebuilt here. A hand-written map would make every
 * assertion below a statement about this file instead of about the spec, and it
 * would keep passing after the spec stopped exporting the name that is the whole
 * reason for the rename.
 */
const specNames = specExportNames().names as Map<string, Set<string>>;

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

describe('the spec export-name probe this file judges against', () => {
  it('reads a non-trivial number of names', () => {
    // Guards every assertion below: an empty or collapsed map turns the site
    // reading and the tripwire into the same confident green.
    expect(specNames.size).toBeGreaterThan(1000);
  });

  it('sees TYPE-only exports, not just runtime values', () => {
    // `RecordAlertPropsParsed` is a `z.infer<…>` alias — invisible to a runtime
    // `import()`, so a probe that missed it could not answer the tripwire below
    // for a name the spec publishes as a type.
    expect(specNames.has('RecordAlertPropsParsed')).toBe(true);
  });
});

describe('the reason the route was RENAME', () => {
  it(`the spec still owns \`${FORMERLY}\`, on ${SUBPATH}`, () => {
    // If it ever stops, the rename's reason is spent and the plain name can be
    // taken back. Asserted with the SUBPATH, because that is the half the
    // failure message has to carry for the next reader to re-triage.
    expect(specNames.has(FORMERLY)).toBe(true);
    expect([...(specNames.get(FORMERLY) ?? [])]).toContain(SUBPATH);
  });

  it(`…and it does NOT own \`${RENAMED}\` — the tripwire the rename owes`, () => {
    expect(
      specNames.has(RENAMED),
      `@objectstack/spec now exports \`${RENAMED}\`, which this package declares. `
        + 'The rename has re-created the collision under the new name. Rename again — and '
        + 'check the new name against this probe FIRST: objectui#3074 landed a rename '
        + 'straight onto another spec export.',
    ).toBe(false);
  });

  it('the two names are different CONCEPTS, which is what BIND could not bridge', () => {
    // The measurement, not the preference. The spec's symbol is the block's
    // authored property bag; the local one was the renderer's React props, with
    // that bag nested inside it. Read off the spec's own declared members rather
    // than restated: `schema` is the wrapper's key and the spec's props bag has
    // no business carrying it, while `severity` is the bag's and the wrapper
    // never declared it at the top level.
    const specSubpaths = [...(specNames.get(FORMERLY) ?? [])];
    expect(specSubpaths.length).toBeGreaterThan(0);

    const site = fs.readFileSync(path.join(repoRoot, SITE), 'utf8');
    const decl = site.slice(site.indexOf(`interface ${RENAMED} {`));
    expect(decl).toContain('schema?:');
    expect(decl).toContain('className?:');
    // The spec's bag, nested — not the wrapper's own member list.
    expect(decl).toContain('properties?:');
  });
});

describe('the site: the module-local mirror is gone', () => {
  const found = () =>
    scanFile(path.join(repoRoot, SITE), specNames).map((f: { name: string }) => f.name);

  it(`rule 1 sees no spec-named declaration in ${SITE} at all`, () => {
    // Judged against the REAL name map, so this single reading answers two
    // questions at once: the old name is gone, and the new one is not itself a
    // spec export. A map built by hand here could answer neither.
    expect(found()).toEqual([]);
  });

  it('the scanner can still see the shape it used to flag — the control', () => {
    // Same kind as the subject: the exact declaration this slice renamed.
    withFixture(
      'spec-symbol-plugin-detail-7265-',
      'relapse.tsx',
      [
        `interface ${FORMERLY} {`,
        '  schema?: { properties?: { severity?: string } };',
        '  className?: string;',
        '}',
        '',
        `export const Renderer = (props: ${FORMERLY}) => props.className ?? '';`,
        '',
      ].join('\n'),
      (file) =>
        expect(
          scanFile(file, specNames).map((f: { name: string; kind: string }) => ({
            name: f.name,
            kind: f.kind,
          })),
        ).toEqual([{ name: FORMERLY, kind: 'interface' }]),
    );
  });

  it(`…and the SAME fixture under \`${RENAMED}\` is clean — the other direction`, () => {
    // Both legs of the tripwire through one instrument. Without this one, the
    // reading above could be green because the scanner stopped seeing
    // interfaces rather than because the name stopped colliding.
    withFixture(
      'spec-symbol-plugin-detail-7265-renamed-',
      'renamed.tsx',
      [
        `interface ${RENAMED} {`,
        '  schema?: { properties?: { severity?: string } };',
        '  className?: string;',
        '}',
        '',
        `export const Renderer = (props: ${RENAMED}) => props.className ?? '';`,
        '',
      ].join('\n'),
      (file) => expect(scanFile(file, specNames).map((f: { name: string }) => f.name)).toEqual([]),
    );
  });

  it('…and derive-in-place was never on the table for this shape', () => {
    // The route note, asserted rather than narrated. An `interface` is recorded
    // as derived only through `extends` (the gate's header says so, and
    // `referencesSpec` is called with the heritage clauses for exactly that), so
    // importing the spec's type and USING it in the member block leaves the
    // collision standing. That is why a TYPE having a third route did not give
    // THIS type one.
    withFixture(
      'spec-symbol-plugin-detail-7265-derive-',
      'derive.tsx',
      [
        `import type { ${FORMERLY} as SpecProps } from '${SUBPATH}';`,
        '',
        `interface ${FORMERLY} {`,
        '  schema?: { properties?: SpecProps };',
        '  className?: string;',
        '}',
        '',
        `export const Renderer = (props: ${FORMERLY}) => props.className ?? '';`,
        '',
      ].join('\n'),
      (file) =>
        expect(scanFile(file, specNames).map((f: { name: string }) => f.name)).toEqual([FORMERLY]),
    );
  });
});

describe('the block: shrink-only, and this is the slice where it reaches the floor', () => {
  it(`DEBT no longer lists \`${FORMERLY}\``, () => {
    expect(ledgerBlock('DEBT')).not.toContain(`"${FORMERLY}"`);
  });

  it('the whole `@object-ui/plugin-detail` group is gone', () => {
    expect(ledgerBlock('DEBT')).not.toContain('"@object-ui/plugin-detail"');
  });

  it('DEBT is EMPTY — 0 is both the ceiling and the floor now', () => {
    // Every earlier slice could only state a ceiling, because it did not know
    // what the next one would take. This one does. Stated as an equality on
    // purpose: a later name appearing here is the SHRINK-ONLY invariant being
    // broken, and the block's own note says the single sanctioned reason it may
    // grow (rule 1's jurisdiction widening) — which is a deliberate act that
    // should have to delete this line, not slip past it.
    expect(ledgerNames(ledgerBlock('DEBT'))).toEqual([]);
  });

  it('CLAIM_DEBT did not grow either — this slice removed no rule 2 claim', () => {
    // Measured, not assumed: `--claim-ledger` regenerates that block
    // byte-identically across this change, because the declaration that moved
    // carried no spec-alignment claim.
    expect(ledgerNames(ledgerBlock('CLAIM_DEBT')).length).toBeLessThanOrEqual(18);
  });

  it('ALLOW did NOT gain a waiver — the route was RENAME, and that is worth pinning', () => {
    // A sibling slice put one of its names in ALLOW instead, so "a name left
    // DEBT" does not say which route was taken. This one took none: the
    // collision is gone rather than excused.
    expect(fs.readFileSync(gateSource, 'utf8')).not.toContain(`"${ALLOW_KEY}"`);
  });
});

describe('the empty-ledger path — the end state, not the cue to delete the machinery', () => {
  const gateText = () => fs.readFileSync(gateSource, 'utf8');

  it('`DEBT` still exists as a block, and it parses as empty', () => {
    const block = ledgerBlock('DEBT');
    expect(block.startsWith('const DEBT = {')).toBe(true);
    expect(ledgerNames(block)).toEqual([]);
  });

  it('`DEBT_ISSUE` is declared as a NON-ZERO literal — the stale-entry tail stays switched on', () => {
    // The tail is written behind a `DEBT_ISSUE ?` guard, so the invariant this
    // pin holds is not "declared" — it is "declared AND truthy". objectui#9596
    // measured the difference: a bare digit class admits `= 0`, which matches it
    // (a zero is a decimal digit) and is falsy (so the guard takes its empty
    // branch), switching the tail off silently with this pin green — the exact
    // outcome the pin exists to prevent. Requiring a leading non-zero digit is
    // what closes that, and the implication is exact rather than lucky: the
    // anchor is declared as a literal, so a decimal literal whose first digit is
    // not `0` IS truthy when the gate evaluates it.
    //
    // It fails CLOSED on everything else: `0`, `null` and an expression this pin
    // cannot evaluate all fail to MATCH rather than passing unread. Deleting the
    // declaration outright reds earlier and harder than that, and ⚠ not because
    // of this line — `LEDGER_ANCHORS` reads the const at module scope, so the gate
    // stops importing and this whole file reports no tests at all. Credit that
    // leg to the table, not to this assertion.
    //
    // ⛔ Deliberately NOT asserted through `LEDGER_ANCHORS.issue`, even though
    // that table carries a copy of this value and would state truthiness
    // directly. The guard's operand is THIS module-local const; the table is a
    // second binding, and reading the copy goes green when the two disagree
    // (measured on objectui#9596: the const at `0` with a truthy literal in the
    // table renders no tail, and a truthiness assertion over the table passes).
    // Whether the table stays faithful to the const is a different invariant,
    // pinned in `spec-symbol-ledger-anchor-liveness-9537.test.ts`.
    expect(gateText()).toMatch(/^const DEBT_ISSUE = [1-9]\d*;$/m);
  });

  it('the ratchet that reads `DEBT` is still wired — it is the re-seeding guard', () => {
    // An empty shrink-only ledger does its work through the OTHER half: rule 1's
    // "not in the ledger ⇒ NEW" arm fails a fresh fork by name, and the ratchet
    // here fails a name that outlives its collision. Neither may be deleted on
    // the grounds that there is currently nothing to iterate.
    expect(gateText()).toContain('for (const [pkg, names] of Object.entries(DEBT)) {');
    expect(gateText()).toContain('const declared = new Set(DEBT[pkg] ?? []);');
  });
});

describe('the stale-entry message may not carry a card-closing keyword', () => {
  /** The rule-2 ratchet, from its banner comment to the next one. */
  function staleEntryRatchet(): string {
    const text = fs.readFileSync(gateSource, 'utf8');
    const start = text.indexOf('// 2. Ratchet — a ledger entry whose symbol is fixed');
    expect(start, "rule 2's ratchet banner is gone").toBeGreaterThan(-1);
    const end = text.indexOf('// 3. Ratchet —', start);
    expect(end, "rule 3's ratchet banner is gone").toBeGreaterThan(start);
    return text.slice(start, end);
  }

  /**
   * GitHub's closing-keyword grammar, as the mitigation in root `AGENTS.md`
   * states it: one of the keywords immediately before an issue reference, in any
   * tense, with no sentence parsing of any kind. `#${…}` is included because
   * that is how this message spells the number it interpolates.
   */
  const CLOSING_TRIGGER =
    /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9-]+\/[A-Za-z0-9-]+|objectui|objectstack)?#(?:\$\{|\d)/i;

  it('the regex can fire — the control, on the wording this card replaced', () => {
    // ⛔ Without this leg the assertion below is unfalsifiable: a regex that
    // matches nothing renders exactly like a message that carries nothing.
    //
    // Two legs, and neither writes a live trigger into the tree. The first is
    // the SOURCE form the tail carried until this slice, byte for byte — a
    // template interpolation, which can never resolve to an issue reference in a
    // rendered body. The second proves the regex also catches the RENDERED form,
    // spelled with issue number ZERO because GitHub resolves no card for it:
    // writing a real number here would plant in this file the exact shape the
    // assertion below exists to keep out of it.
    expect(CLOSING_TRIGGER.test('(and close #${DEBT_ISSUE} once the ledger is empty)')).toBe(true);
    expect(
      CLOSING_TRIGGER.test('so the names cannot be re-forked silently (and close #0 once the ledger is empty).'),
    ).toBe(true);
  });

  it('…and the live ratchet carries no trigger', () => {
    expect(
      CLOSING_TRIGGER.test(staleEntryRatchet()),
      "rule 2's stale-entry message has a GitHub closing keyword in front of an issue "
        + 'reference again. Taking the INTERMEDIATE reading and quoting it is standing '
        + 'practice on objectui#7265, so this text reaches pull-request bodies by design '
        + 'and a keyword here ends the anchor card on merge. The reason is written at the '
        + 'ratchet itself.',
    ).toBe(false);
  });

  it('…while still telling the reader what to do with an emptied ledger', () => {
    // The positive half, so "no trigger" cannot be satisfied by deleting the
    // instruction outright.
    expect(staleEntryRatchet()).toContain('once the ledger is empty');
    expect(staleEntryRatchet()).toContain('objectui#${DEBT_ISSUE}');
  });

  it('the CLAIM_DEBT twin is deliberately left alone', () => {
    // Scope, asserted. Its anchor is a CLOSED issue, so the keyword there fires
    // nothing, and the note beside `DEBT_ISSUE` records the exclusion as
    // deliberate. A later hand "finishing the job" makes that note false.
    const text = fs.readFileSync(gateSource, 'utf8');
    expect(text).toContain('(and close #${CLAIM_DEBT_ISSUE} once the ledger is empty)');
  });
});

describe("the narrowing fixture's examples describe a measurement, not today's tree", () => {
  /** The comment attached to the `rendersJsx` near-neighbour fixture. */
  function narrowingNote(): string {
    const text = fs.readFileSync(gateTestSource, 'utf8');
    const end = text.indexOf("it('…but a module-local FUNCTION that renders nothing is still a fork'");
    expect(end, 'the near-neighbour case is gone').toBeGreaterThan(-1);
    const start = text.indexOf('withFixture', end);
    expect(start, 'the fixture is gone').toBeGreaterThan(end);
    return text.slice(end, start);
  }

  /** The claim shape the repair removed — kept as a literal so the probe below has a control. */
  const PRESENT_TENSE_CLAIM = /\bDEBT entries today\b|\bare the live\b/i;

  it('the probe can fire — the control, on the sentence this card repaired', () => {
    // Same discipline as the trigger regex above: a pattern that matches nothing
    // renders exactly like a comment that claims nothing.
    expect(
      PRESENT_TENSE_CLAIM.test(
        '`isContextToken` and `normalizeFilterOperator` are the live instances: '
          + 'non-exported functions under spec export names, both real mirrors, both DEBT '
          + 'entries today.',
      ),
    ).toBe(true);
  });

  it('carries no present-tense ledger-membership claim', () => {
    // The repair objectui#7265's last slice owed. Both names it cites were
    // burned down by this very card — one BOUND, one RENAMED — so a sentence
    // calling them "the live instances … both DEBT entries today" sent the next
    // reader looking for declarations that no longer exist. Same family as the
    // stale COUNT the previous slice deleted: a fact derived once and re-derived
    // never (root `AGENTS.md` #9).
    const note = narrowingNote();
    expect(
      PRESENT_TENSE_CLAIM.test(note),
      'the near-neighbour comment claims present-tense ledger membership again. Anchor the '
        + 'examples to the commit that measured them, the way the `rendersJsx` docblock in '
        + 'the gate itself does, or re-derive them from the tree.',
    ).toBe(false);
  });

  it('…and anchors its examples to the commit that measured them', () => {
    // The positive half: "no present-tense claim" must not be satisfiable by
    // deleting the reasoning the fixture exists to carry.
    const note = narrowingNote();
    expect(note).toContain('objectui#6291');
    expect(note).toContain('rendersJsx');
  });
});
