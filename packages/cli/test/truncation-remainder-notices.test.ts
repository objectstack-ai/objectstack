// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11642 — the truncating renders in `os build` / `os validate` / `os init`
 * that cut their list and said nothing about it.
 *
 * ## The population, and why it had to be re-derived
 *
 * The card listed eight sites, selected by grepping for `.slice(0, 50)`. That
 * literal answers "where does the number 50 appear", NOT "where is output
 * truncated in silence", and here the two differ in BOTH directions:
 *
 *   + `compile.ts`'s `--strict-body` refusal path caps at **20**, so no
 *     50-anchored sweep could see it — and it is byte-for-byte the shape the
 *     card already counts as a defect: the header states the true total, the
 *     body shows 20, nothing says the rest exist.
 *   - `compile.ts`'s `bodyExtractionWarnings` block also caps at 20 and is
 *     NOT a defect: it already prints `… and ${n - 20} more` plus a pointer
 *     at `--strict-body`. It is the in-repo PRECEDENT the rest now follow,
 *     and it is deliberately untouched — pinned below.
 *
 * So the defect is defined here as a *truncating render with no remainder
 * line*, and the sweep below looks for that rather than for any literal.
 *
 * ## The remedy is checked per site, not assumed
 *
 * #11529's notice ends by pointing at `--json` "for the full list", which is
 * honest only for a list `--json` actually carries. A notice whose remedy
 * does not work is worse than a silent cut: it sends the author down a path
 * that returns the same truncated view. Every site below was read against its
 * own `--json` payload, and `os init` — which declares no `--json` flag at
 * all — states its remainder with NO pointer. The fact that decision rests on
 * is pinned, so adding `--json` to `init` fails here rather than quietly
 * leaving a dead pointer behind.
 *
 * ## What the pins assert
 *
 * Rendered output, from both ends: over the cap the exact remainder is named;
 * at or under it NO such line appears. A printer that always printed a notice
 * would satisfy only the first half, so the controls carry as much weight as
 * the pins. Then, per site, that the command really routes its list through
 * such a printer — before the `this.exit(1)` that ends the run.
 *
 * ALTITUDE: the printers, not a spawned CLI — the precedent set by this
 * family's own `build-warning-truncation-notice.test.ts` (#11529) and by
 * `print-metadata-stats-zero-row.test.ts`. No child process, so nothing here
 * touches `check:cli-test-child-env`. The per-site half is a source read of
 * this same package (`../src/commands/*.ts`), which a rendered-output pin on
 * a shared printer cannot cover: a call whose output never reaches the
 * terminal renders green in isolation.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUTHORING_ADVISORY_PRINT_LIMIT,
  DIAGNOSTIC_PRINT_LIMIT,
  JSON_FULL_LIST_REMEDY,
  printAuthoringAdvisories,
  printAuthoringRuleErrors,
  printBulletList,
  printDocIssueErrors,
  printTruncationNotice,
  type AuthoringRuleFinding,
  type DocIssueRow,
} from '../src/utils/format.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const readCommand = (file: string) => readFileSync(resolve(HERE, '..', 'src', 'commands', file), 'utf8');

const SOURCES: Record<string, string> = {
  'compile.ts': readCommand('compile.ts'),
  'validate.ts': readCommand('validate.ts'),
  'init.ts': readCommand('init.ts'),
};

/** Drop SGR sequences so an assertion reads the words, not chalk's opinion. */
const stripAnsi = (s: string) => s.replace(/\u001B\[[0-9;]*m/g, '');

/** Run a printer and return everything it printed, as one string. */
function capture(run: () => void): string {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    run();
  } finally {
    console.log = original;
  }
  return stripAnsi(lines.join('\n'));
}

/** The notice, recognised by what makes it honest rather than by its wording. */
const NOTICE = /and (\d+) more .+ not shown \((\d+) of (\d+)\)/;

const finding = (i: number): AuthoringRuleFinding => ({
  where: `object "obj_${i}"`,
  message: `message ${i}`,
  rule: `rule-${i}`,
  path: `objects[${i}].sharingModel`,
  hint: `hint ${i}`,
});

const docIssue = (i: number): DocIssueRow => ({
  path: `src/docs/doc_${i}.md`,
  message: `message ${i}`,
  rule: `doc-rule-${i}`,
});

const many = <T>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const bullets = (n: number) => many(n, (i) => `line ${i}`);

