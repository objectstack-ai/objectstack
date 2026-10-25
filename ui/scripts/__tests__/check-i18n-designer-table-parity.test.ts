import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  analysePairs,
  DESIGNER_PAIR_CONSTS,
  DESIGNER_TABLE,
  placeholdersOf,
  readDesignerPairs,
  ZH_ONLY_FAMILIES,
} from '../check-i18n-designer-table-parity.mjs';
import { DESIGNER_TABLE_CONSTS } from '../check-i18n-dead-keys.mjs';

/**
 * objectui#8834 — the behaviour test for
 * `scripts/check-i18n-designer-table-parity.mjs`.
 *
 * The gate answers a question no other i18n guard in this repo can: the
 * metadata-admin designer's own module-local tables must stay paired. The two
 * shipped i18n gates are blind to that file BY CONSTRUCTION and the dead-keys
 * sweep, which does read it, asks about DEAD keys over the UNION of both halves
 * — so a one-sided key is not a subject to it at all.
 *
 * ## What is pinned here, and what deliberately is not
 *
 * The ENFORCED legs are pinned twice: as pure functions over fixture tables,
 * and end-to-end through the real CLI over a throwaway repo, so the exit code
 * itself is observed and not inferred. A gate that has never been observed red
 * is indistinguishable from one that cannot go red, which is the disease this
 * card exists to cure.
 *
 * There is NO pin here on a real-repo key COUNT. Counts move whenever anyone
 * adds a string, and a pin on one would red an unrelated PR — the same
 * reasoning `check-i18n-dead-keys.test.ts` states for its own corpus. What IS
 * asserted about the real tree is the VERDICT (this gate is green today) and
 * the shape of the instrument, both of which are stable under routine authoring.
 */

const tempRoots: string[] = [];
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GATE = path.join(repoRoot, 'scripts/check-i18n-designer-table-parity.mjs');

afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

/** Materialises a throwaway repo holding just the designer table. */
function repoWithTable(contents: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-i18n-designer-parity-'));
  tempRoots.push(root);
  const full = path.join(root, DESIGNER_TABLE);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return root;
}

/** `execFileSync` throws on a non-zero exit, and the exit code is the whole
 *  point here, so the throw is caught and unpacked rather than avoided. */
