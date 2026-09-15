// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN — `content/docs/deployment/cli.mdx`'s two ENUMERATIONS against the
 * declarations they are about (#17723).
 *
 * ## The record this exists for, and what it is NOT
 *
 * The page is correct today. This pin is not the repair of a wrong page; it is
 * what keeps a right page right. Three times an enumeration on it fell behind
 * the code it enumerates, always in the same direction — UNDER-INCLUSIVE — and
 * every one of the three was repaired by hand:
 *
 *   #8965        an earlier under-inclusive drift on this page.
 *   #16892 ①     the scaffolded-scripts sentence said "these" of THREE commands
 *                and named TWO npm scripts. Under-inclusive from #16330, and
 *                for all four scaffolders from #16350 / PR #16888.
 *   #16892 ②     `os lint` declares ELEVEN flags; the page documented FOUR.
 *                One of the seven missing was `--include-platform`, which the
 *                command NAMES IN ITS OWN HINT — so a reader following that
 *                hint arrived at a page that did not mention the flag.
 *
 * Hand repair is what produces `4 of 11` in the first place. Nothing read
 * either enumeration, so nothing could fail.
 *
 * ## Why a pin and not a generator
 *
 * The standing repair order puts a check LAST: delete the construct that lets
 * the error happen, make the correct form the only spelling, and only then add
 * a check. Generating the options table would be that second step — and it was
 * MEASURED against what the table carries, row by row, before being set aside:
 * the page's rows are not the declarations' `description` strings. `--json` is
 * declared as "Output as JSON" and documented as "Output as JSON, for CI. The
 * verdict fields are described below"; the `--include-platform` row names the
 * hint that sends a reader there; `config` links to the auto-detection section
 * of the same page. Generation reaches the MEMBERSHIP of the table and none of
 * that text, and pushing the text into the declarations would put doc-site
 * cross-references into `--help`. Membership is also exactly what drifted all
 * three times — not one of the three was a wrong description. So the residue
 * generation cannot reach is empty, and what it CAN reach is held here instead.
 *
 * ## The two bindings, and that both sources are machine-enumerable
 *
 *   1. The `**Options.**` table under `#### \`os lint\`` is held to
 *      `Lint.flags` and `Lint.args` — the oclif declarations, IMPORTED, not
 *      transcribed and not parsed out of the source text. A flag that is added,
 *      removed or renamed moves this pin with it, and a declaration that is
 *      MOVED is a module-resolution failure rather than an empty derived set.
 *   2. The scaffolded-wiring callout is held to `TEMPLATES` (the `os init`
 *      template maps) and to the `create-objectstack` blank template's own
 *      `package.json`. The documented script list is compared with the scripts
 *      that EVERY scaffolder declares AND that invoke the ObjectStack CLI —
 *      derived, so a fourth such script reddens the sentence that omits it.
 *      `typecheck` (`tsc --noEmit`) is declared by all four and is not one;
 *      `dev`, `start` and `test` invoke the CLI in some scaffolders and not
 *      all. Today that derivation is exactly `build`, `validate`, `lint`.
 *
 * ## The half this does NOT duplicate, stated so the reason stays true
 *
 * `packages/cli/test/scaffold-ci-script-parity.test.ts` holds the SCAFFOLDERS
 * to each other and to the workflow the on-ramp ships. That is the source side,
 * and it was already green through all three drifts — it cannot see a sentence.
 * This file holds the PAGE to that same source. The gap #17723 records is
 * one-sided, and this is the side of it.
 *
 * `scripts/check-cli-examples-parity.mjs` holds this page's `os package
 * publish` EXAMPLE block to the examples the command declares. An example set
 * and a flag set are different populations — `os lint` declares no `examples`
 * at all, and a flag need not appear in any example — so that gate is
 * structurally blind to a missing flag and extending it would not have been
 * the cheap win it looks like.
 *
 * ## What this pin does NOT cover
 *
 *   - The `--manifest-id` CONDITION (#16892 item ③) and every other statement
 *     of the form "X applies when Y". A condition is not an enumeration; there
 *     is no set to compare it with, and claiming otherwise would make this
 *     file's stated reason false.
 *   - The eight-line `os lint` example fence above the table. It is a sample,
 *     not a claim of totality, and holding it to the declaration would force
 *     every flag into an example.
 *   - Row TEXT. See "Why a pin and not a generator" — membership only.
 *   - Any other page. This file is about `content/docs/deployment/cli.mdx`.
 *
 * ## Firing controls
 *
 * Every comparison here can pass by reading nothing: an anchor that stops
 * matching yields an empty documented set, an empty derived set compares clean
 * with it, and the run is green. So each parser is asserted NON-EMPTY before it
 * is asserted EQUAL, the governed-command roster carries a floor, and an
 * `**Options.**` table for a command this file does not bind is itself a
 * failure — a new table cannot arrive unheld.
 *
 * ⛔ Never satisfy a red here by deleting an enumeration from the page, or by
 * dropping a command from the roster. The enumeration is the promise.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Lint from '../src/commands/lint.js';
import { TEMPLATES } from '../src/commands/init.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');

// One `resolve(HERE, …)` call per line and nothing split across lines:
// `check:cross-package-test-inputs` reconstructs these reads by SOURCE SCAN,
// and a spelling it cannot parse leaves the glob declared and held by nothing.
// Both are already declared for `@objectstack/cli` in
// scripts/cross-package-test-inputs.mjs and mirrored into turbo.json.
const CLI_PAGE = resolve(HERE, '../../..', 'content/docs/deployment/cli.mdx');
const BLANK_TEMPLATE_PKG = resolve(HERE, '../../..', 'packages/create-objectstack/src/templates/blank/package.json');

const PAGE = readFileSync(CLI_PAGE, 'utf8');
const PAGE_ID = 'content/docs/deployment/cli.mdx';

// ─── The derived sets ───────────────────────────────────────────────

/**
 * The commands whose `**Options.**` table this file binds. A table under a
 * command that is not here is a finding, so the roster cannot be narrowed to
 * make a red go away.
 */
const GOVERNED = {
  lint: { flags: Object.keys(Lint.flags), args: Object.keys(Lint.args) },
} satisfies Record<string, { flags: string[]; args: string[] }>;

/** The roster's floor: the command #16892 ② measured at 4 of 11. */
const GOVERNED_FLOOR = ['lint'];

/** Every scaffolder that writes a new project's `package.json`, by its documented name. */
const SCAFFOLDER_SCRIPTS: Record<string, Record<string, string>> = {
  ...Object.fromEntries(Object.entries(TEMPLATES).map(([name, t]) => [name, t.scripts])),
  'create-objectstack blank': JSON.parse(readFileSync(BLANK_TEMPLATE_PKG, 'utf8')).scripts,
};

/** The script names in one map whose command line runs the ObjectStack CLI. */
function cliScripts(scripts: Record<string, string>): Set<string> {
  return new Set(Object.entries(scripts).filter(([, body]) => /\bobjectstack\b/.test(body)).map(([name]) => name));
}

/** The CLI-invoking scripts EVERY scaffolder declares — what the callout claims. */
const SCAFFOLDED_EVERYWHERE: string[] = (() => {
  const maps = Object.values(SCAFFOLDER_SCRIPTS).map(cliScripts);
  const [first, ...rest] = maps;
  return [...first].filter((name) => rest.every((m) => m.has(name))).sort();
})();

// ─── The page readers ───────────────────────────────────────────────

/** `#### \`os <name>\`` down to the next one — the section a table belongs to. */
function commandSections(mdx: string): { command: string; body: string }[] {
  const hits = [...mdx.matchAll(/^#### `os ([^`\n]+)`[^\n]*$/gm)];
  return hits.map((hit, i) => ({
    command: hit[1].trim(),
    body: mdx.slice(hit.index + hit[0].length, i + 1 < hits.length ? hits[i + 1].index : mdx.length),
  }));
}

/** The `**Options.**` lead-in and its table rows, or null when the section has none. */
function optionsTable(body: string): { lead: string; rows: string[] } | null {
  const m = /^\*\*Options\.\*\*([^\n]*)\n\n\|[^\n]*\|\n\|[-:| ]+\|\n((?:\|[^\n]*\|\n)+)/m.exec(body);
  return m ? { lead: m[1], rows: m[2].trimEnd().split('\n') } : null;
}

/** The name each table row is ABOUT: the first word of its first backticked cell. */
function rowNames(rows: string[]): { flags: string[]; positionals: string[] } {
  const flags: string[] = [];
  const positionals: string[] = [];
  for (const row of rows) {
    const cell = row.replace(/^\|/, '').split('|')[0] ?? '';
    const code = /`([^`]+)`/.exec(cell);
    if (!code) continue;
    const name = code[1].trim().split(/\s+/)[0];
    (name.startsWith('--') ? flags : positionals).push(name);
  }
  return { flags: flags.sort(), positionals: positionals.sort() };
}

/** Number words this page spells out. A word outside the table is a refusal, not a zero. */
const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };

function spelledNumber(word: string, where: string): number {
  const n = NUMBER_WORDS[word.toLowerCase()];
  expect(n, `${PAGE_ID}: "${word}" in ${where} is not a number word this pin can read — add it to NUMBER_WORDS`).toBeDefined();
  return n;
}

/** The scaffolded-wiring callout, read off the page with its line wraps flattened. */
const CALLOUT = (() => {
  const flat = PAGE.replace(/\s+/g, ' ');
  const wired = /all (\w+) are wired as ((?:`npm run [\w:-]+`(?:, | and )?)+)/.exec(flat);
  const templates = /the (\w+) `os init` templates \(([^)]*)\)/.exec(flat);
  const eachDeclares = /each declare all (\w+) scripts/.exec(flat);
  return {
    flat,
    wiredCount: wired?.[1],
    wiredScripts: wired ? [...wired[2].matchAll(/`npm run ([\w:-]+)`/g)].map((m) => m[1]).sort() : null,
    templateCount: templates?.[1],
    templateNames: templates ? [...templates[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]).sort() : null,
    eachDeclaresCount: eachDeclares?.[1],
  };
})();

// ─── 1. The derivations are real before anything is compared ────────

describe('#17723 · the derived sets are non-empty, so nothing here can pass by reading nothing', () => {
  it('`os lint` declares flags and a positional', () => {
    expect(GOVERNED.lint.flags.length).toBeGreaterThan(0);
    expect(GOVERNED.lint.args.length).toBeGreaterThan(0);
  });

  it('the governed roster holds its floor', () => {
    for (const command of GOVERNED_FLOOR) {
      expect(
        Object.keys(GOVERNED),
        `\`os ${command}\` left the roster — #16892 measured its table at 4 of 11 flags, and the roster is what holds it`,
      ).toContain(command);
    }
  });

  it('every scaffolder declares CLI-invoking scripts, and some are common to all of them', () => {
    expect(Object.keys(SCAFFOLDER_SCRIPTS).length).toBeGreaterThan(1);
    for (const [name, scripts] of Object.entries(SCAFFOLDER_SCRIPTS)) {
      expect(cliScripts(scripts).size, `scaffolder \`${name}\` declares no script that runs the CLI`).toBeGreaterThan(0);
    }
    expect(SCAFFOLDED_EVERYWHERE.length).toBeGreaterThan(0);
  });

  it('the page still contains the two sections this pin reads', () => {
    expect(commandSections(PAGE).map((s) => s.command)).toContain('lint');
    expect(CALLOUT.wiredScripts, `${PAGE_ID}: the "all N are wired as \`npm run …\`" sentence is gone`).not.toBeNull();
    expect(CALLOUT.templateNames, `${PAGE_ID}: the "the N \`os init\` templates (…)" list is gone`).not.toBeNull();
  });
});