describe('[#11642] the truncation notice itself — one sentence, one implementation', () => {
  it('OVER the cap: names the exact remainder and how many of how many were shown', () => {
    const out = capture(() =>
      printTruncationNotice({ total: 80, shown: 50, noun: 'widget(s)', remedy: 'do the thing' }),
    );
    expect(out).toMatch(NOTICE);
    expect(out).toContain('… and 30 more widget(s) not shown (50 of 80) — do the thing');
  });

  it('CONTROL — AT the cap: nothing is printed at all', () => {
    expect(capture(() => printTruncationNotice({ total: 50, shown: 50, noun: 'widget(s)' }))).toBe('');
  });

  it('CONTROL — UNDER the cap: nothing is printed at all', () => {
    expect(capture(() => printTruncationNotice({ total: 3, shown: 3, noun: 'widget(s)' }))).toBe('');
  });

  it('no remedy: the remainder is still stated, and no pointer is invented', () => {
    const out = capture(() => printTruncationNotice({ total: 80, shown: 50, noun: 'widget(s)', remedy: null }));
    expect(out).toContain('… and 30 more widget(s) not shown (50 of 80)');
    expect(out).not.toContain('—');
    expect(out).not.toContain('--json');
  });

  it('the shared cap and the shared pointer are the values these printers ship with', () => {
    // Literals on purpose: moving either has to be a deliberate edit here
    // rather than a silently-passing one.
    expect(DIAGNOSTIC_PRINT_LIMIT).toBe(50);
    expect(JSON_FULL_LIST_REMEDY).toBe('re-run with --json for the full list');
  });
});

describe('[#11642] printAuthoringRuleErrors — the gating rule failures', () => {
  it('OVER the cap: names the remainder and offers the remedy the caller supplied', () => {
    const out = capture(() => printAuthoringRuleErrors(many(80, finding), { remedy: JSON_FULL_LIST_REMEDY }));
    expect(out).toContain('and 30 more author-time rule failure(s) not shown (50 of 80)');
    expect(out).toContain('--json');
  });

  it('CONTROL — a list shorter than the cap prints no notice at all', () => {
    const out = capture(() => printAuthoringRuleErrors(many(3, finding), { remedy: JSON_FULL_LIST_REMEDY }));
    expect(out).not.toMatch(NOTICE);
    expect(out).not.toContain('not shown');
  });

  it('CONTROL — exactly AT the cap: every entry, still no notice', () => {
    const out = capture(() => printAuthoringRuleErrors(many(DIAGNOSTIC_PRINT_LIMIT, finding)));
    expect(out.split('\n').filter((l) => l.includes('rule: ')).length).toBe(50);
    expect(out).not.toMatch(NOTICE);
  });

  it('ONE over the cap: the notice reads exactly 1 — the tightest edge', () => {
    const out = capture(() => printAuthoringRuleErrors(many(11, finding), { limit: 10 }));
    expect(NOTICE.exec(out)?.[1]).toBe('1');
    expect(out).toContain('(10 of 11)');
  });

  it('CONTROL — the rows are unchanged: the notice adds, it does not replace', () => {
    const out = capture(() => printAuthoringRuleErrors(many(80, finding), { remedy: JSON_FULL_LIST_REMEDY }));
    expect(out).toContain('  • object "obj_0": message 0');
    expect(out).toContain('      hint 0');
    expect(out).toContain('      rule: rule-0  at objects[0].sharingModel');
    // The cap still caps: the 50th row is there and the 51st is not.
    expect(out).toContain('at objects[49].sharingModel');
    expect(out).not.toContain('at objects[50].sharingModel');
  });

  it('no remedy (the `os init` form): the remainder is named, no pointer is offered', () => {
    const out = capture(() => printAuthoringRuleErrors(many(80, finding), { remedy: null }));
    expect(out).toContain('and 30 more author-time rule failure(s) not shown (50 of 80)');
    expect(out).not.toContain('--json');
  });
});

describe('[#11642] printDocIssueErrors — the package-doc errors', () => {
  it('OVER the cap: names the remainder', () => {
    const out = capture(() => printDocIssueErrors(many(64, docIssue), { remedy: JSON_FULL_LIST_REMEDY }));
    expect(out).toContain('and 14 more package-doc error(s) not shown (50 of 64)');
    expect(out).toContain('--json');
  });

  it('CONTROL — a list shorter than the cap prints no notice, and every row', () => {
    const out = capture(() => printDocIssueErrors(many(4, docIssue)));
    expect(out).not.toMatch(NOTICE);
    expect(out).toContain('  • src/docs/doc_3.md: message 3');
    expect(out).toContain('      rule: doc-rule-3');
  });
});