function runGateExpectingAnyExit(root: string, minKeys = 1): { status: number; output: string } {
  // `--min-keys` exactly once: the CLI's `argOf` takes the FIRST occurrence, so
  // a second one is silently ignored — which is how the collapse-guard case
  // below first passed while measuring nothing.
  try {
    const out = execFileSync(process.execPath, [GATE, '--root', root, '--min-keys', String(minKeys)], {
      encoding: 'utf8',
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

/** A fixture table carrying one row of every shape the legs must judge.
 *  `engine.fx.*` is used so no assertion here spells a key the real table
 *  declares. */
const FIXTURE = `
const ENGINE_STRINGS_EN: Record<string, string> = {
  'engine.fx.shared': 'Shared',
  'engine.fx.withPlaceholder': 'Found {count} of {total}',
};

const ENGINE_STRINGS_ZH: Record<string, string> = {
  'engine.fx.shared': '共享',
  'engine.fx.withPlaceholder': '共 {count} 项,合计 {total}',
  'engine.flowNode.probe.label': '族内单边键',
  'engine.fx.residue': '族外单边键',
};

const TYPE_LABELS_EN: Record<string, string> = { object: 'Object' };
const TYPE_LABELS_ZH: Record<string, string> = { object: '对象' };
const DOMAIN_LABELS_EN: Record<string, string> = { data: 'Data' };
const DOMAIN_LABELS_ZH: Record<string, string> = { data: '数据' };
`;

const tablesOf = (contents: string) => readDesignerPairs(repoWithTable(contents));

describe('the enforced half — en is a subset of zh', () => {
  it('is green when every en row has a zh row, one-sided zh rows notwithstanding', () => {
    const result = analysePairs(tablesOf(FIXTURE));
    expect(result.missingZh).toEqual([]);
    expect(result.placeholders).toEqual([]);
  });

  it('names an en key with no zh row, and says which table it is in', () => {
    const result = analysePairs(
      tablesOf(FIXTURE.replace("  'engine.fx.shared': 'Shared',", "  'engine.fx.shared': 'Shared',\n  'engine.fx.enOnly': 'No zh row',")),
    );
    expect(result.missingZh).toEqual([{ pair: 'ENGINE_STRINGS', key: 'engine.fx.enOnly' }]);
  });

  it('judges every pair in the list, not just the first', () => {
    // The pair list is the gate's shape; a bug that read only pairs[0] would
    // still pass every assertion above.
    const result = analysePairs(tablesOf(FIXTURE.replace("const TYPE_LABELS_ZH: Record<string, string> = { object: '对象' };", 'const TYPE_LABELS_ZH: Record<string, string> = {};')));
    expect(result.missingZh).toEqual([{ pair: 'TYPE_LABELS', key: 'object' }]);
  });
});

describe('the enforced half — placeholder parity over shared keys', () => {
  it('names the key AND the placeholder the zh value dropped', () => {
    const result = analysePairs(
      tablesOf(FIXTURE.replace("'共 {count} 项,合计 {total}'", "'共若干项,合计 {total}'")),
    );
    expect(result.placeholders).toHaveLength(1);
    expect(result.placeholders[0]).toMatchObject({
      pair: 'ENGINE_STRINGS',
      key: 'engine.fx.withPlaceholder',
      missing: ['count'],
      extra: [],
    });
  });

  it('names a placeholder that only the zh value carries', () => {
    const result = analysePairs(tablesOf(FIXTURE.replace("'Found {count} of {total}'", "'Found {count}'")));
    expect(result.placeholders[0]).toMatchObject({ missing: [], extra: ['total'] });
  });

  it('does not care about order, repetition, or the surrounding sentence', () => {
    // The values SHOULD differ — one side is English. Only the token SET is the
    // subject, and a translation is free to reorder or repeat the tokens.
    const result = analysePairs(
      tablesOf(FIXTURE.replace("'共 {count} 项,合计 {total}'", "'{total} 中的 {count} 项({count} 已选)'")),
    );
    expect(result.placeholders).toEqual([]);
  });

  it("reads placeholders with tFormat()'s own regex", () => {
    // `\\w+` only: `{a-b}` and `{ count }` are not substituted at runtime, so
    // reporting them would be reporting something the runtime never does.
    expect(placeholdersOf('a {count} b {total} c {count}')).toEqual(['count', 'total']);
    expect(placeholdersOf('{a-b} { count } {}')).toEqual([]);
  });
});

describe('the reported half — zh-only keys, minus the documented families', () => {
  it('subtracts a zh-only key that falls inside a documented family', () => {
    const result = analysePairs(tablesOf(FIXTURE));
    expect(result.familyCounts['engine.flowNode.']).toBe(1);
    expect(result.unexplainedZhOnly.map((entry) => entry.key)).not.toContain('engine.flowNode.probe.label');
  });

  it('lists a zh-only key that falls outside every family', () => {
    const result = analysePairs(tablesOf(FIXTURE));
    expect(result.unexplainedZhOnly).toEqual([{ pair: 'ENGINE_STRINGS', key: 'engine.fx.residue' }]);
  });

  it('never lets the report change the verdict — both directions', () => {
    // The whole reason the families may be PREFIXES. A prefix in a report costs
    // one missing line if it is wrong; a prefix in an exemption ledger silently
    // disables the gate for a whole family, the wide-head hazard
    // check-i18n-dead-keys.mjs reasons about at MIN_HEAD_SEGMENTS.
    const withResidue = analysePairs(tablesOf(FIXTURE));
    expect(withResidue.unexplainedZhOnly).toHaveLength(1);
    expect(withResidue.missingZh).toEqual([]);
    expect(runGateExpectingAnyExit(repoWithTable(FIXTURE)).status).toBe(0);
  });
});

describe('the documented zh-only families', () => {
  it('every entry carries a reason and an in-file citation', () => {
    // Ruled by objectui#8834: an entry with no citation is not admissible. The
    // reason a family is one-sided is a fact about a CONSUMER, and a claim about
    // a consumer that names no consumer is an assertion.
    expect(ZH_ONLY_FAMILIES.length).toBeGreaterThan(0);
    for (const family of ZH_ONLY_FAMILIES) {
      expect(family.prefix, 'a family must be a prefix').toMatch(/\.$/);
      expect(family.reason.trim().length, `${family.prefix} has no reason`).toBeGreaterThan(20);
      expect(family.citation, `${family.prefix} has no citation`).toBeTruthy();
      expect(family.citation.file, `${family.prefix} cites no file`).toMatch(/^[\w./-]+$/);
      expect(
        family.citation.anchor.trim().length,
        `${family.prefix} cites no anchor text`,
      ).toBeGreaterThan(8);
      // objectui#8875 clause 3: the citation used to be `path:line`, a STORED
      // line number pointing into another file. It was one unrelated edit away
      // from naming the wrong line, and nothing here ever followed it, so the
      // drift would have been silent. An anchor is text, so it can be CHECKED —
      // which the next assertion does.
      expect(
        `${family.citation.file} ${family.citation.anchor}`,
        `${family.prefix} still cites a line address`,
      ).not.toMatch(/\.[A-Za-z]+:\d+/);
    }
  });

  it('every citation resolves: the file exists and the anchor text is in it, exactly once', () => {
    for (const family of ZH_ONLY_FAMILIES) {
      const full = path.join(repoRoot, family.citation.file);
      expect(fs.existsSync(full), `${family.citation.file} names no file`).toBe(true);

      const source = fs.readFileSync(full, 'utf8');
      const occurrences = source.split(family.citation.anchor).length - 1;
      expect(
        occurrences,
        `${family.prefix} cites "${family.citation.anchor}" in ${family.citation.file}, which ` +
          `contains it ${occurrences} time(s). A citation that locates nothing — or several ` +
          `things — is the failure objectui#8875 retired the line numbers for; it is not fixed ` +
          `by writing a number back.`,
      ).toBe(1);
    }

    // Anti-vacuity: the same reader, on a string that is deliberately absent,
    // must return zero. Without it a broken read would agree with every anchor.
    const control = fs.readFileSync(
      path.join(repoRoot, ZH_ONLY_FAMILIES[0].citation.file),
      'utf8',
    );
    expect(control.includes('zzz-this-anchor-does-not-exist')).toBe(false);
  });

  it('every family still subtracts at least one real key', () => {
    // A family that explains nothing is dead weight in a report that exists to
    // be read. Deleting the entry is the fix, not raising a ceiling.
    const result = analysePairs(readDesignerPairs(repoRoot));
    for (const family of ZH_ONLY_FAMILIES) {
      expect(result.familyCounts[family.prefix], `${family.prefix} explains nothing`).toBeGreaterThan(0);
    }
  });
});

describe('the pair list is the gate’s own, not the dead-keys sweep’s', () => {
  it('does not reuse DESIGNER_TABLE_CONSTS', () => {
    // Widening that constant to reach TYPE_LABELS_* / DOMAIN_LABELS_* would
    // change what the DEAD-KEYS gate sweeps, as a side effect nobody asked for:
    // its companion DESIGNER_KEY_ROOTS (`engine.`/`designer.`/`perm.`) does not
    // cover bare identifier keys such as `object` and `data`.
    expect(DESIGNER_PAIR_CONSTS).not.toEqual(DESIGNER_TABLE_CONSTS);
    expect(DESIGNER_PAIR_CONSTS.length).toBeGreaterThan(DESIGNER_TABLE_CONSTS.length);
    for (const name of DESIGNER_TABLE_CONSTS) expect(DESIGNER_PAIR_CONSTS).toContain(name);
  });

  it('names constants that really exist in the real table', () => {
    const tables = readDesignerPairs(repoRoot);
    for (const name of DESIGNER_PAIR_CONSTS) {
      expect(tables.get(name), `${name} is not in ${DESIGNER_TABLE}`).toBeDefined();
      expect(tables.get(name)!.size).toBeGreaterThan(0);
    }
  });
});

describe('the real tree', () => {
  it('is green: every en row has a zh row and every shared row keeps its placeholders', () => {
    const result = analysePairs(readDesignerPairs(repoRoot));
    expect(result.missingZh).toEqual([]);
    expect(result.placeholders).toEqual([]);
  });

  it('has every zh-only key explained by a documented family', () => {
    // Not a gate — the residue is report-only — but a green residue today is
    // what makes a NEW entry in it mean something to a reader tomorrow.
    const result = analysePairs(readDesignerPairs(repoRoot));
    expect(result.unexplainedZhOnly).toEqual([]);
  });
});

describe('the CLI, end to end', () => {
  it('exits 0 and prints the subtraction when the tables are paired', () => {
    const run = runGateExpectingAnyExit(repoWithTable(FIXTURE));
    expect(run.status).toBe(0);
    expect(run.output).toContain('report only');
    expect(run.output).toContain('engine.flowNode.');
  });

  it('exits 1 and names the en key that has no zh row', () => {
    const root = repoWithTable(FIXTURE.replace("  'engine.fx.shared': 'Shared',", "  'engine.fx.shared': 'Shared',\n  'engine.fx.enOnly': 'No zh row',"));
    const run = runGateExpectingAnyExit(root);
    expect(run.status).toBe(1);
    expect(run.output).toContain('engine.fx.enOnly');
  });

  it('exits 1 and names the dropped placeholder', () => {
    const root = repoWithTable(FIXTURE.replace("'共 {count} 项,合计 {total}'", "'共若干项,合计 {total}'"));
    const run = runGateExpectingAnyExit(root);
    expect(run.status).toBe(1);
    expect(run.output).toContain('engine.fx.withPlaceholder');
    expect(run.output).toContain('MISSING from zh: {count}');
  });

  it('fails loudly rather than passing when the scan collapses', () => {
    // Over an empty corpus every assertion above is trivially satisfied, so a
    // refactor that stopped reading the tables would report a confident green.
    // Same guard, same reason, as check-i18n-en-drift.mjs's --min-keys.
    const run = runGateExpectingAnyExit(repoWithTable(FIXTURE), 9999);
    expect(run.status).toBe(1);
    expect(run.output).toContain('The scan collapsed');
  });

  it('throws rather than sweeping an empty corpus when a table constant is gone', () => {
    const root = repoWithTable(FIXTURE.replace('const ENGINE_STRINGS_ZH', 'const RENAMED_STRINGS_ZH'));
    const run = runGateExpectingAnyExit(root);
    expect(run.status).not.toBe(0);
    expect(run.output).toContain('the extractor is stale');
  });
});

describe('the gate is wired to run', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

  it('package.json exposes it as a named script', () => {
    expect(pkg.scripts['check:i18n-designer-parity']).toBe('node scripts/check-i18n-designer-table-parity.mjs');
  });

  it('ci.yml runs it after the install it needs (it imports typescript)', () => {
    // The whole reason this is a NEW script rather than a leg of
    // check-i18n-dead-keys.mjs: that one is invoked in no workflow at all, by
    // design ("This is a REPORT, not a gate"), so a leg there could never be
    // observed red in CI — the disease objectui#8834 exists to cure.
    const install = ci.indexOf('pnpm install --frozen-lockfile');
    const step = ci.indexOf('run: pnpm check:i18n-designer-parity');
    expect(step, 'ci.yml does not run `pnpm check:i18n-designer-parity`').toBeGreaterThan(-1);
    expect(step, 'the check runs before dependencies are installed').toBeGreaterThan(install);
  });

  it('is not hidden from the designer table by ci.yml path filters', () => {
    // Same reasoning as check-i18n-en-drift.test.ts's twin assertion: an ignore
    // entry that covered `packages/` would make this gate unreachable for
    // exactly the PRs it judges.
    const ignored = ci.slice(0, ci.indexOf('jobs:')).match(/^\s+- '.*'$/gm) ?? [];
    for (const pattern of ignored) expect(pattern).not.toMatch(/packages|scripts/);
    expect(ignored.length).toBeGreaterThan(0);
  });
});
