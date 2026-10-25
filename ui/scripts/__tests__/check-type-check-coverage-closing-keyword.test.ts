import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — see
// objectui#3494.
import { auditPackages, collect } from '../check-type-check-coverage.mjs';

/**
 * objectui#9598 — both stale-entry messages in
 * `scripts/check-type-check-coverage.mjs` spelled a GitHub closing keyword
 * immediately in front of the issue number they interpolate. The DEBT tail was
 * a byte-identical twin of the one objectui#9538 replaced in
 * `scripts/check-lint-coverage.mjs`.
 *
 * ## Why a message's WORDING gets a pin at all
 *
 * These messages are written to be QUOTED. The discipline around a `DEBT` or
 * `TEST_DEBT` entry is to take the INTERMEDIATE reading — the package
 * type-checked, the entry not yet deleted — and paste the gate's own output into
 * the pull request as proof the work landed. A closing keyword in front of the
 * number therefore does not stay in the script: it travels into a pull-request
 * body, and on merge it ends the anchor card silently, from a body whose author
 * was being careful. GitHub's parser does no sentence parsing, so no hedging in
 * the surrounding sentence reaches it. The reason is written at the ratchets
 * that emit the messages; this file is what makes the constraint fail loudly
 * instead of being remembered.
 *
 * The landed precedents are the `DEBT` ratchet in
 * `scripts/check-lint-coverage.mjs` and both stale-entry messages in
 * `scripts/check-action-forward-parity.mjs`, pinned by
 * `scripts/__tests__/check-lint-coverage-closing-keyword.test.ts` and
 * `scripts/__tests__/check-action-forward-parity-closing-keyword.test.ts` —
 * cited by the names of the things, not by line address (root `AGENTS.md`,
 * commandment #11).
 *
 * ## Why this file RENDERS both messages instead of reading the source text
 *
 * A source-text assertion cannot tell a repaired emitter from a broken one: it
 * matches a template, not the sentence a contributor would paste, and it reads
 * identically whether or not the emitter can ever fire. Both ledgers here are
 * empty, which is exactly how this shape survived three earlier repairs of the
 * class. So every leg below drives the REAL `collect()` + `auditPackages()` over
 * a throwaway package tree with a SEEDED ledger row that makes the ratchet fire,
 * and asserts on the string it actually produced. `auditPackages` takes its
 * tables as a parameter, so no copy-the-gate-into-a-workspace harness is needed
 * here — the one objectui#9538's pin had to build. The cheap source leg is kept
 * at the end as a supplement, never as the proof.
 *
 * ⚠️ Every rendered leg is paired with a control that MUST fire. A ratchet that
 * emitted nothing, a seed that excused something after all, and a regex that
 * matches nothing all render identically to a clean message — so each is
 * asserted rather than assumed.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateSource = path.join(repoRoot, 'scripts/check-type-check-coverage.mjs');

/**
 * A deliberately meaningless anchor. It has to be TRUTHY — both tails are
 * guarded by `X.issue ? … : ""`, so a zero would render nothing and every
 * assertion below would pass over an empty string.
 */
const FIXTURE_ANCHOR = 424242;

/**
 * GitHub's closing-keyword grammar as root `AGENTS.md` states the mitigation:
 * one of the keywords immediately before an issue reference, in any tense, with
 * no sentence parsing of any kind. Kept byte-identical to the copies in
 * `check-lint-coverage-closing-keyword.test.ts` and
 * `check-action-forward-parity-closing-keyword.test.ts` so the three cannot
 * drift.
 */
const CLOSING_TRIGGER =
  /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:[A-Za-z0-9-]+\/[A-Za-z0-9-]+|objectui|objectstack)?#(?:\$\{|\d)/i;

/** Every table empty, so a fixture tree is judged only on what this leg seeds. */
const NO_TABLES = { debt: {}, notCompiled: [], checkedByOwnBuild: {}, testDebt: {} };

const manifest = (name: string, typeCheck: string) =>
  JSON.stringify({ name, version: '0.0.0', private: true, scripts: { 'type-check': typeCheck } }, null, 2);

const A_TEST = ['import { it, expect } from "vitest";', 'it("works", () => expect(1).toBe(1));', ''].join('\n');

/**
 * Runs the REAL collector and audit over a throwaway workspace carrying the
 * seeded ledger, and returns the one message they produced.
 *
 * `expectedPhrase` is the control that the ratchet under test is the one that
 * fired: several sections of this gate report on the same package, and a
 * fixture that tripped a different one would otherwise read as a pass.
 */