describe('[#11642] printBulletList — the string diagnostics', () => {
  it('OVER the cap: names the remainder with the caller-supplied noun', () => {
    const out = capture(() =>
      printBulletList(bullets(75), { noun: 'undeclared authoring key(s)', remedy: JSON_FULL_LIST_REMEDY }),
    );
    expect(out).toContain('and 25 more undeclared authoring key(s) not shown (50 of 75)');
  });

  it('respects a cap other than 50 — the `--strict-body` site caps at 20', () => {
    const out = capture(() => printBulletList(bullets(31), { noun: 'callable(s)', limit: 20 }));
    expect(out).toContain('and 11 more callable(s) not shown (20 of 31)');
    expect(out).toContain('  • line 19');
    expect(out).not.toContain('  • line 20');
  });

  it('CONTROL — a list shorter than the cap prints no notice at all', () => {
    const out = capture(() => printBulletList(bullets(7), { noun: 'callable(s)', limit: 20 }));
    expect(out).not.toMatch(NOTICE);
    expect(out.split('\n').length).toBe(7);
  });

  it('CONTROL — an empty list prints nothing, not an empty notice', () => {
    expect(capture(() => printBulletList([], { noun: 'callable(s)' }))).toBe('');
  });
});

describe('[#11642] printAuthoringAdvisories keeps #11529 output and gains the no-pointer form', () => {
  it('the default is unchanged — remainder plus the --json pointer', () => {
    const out = capture(() => printAuthoringAdvisories(many(80, finding)));
    expect(out).toContain(
      '… and 30 more author-time warning(s) not shown (50 of 80) — re-run with --json for the full list',
    );
  });

  it('remedy `null` (what `os init` passes): remainder named, pointer withheld', () => {
    const out = capture(() => printAuthoringAdvisories(many(80, finding), AUTHORING_ADVISORY_PRINT_LIMIT, null));
    expect(out).toContain('… and 30 more author-time warning(s) not shown (50 of 80)');
    expect(out).not.toContain('--json');
  });
});

// ─── Per-site wiring ────────────────────────────────────────────────
//
// A rendered-output pin on a shared printer stays green against a call whose
// output never reaches the terminal — or against a site that still runs its
// own capped loop beside the printer. These read the commands themselves.

interface Site {
  file: string;
  /** Text independently known present at the site — the instrument's positive control. */
  anchor: string;
  /** The list expression whose silent `.slice` had to go. */
  list: string;
  /** The remainder-naming call the site now consists of. */
  call: string;
  /** Does the block end the run? Then the call must precede that exit. */
  exits: boolean;
}

const SITES: Site[] = [
  {
    file: 'compile.ts',
    anchor: '`--strict-body: ${issues.length} callable(s) lack a metadata body`',
    list: 'issues',
    call: "{ noun: 'callable(s)', limit: 20, remedy: JSON_FULL_LIST_REMEDY }",
    exits: true,
  },
  {
    file: 'compile.ts',
    anchor: 'printError(`Author-time rules failed (',
    list: 'ruleErrors',
    call: 'printAuthoringRuleErrors(ruleErrors, { remedy: JSON_FULL_LIST_REMEDY });',
    exits: true,
  },
  {
    file: 'compile.ts',
    anchor: 'printWarning(`Undeclared authoring keys (',
    list: 'unknownKeyWarnings',
    call: 'printBulletList(unknownKeyWarnings, {',
    exits: false,
  },
  {
    file: 'compile.ts',
    anchor: 'printError(`Access matrix drift (',
    list: 'drift',
    call: 'printBulletList(drift, {',
    exits: true,
  },
  {
    file: 'compile.ts',
    anchor: 'printError(`Package docs validation failed (',
    list: 'docErrors',
    call: 'printDocIssueErrors(docErrors, { remedy: JSON_FULL_LIST_REMEDY });',
    exits: true,
  },
  {
    file: 'validate.ts',
    anchor: 'printError(`Author-time rules failed (',
    list: 'ruleErrors',
    call: 'printAuthoringRuleErrors(ruleErrors, { remedy: JSON_FULL_LIST_REMEDY });',
    exits: true,
  },
  {
    file: 'validate.ts',
    anchor: 'printError(`Package docs validation failed (',
    list: 'docErrors',
    call: 'printDocIssueErrors(docErrors, { remedy: JSON_FULL_LIST_REMEDY });',
    exits: true,
  },
  {
    file: 'init.ts',
    anchor: "printStep('Validating scaffold...')",
    list: 'report.advisories',
    call: 'printAuthoringAdvisories(report.advisories, AUTHORING_ADVISORY_PRINT_LIMIT, null);',
    exits: false,
  },
  {
    file: 'init.ts',
    anchor: '`Scaffold validation failed: author-time rules rejected the generated project (',
    list: 'report.errors',
    call: 'printAuthoringRuleErrors(report.errors, { remedy: null });',
    exits: false,
  },
];