// ─── 2. Every documented options table is bound to a declaration ────

describe('#17723 · the `**Options.**` tables are held to the oclif declarations', () => {
  it('no command documents an options table this pin does not bind', () => {
    const unheld = commandSections(PAGE)
      .filter((s) => optionsTable(s.body) !== null)
      .map((s) => s.command)
      .filter((c) => !(c in GOVERNED));
    expect(
      unheld,
      `${PAGE_ID}: these sections promise "every flag the command declares" and nothing reads them: ${unheld.join(', ')}.\n`
        + '  Add the command to GOVERNED in this file — an enumeration nobody reads is how #16892 ② happened.',
    ).toEqual([]);
  });

  it.each(Object.keys(GOVERNED))('`os %s` documents an options table at all', (command) => {
    const section = commandSections(PAGE).find((s) => s.command === command);
    expect(section, `${PAGE_ID}: the \`#### \`os ${command}\`\` section is gone`).toBeDefined();
    const table = optionsTable(section!.body);
    expect(table, `${PAGE_ID}: \`os ${command}\` no longer carries an \`**Options.**\` table — the promise this pin holds is gone`).not.toBeNull();
    expect(rowNames(table!.rows).flags.length, `${PAGE_ID}: \`os ${command}\`'s options table names no flags`).toBeGreaterThan(0);
  });

  it.each(Object.keys(GOVERNED))('`os %s` documents exactly the flags and positionals it declares', (command) => {
    const declared = GOVERNED[command as keyof typeof GOVERNED];
    const table = optionsTable(commandSections(PAGE).find((s) => s.command === command)!.body)!;
    const documented = rowNames(table.rows);
    expect(
      documented,
      `${PAGE_ID}: \`os ${command}\`'s options table disagrees with its declaration in `
        + `packages/cli/src/commands/${command}.ts:\n`
        + `  declared but NOT documented: ${declared.flags.map((f) => `--${f}`).filter((f) => !documented.flags.includes(f)).join(', ') || '(none)'}\n`
        + `  documented but NOT declared: ${documented.flags.filter((f) => !declared.flags.map((d) => `--${d}`).includes(f)).join(', ') || '(none)'}\n`
        + `  positionals declared: ${declared.args.join(', ') || '(none)'} · documented: ${documented.positionals.join(', ') || '(none)'}`,
    ).toEqual({
      flags: declared.flags.map((f) => `--${f}`).sort(),
      positionals: [...declared.args].sort(),
    });
  });

  it.each(Object.keys(GOVERNED))('`os %s`\'s lead-in counts the positionals it really has', (command) => {
    const declared = GOVERNED[command as keyof typeof GOVERNED];
    const table = optionsTable(commandSections(PAGE).find((s) => s.command === command)!.body)!;
    const said = /its (\w+) positional/.exec(table.lead);
    expect(said, `${PAGE_ID}: \`os ${command}\`'s \`**Options.**\` lead-in no longer counts its positionals`).not.toBeNull();
    expect(
      spelledNumber(said![1], `\`os ${command}\`'s options lead-in`),
      `${PAGE_ID}: \`os ${command}\` says "${said![1]} positional" and declares ${declared.args.length}`,
    ).toBe(declared.args.length);
  });
});