function renderStaleEntry(
  build: (write: (rel: string, contents: string) => void) => void,
  tables: Partial<typeof NO_TABLES>,
  expectedPhrase: string,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'type-check-coverage-anchor-'));
  try {
    build((rel, contents) => {
      const full = path.join(dir, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    });
    const errors: string[] = auditPackages(collect(dir), { ...NO_TABLES, ...tables, root: dir });
    expect(errors, 'the seeded ledger did not make the ratchet fire').toHaveLength(1);
    expect(errors[0], 'a different section fired than the one this leg seeds').toContain(expectedPhrase);
    return errors[0];
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Rule 2's DEBT ratchet: a package declared as known-broken that has since
 * gained a `type-check` script.
 */
const renderStaleDebtEntry = () =>
  renderStaleEntry(
    (write) => {
      write('packages/demo/package.json', manifest('@fixture/demo', 'tsc --noEmit'));
    },
    { debt: { '@fixture/demo': { errors: 3, issue: FIXTURE_ANCHOR } } },
    'now has a "type-check" script',
  );

/**
 * Rule 6's TEST_DEBT ratchet: a package declared as not compiling its tests
 * whose chained test project now reads every one of them.
 */
const renderStaleTestDebtEntry = () =>
  renderStaleEntry(
    (write) => {
      write('packages/demo/package.json', manifest('@fixture/demo', 'tsc --noEmit && tsc -p tsconfig.test.json'));
      write(
        'packages/demo/tsconfig.json',
        JSON.stringify({ include: ['src/**/*'], exclude: ['node_modules', 'dist', 'test'] }, null, 2),
      );
      write(
        'packages/demo/tsconfig.test.json',
        JSON.stringify({ compilerOptions: { noEmit: true }, include: ['test/**/*.test.ts'] }, null, 2),
      );
      write('packages/demo/src/index.ts', 'export const demo = 1;\n');
      write('packages/demo/test/a.test.ts', A_TEST);
    },
    { testDebt: { '@fixture/demo': { errors: 3, issue: FIXTURE_ANCHOR } } },
    'type-checks its tests now',
  );

/** A ratchet's whole region, from its own banner to the next section's. */
function ratchetSource(from: string, to: string): string {
  const text = fs.readFileSync(gateSource, 'utf8');
  const start = text.indexOf(from);
  expect(start, `the banner "${from}" is gone`).toBeGreaterThan(-1);
  const end = text.indexOf(to, start);
  expect(end, `the marker "${to}" after the ratchet is gone`).toBeGreaterThan(start);
  return text.slice(start, end);
}

const debtRatchetSource = () =>
  ratchetSource(
    '// 2. Ratchet — a declared gap that has been closed must leave the list.',
    '// 3. Ratchet — an exemption only holds',
  );

const testDebtRatchetSource = () =>
  ratchetSource(
    '// 6. Ratchet — a declared test gap that has been closed must leave the list.',
    '\n  return errors;',
  );

describe('neither stale-entry message may carry a card-ending keyword', () => {
  it('the regex fires on the wording this card replaced — the control', () => {
    // ⛔ Without this leg every assertion below is unfalsifiable: a ratchet that
    // printed nothing and a regex that matches nothing render identically to a
    // clean message.
    //
    // The resolved form is BUILT here rather than written as a literal, so this
    // file plants no card-ending trigger of its own in the tree. The template
    // forms are the byte-for-byte pre-repair spellings, which can never resolve
    // to an issue reference in a rendered body.
    expect(CLOSING_TRIGGER.test(`(and close #${FIXTURE_ANCHOR} if it is done)`)).toBe(true);
    expect(CLOSING_TRIGGER.test(`(and close #${FIXTURE_ANCHOR} if the list is empty)`)).toBe(true);
    expect(CLOSING_TRIGGER.test('(and close #${debt[name].issue} if it is done)')).toBe(true);
    expect(CLOSING_TRIGGER.test('(and close #${spec.issue} if the list is empty)')).toBe(true);
    // …and the repaired spelling is NOT a false positive for that same regex.
    expect(CLOSING_TRIGGER.test(`, and objectui#${FIXTURE_ANCHOR} can be ended once that work is done`)).toBe(false);
    expect(CLOSING_TRIGGER.test(`, and objectui#${FIXTURE_ANCHOR} can be ended once the list is empty`)).toBe(false);
  });

  it('…and the DEBT message the gate actually renders carries no trigger', () => {
    expect(
      CLOSING_TRIGGER.test(renderStaleDebtEntry()),
      'the DEBT stale-entry message has a GitHub closing keyword in front of an issue reference '
        + 'again. This text is quoted into pull-request bodies by design — quoting the intermediate '
        + 'reading is the standing discipline for burning down a DEBT entry — so a keyword here ends '
        + 'the anchor card on merge. That DEBT is empty today is not a defence: the message is one '
        + 'ledger entry away from rendering, and an empty ledger is exactly why this shape survived '
        + 'three repairs of its class. The reason is written at the ratchet that emits it.',
    ).toBe(false);
  });

  it('…and the TEST_DEBT message the gate actually renders carries no trigger', () => {
    expect(
      CLOSING_TRIGGER.test(renderStaleTestDebtEntry()),
      'the TEST_DEBT stale-entry message has a GitHub closing keyword in front of an issue '
        + 'reference again — same quoting discipline, same merge-path trigger. This tail and the '
        + 'DEBT one are twins and were repaired together; repairing only one of them is how this '
        + 'class keeps coming back one site at a time.',
    ).toBe(false);
  });

  it('…while both still tell the reader what to do with the anchor', () => {
    // The positive half, so "no trigger" cannot be satisfied by deleting the
    // instruction outright — losing the guidance to lose the keyword is the
    // wrong trade.
    for (const rendered of [renderStaleDebtEntry(), renderStaleTestDebtEntry()]) {
      expect(rendered).toContain(`objectui#${FIXTURE_ANCHOR}`);
      expect(rendered).toContain('can be ended once');
    }
  });

  it('both ratchet SOURCES carry no trigger either, comments included', () => {
    // The cheap leg, and not a duplicate of the rendered ones: it also covers
    // the prose beside the emitters, which reaches a reader who is deciding how
    // to word the next entry.
    expect(CLOSING_TRIGGER.test(debtRatchetSource())).toBe(false);
    expect(CLOSING_TRIGGER.test(testDebtRatchetSource())).toBe(false);
  });
});