describe('[#11642] every re-derived site routes its list through a remainder-naming printer', () => {
  it.each(SITES)('$file — $list', (site) => {
    const src = SOURCES[site.file];

    // Positive control FIRST: the instrument is shown finding something in
    // this file before any absence below is read as evidence. Deliberately
    // not a substring of the term under test.
    expect(src).toContain(site.anchor);

    // The silent cut is gone.
    expect(src).not.toContain(`${site.list}.slice(0,`);

    // …and the site consists of a printer that names what it withheld.
    expect(src).toContain(site.call);

    const iAnchor = src.indexOf(site.anchor);
    const iCall = src.indexOf(site.call);
    expect(iCall).toBeGreaterThan(iAnchor);

    if (site.exits) {
      // A notice is worthless printed after the process has been told to
      // leave: oclif's `this.exit(1)` throws, so anything below it is dead.
      const iExit = src.indexOf('this.exit(1)', iCall);
      expect(iExit).toBeGreaterThan(iCall);
    }
  });
});

describe('[#11642] no capped render is left silent in the three printers', () => {
  /** `for (const x of <list>.slice(0, N))` — the shape of a truncating render. */
  const CAPPED = /for \(const \w+ of ([\w.[\]]+)\.slice\(0, (\d+)\)\)/g;
  /** Any construct that tells the reader a remainder exists. */
  const NAMES_REMAINDER = /… and |not shown|printTruncationNotice/;

  it('the only capped for-of left is the PRECEDENT, and it names its own remainder', () => {
    const remaining: string[] = [];
    for (const [file, src] of Object.entries(SOURCES)) {
      const lines = src.split('\n');
      for (const m of src.matchAll(CAPPED)) {
        const line = src.slice(0, m.index).split('\n').length - 1;
        const window = lines.slice(line, line + 8).join('\n');
        remaining.push(`${file}:${line + 1} ${m[1]}`);
        expect(window, `${file}:${line + 1} truncates ${m[1]} with no remainder line`).toMatch(NAMES_REMAINDER);
      }
    }
    expect(remaining).toEqual([expect.stringContaining('lowering.bodyExtractionWarnings')]);
  });

  it('the precedent is untouched, byte for byte', () => {
    // This block was NOT a sibling defect and was explicitly out of scope: it
    // already prints a remainder AND points at the complete-output path. It
    // is the shape everything above copies, so a change to it is a change to
    // the standard.
    expect(SOURCES['compile.ts']).toContain(
      'if (n > 20) console.log(chalk.dim(`  … and ${n - 20} more`));',
    );
    expect(SOURCES['compile.ts']).toContain(
      "console.log(chalk.dim('    → run `os build --strict-body` for the full diagnostic, or to make this fatal'));",
    );
  });
});

describe('[#11642] a pointer is only offered where it resolves', () => {
  it('`os init` has no --json face, so neither of its notices names one', () => {
    // Positive control on the same instrument: the two commands that DO
    // declare the flag are found by this exact pattern.
    const DECLARES_JSON = /json: Flags\.boolean\(/;
    expect(SOURCES['compile.ts']).toMatch(DECLARES_JSON);
    expect(SOURCES['validate.ts']).toMatch(DECLARES_JSON);

    expect(SOURCES['init.ts']).not.toMatch(DECLARES_JSON);
    expect(SOURCES['init.ts']).not.toContain('JSON_FULL_LIST_REMEDY');
  });

  it('every --json pointer in build/validate sits at an exit whose payload carries that list', () => {
    // Read off the payloads once, so the claim is checkable rather than
    // asserted in prose: the key each list is published under, on the very
    // exit whose text face carries the notice.
    const carried: Array<[string, string]> = [
      ['compile.ts', "error: 'strict-body: missing body', issues }"],
      ['compile.ts', "error: 'author-time rules failed', issues: ruleErrors"],
      ['compile.ts', "error: 'access matrix drift', changes: drift"],
      ['compile.ts', "error: 'docs validation failed', issues: docErrors"],
      // [#11727] Spelling updated, claim unchanged — and the claim got
      // STRONGER: the success payload still publishes the advisory list this
      // notice points at, and now publishes more of it. The #3366 capability
      // hints and the ADR-0046 doc advisories joined the two already here, so
      // "re-run with `--json` for the full list" resolves for four lists
      // rather than two.
      ['compile.ts', 'warnings: [...ruleAdvisories, ...docWarnings, ...unknownKeyWarnings, ...capProviderWarnings],'],
      ['validate.ts', 'errors: ruleErrors,'],
      ['validate.ts', 'errors: docErrors,'],
    ];
    for (const [file, payload] of carried) {
      expect(SOURCES[file], `${file} no longer publishes ${payload}`).toContain(payload);
    }
  });
});