// ─── 3. The scaffolded-wiring callout is held to the scaffolders ────

describe('#17723 · the scaffolded-wiring callout is held to the scaffolders', () => {
  it('names exactly the `os init` templates that exist', () => {
    expect(
      CALLOUT.templateNames,
      `${PAGE_ID}: the callout's \`os init\` template list disagrees with TEMPLATES in `
        + 'packages/cli/src/commands/init.ts — a template added there must be named here (#16350)',
    ).toEqual(Object.keys(TEMPLATES).sort());
  });

  it('counts those templates correctly', () => {
    expect(
      spelledNumber(CALLOUT.templateCount!, "the callout's `os init` template count"),
      `${PAGE_ID}: the callout says "${CALLOUT.templateCount}" \`os init\` templates and there are ${Object.keys(TEMPLATES).length}`,
    ).toBe(Object.keys(TEMPLATES).length);
  });

  it('still names the `create-objectstack` blank template as a scaffolder', () => {
    expect(
      CALLOUT.flat,
      `${PAGE_ID}: the callout stopped naming the \`create-objectstack\` blank template — it is the fourth scaffolder (#16350)`,
    ).toContain('`create-objectstack` blank template');
  });

  it('names exactly the CLI scripts every scaffolder declares', () => {
    expect(
      CALLOUT.wiredScripts,
      `${PAGE_ID}: the callout's \`npm run …\` list disagrees with what the scaffolders declare:\n`
        + `  declared by every scaffolder but NOT named: ${SCAFFOLDED_EVERYWHERE.filter((s) => !CALLOUT.wiredScripts!.includes(s)).join(', ') || '(none)'}\n`
        + `  named but NOT declared by every scaffolder: ${CALLOUT.wiredScripts!.filter((s) => !SCAFFOLDED_EVERYWHERE.includes(s)).join(', ') || '(none)'}\n`
        + '  Sources: TEMPLATES in packages/cli/src/commands/init.ts and packages/create-objectstack/src/templates/blank/package.json',
    ).toEqual(SCAFFOLDED_EVERYWHERE);
  });

  it('counts those scripts correctly in both sentences', () => {
    const n = SCAFFOLDED_EVERYWHERE.length;
    expect(
      spelledNumber(CALLOUT.wiredCount!, 'the callout\'s "all N are wired" sentence'),
      `${PAGE_ID}: the callout says "all ${CALLOUT.wiredCount} are wired" and ${n} scripts are`,
    ).toBe(n);
    expect(
      spelledNumber(CALLOUT.eachDeclaresCount!, 'the callout\'s "each declare all N scripts" sentence'),
      `${PAGE_ID}: the callout says "each declare all ${CALLOUT.eachDeclaresCount} scripts" and ${n} are declared`,
    ).toBe(n);
  });
});
