import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  analyze,
  applyLedger,
  checkLedger,
  findDrift,
  FOLLOWERS,
  ISSUE_PATTERN,
  LEDGER_PATH,
  LOCALES,
  packPath,
  parsePack,
  readLedger,
  readPacks,
  resolveBaseRef,
  analyzeDesigner,
  DESIGNER_FOLLOWERS,
  designerPopulation,
  readDesignerTables,
} from '../check-i18n-en-drift.mjs';
import { DESIGNER_TABLE } from '../check-i18n-designer-table-parity.mjs';

/**
 * objectui#3650 — the behaviour test for `scripts/check-i18n-en-drift.mjs`.
 *
 * The gate answers "did the nine translation packs follow the `en` string this
 * PR changed?", which no other i18n guard in this repo can: parity compares KEY
 * SETS, the call-site guard checks that a key EXISTS, and both were green
 * through objectui#3582 and objectui#3625 — eight packs serving a retired
 * sentence, the second time as idiomatic native-script translations that every
 * value-shaped heuristic also reads as healthy.
 *
 * ## Why this suite is built out of implanted commits
 *
 * The gate cannot be validated against this repo's history: the ten packs
 * arrived whole at 30ac2e1ee ALREADY carrying both drifts (`en` said "read-only"
 * and `ja` said the duplicate-to-customize sentence at that very commit), and
 * across all 21 commits that have touched `en.ts` since, exactly one changed an
 * `en` value and all nine packs followed it. A replay is therefore green
 * everywhere, and a green replay is not evidence.
 *
 * So the corpus below is planted. `reconstructed3625()` rebuilds the commit that
 * must have existed — the real sentences, the real eight packs — inside a
 * throwaway git repo, and the CLI tests drive the real script over real git
 * plumbing to pin exit codes rather than internal shapes. When this suite is
 * green, what has been measured is that the gate reddens on the defect it was
 * written for and stays green on the shape that is fine.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const gateScript = path.join(repoRoot, 'scripts/check-i18n-en-drift.mjs');
const tempRoots: string[] = [];

/**
 * The real `en` pack, read the way its consumers read it: evaluated by the
 * module loader, not parsed.
 *
 * A COMPUTED dynamic import on purpose. A static specifier would pull a
 * 3.2k-line package source into `tsconfig.scripts.json`'s program, and that
 * project's position in `ci.yml` rests on the premise that it reads nothing
 * outside `scripts/` — pinned by `scripts-type-check.test.ts`, whose AST walk
 * reports only workspace-package specifiers and would not have caught a
 * relative one.
 * `check-i18n-call-site-keys.test.ts` reads the same pack the same way, for the
 * same reason.
 */
const realEn: unknown = (
  await import(pathToFileURL(path.join(repoRoot, 'packages/i18n/src/locales/en.ts')).href)
).default;

/** `dotted key -> value` for a plain object — the shape the gate parses out of source. */
function leafValues(node: unknown, prefix = '', into = new Map<string, unknown>()): Map<string, unknown> {
  if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      leafValues(value, prefix ? `${prefix}.${key}` : key, into);
    }
  } else {
    into.set(prefix, node);
  }
  return into;
}

// -- fixture packs ------------------------------------------------------------

type Nested = { [key: string]: string | Nested };

/** A pack module source, the way the real ones are written. */
function packSource(lang: string, tree: Nested): string {
  const render = (node: Nested, indent: string): string =>
    Object.entries(node)
      .map(([key, value]) =>
        typeof value === 'string'
          ? `${indent}${key}: ${JSON.stringify(value)},`
          : `${indent}${key}: {\n${render(value, `${indent}  `)}\n${indent}},`,
      )
      .join('\n');
  return `const ${lang} = {\n${render(tree, '  ')}\n} as const;\n\nexport default ${lang};\n`;
}

/**
 * The designer table's source, from one `key -> value` map per side.
 *
 * All six constants the pair list names are emitted: the head side of the
 * designer population reads them with `require: true`, so a table missing one
 * is a stale extractor and must throw rather than sweep an empty corpus.
 */
function designerSource(en: Record<string, string>, zh: Record<string, string>): string {
  const rows = (table: Record<string, string>) =>
    Object.entries(table)
      .map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`)
      .join('\n');
  return (
    `const ENGINE_STRINGS_EN: Record<string, string> = {\n${rows(en)}\n};\n\n` +
    `const ENGINE_STRINGS_ZH: Record<string, string> = {\n${rows(zh)}\n};\n\n` +
    "const TYPE_LABELS_EN: Record<string, string> = { object: 'Object' };\n" +
    "const TYPE_LABELS_ZH: Record<string, string> = { object: '\u5bf9\u8c61' };\n" +
    "const DOMAIN_LABELS_EN: Record<string, string> = { data: 'Data' };\n" +
    "const DOMAIN_LABELS_ZH: Record<string, string> = { data: '\u6570\u636e' };\n"
  );
}

/** The designer table every fixture repo carries unless a test varies it. */
const DESIGNER_DEFAULT = designerSource({ 'engine.fx.a': 'A' }, { 'engine.fx.a': '\u7532' });

/**
 * Ten packs from one `lang -> tree` map, PLUS the designer table (objectui#8834).
 *
 * The designer table is not optional in a fixture repo. Since that second
 * population landed, the gate reads `i18n.ts` on both sides of every run, so a
 * fixture repo without one would fail every CLI test on a missing file instead
 * of on the thing the test is about. `designer` varies it for the tests that
 * are ABOUT the designer population.
 */
function packFiles(trees: Record<string, Nested>, designer: string = DESIGNER_DEFAULT): Record<string, string> {
  return {
    ...Object.fromEntries(LOCALES.map((lang) => [packPath(lang), packSource(lang, trees[lang])])),
    [DESIGNER_TABLE]: designer,
  };
}

/** `lang -> tree` for all ten locales, built per locale. */
function treesFor(make: (lang: string) => Nested): Record<string, Nested> {
  return Object.fromEntries(LOCALES.map((lang): [string, Nested] => [lang, make(lang)]));
}

/**
 * Fixture packs hold ten keys, not thousands, so the gate's anti-empty-comparison
 * floor has to be lowered for them. CI never passes this — the default (2000) is
 * the number that guards the real packs, and one test below drives the CLI
 * WITHOUT this flag precisely to prove the floor still fires.
 */
const FIXTURE_FLOOR = ['--min-keys', '1', '--min-designer-keys', '1'];

/** A throwaway git repo. `commits` are applied in order, each one committed. */
function repoWithCommits(commits: Array<Record<string, string>>): { root: string; shas: string[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-i18n-en-drift-'));
  tempRoots.push(root);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'gate@example.test');
  git('config', 'user.name', 'gate');

  const shas: string[] = [];
  for (const files of commits) {
    for (const [rel, contents] of Object.entries(files)) {
      const full = path.join(root, rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, contents);
    }
    git('add', '-A', '-f');
    git('commit', '-q', '-m', `commit ${shas.length + 1}`);
    shas.push(git('rev-parse', 'HEAD'));
  }
  return { root, shas };
}

/**
 * Runs the real gate as CI runs it. Returns the exit code and the merged output.
 *
 * `envOverrides` re-supplies one of the two vars the gate reads, for the tests
 * that are ABOUT those vars; everything else keeps them cleared.
 */
function runGate(
  root: string,
  args: string[],
  envOverrides: Record<string, string> = {},
): { code: number; output: string } {
  const result = execFileSync(
    process.execPath,
    [gateScript, '--root', root, ...args],
    // The two env vars the gate reads are cleared: on a real CI run they name
    // THIS repo's branches, and a fixture repo must not be judged against them.
    {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, OS_I18N_DRIFT_BASE: '', GITHUB_BASE_REF: '', ...envOverrides },
    },
    // `execFileSync` throws on a non-zero exit; the status and both streams are
    // on the error, so the two paths are unified here rather than at each site.
  );
  return { code: 0, output: result };
}

function runGateExpectingFailure(
  root: string,
  args: string[],
  envOverrides: Record<string, string> = {},
): { code: number; output: string } {
  try {
    runGate(root, args, envOverrides);
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, output: `${failure.stdout}${failure.stderr}` };
  }
  throw new Error('the gate exited 0 where a failure was expected');
}

// -- the objectui#3625 commit, reconstructed ----------------------------------

/**
 * The two sentences at the centre of objectui#3582 and objectui#3625, verbatim
 * from those issues. `en` moves to the read-only wording; the eight packs keep
 * their translations of the retired duplicate-to-customize wording. `zh` follows
 * `en`, as it really did.
 */
const RETIRED: Record<string, string> = {
  en: 'System view — duplicate to customize.',
  zh: '系统视图 — 复制一份来自定义。',
  ja: 'システムビュー — 複製してカスタマイズしてください。',
  ko: '시스템 보기 — 사용자 지정하려면 복제하세요.',
  de: 'Systemansicht — zum Anpassen duplizieren.',
  fr: 'Vue système — dupliquer pour personnaliser.',
  es: 'Vista del sistema — duplique para personalizar.',
  pt: 'Exibição do sistema — duplique para personalizar.',
  ru: 'Системное представление — скопируйте для настройки.',
  ar: 'عرض النظام — انسخ للتخصيص.',
};
const EN_READONLY = 'System view — defined in code, read-only.';
const ZH_READONLY = '系统视图 — 由代码定义，只读。';

function reconstructed3625(): { root: string; base: string; head: string } {
  const before = packFiles(
    treesFor((lang) => ({ view: { readonlyTooltip: RETIRED[lang] }, common: { save: `save-${lang}` } })),
  );
  const after = {
    ...before,
    [packPath('en')]: packSource('en', {
      view: { readonlyTooltip: EN_READONLY },
      common: { save: 'save-en' },
    }),
    [packPath('zh')]: packSource('zh', {
      view: { readonlyTooltip: ZH_READONLY },
      common: { save: 'save-zh' },
    }),
  };
  const { root, shas } = repoWithCommits([before, after]);
  return { root, base: shas[0], head: shas[1] };
}

afterAll(() => {
  for (const root of tempRoots) fs.rmSync(root, { recursive: true, force: true });
});

// -- the parser ---------------------------------------------------------------

describe('the parsed en pack equals the module vitest actually evaluates', () => {
  const parsed = parsePack(fs.readFileSync(path.join(repoRoot, packPath('en')), 'utf8'), 'en.ts');
  const runtime = leafValues(realEn);

  it('extracts exactly the real pack, key for key AND value for value', () => {
    // Values, not just keys: a parser that got the text wrong would compare two
    // wrong strings and report drift that is not there — or, worse, miss drift
    // that is. `check-i18n-call-site-keys.test.ts` pins the key half of the same
    // extraction; this is the half that only matters here.
    const missed = [...runtime.keys()].filter((key) => !parsed.has(key)).sort();
    const invented = [...parsed.keys()].filter((key) => !runtime.has(key)).sort();
    const wrong = [...runtime.entries()]
      .filter(([key, value]) => parsed.has(key) && parsed.get(key) !== value)
      .map(([key]) => key)
      .sort();
    expect({ missed, invented, wrong }).toEqual({ missed: [], invented: [], wrong: [] });
  });

  it('is comparing a whole pack, not an empty one', () => {
    expect(parsed.size).toBeGreaterThan(2000);
  });

  it('folds a sentence written as a concatenation across source lines', () => {
    // i18next serves the folded string, so the folded string is what must be
    // compared — and a parser that treated the node as opaque would silently
    // drop the key out of this gate's sight. The pack's one such value,
    // `objectActions.resetPackageSetConfirm`, retired with the permission-set
    // catalog object (objectui#7611) and no live key is spelled this way, so
    // the shape is pinned on a fixture.
    const folded = parsePack(
      "const en = { a: {\n  b:\n    'This permission set cannot be removed. ' +\n    'Continue?',\n} } as const;\nexport default en;\n",
      'fixture',
    );
    expect([...folded]).toEqual([['a.b', 'This permission set cannot be removed. Continue?']]);
  });

  it('refuses a value form it cannot resolve instead of skipping the key', () => {
    expect(() =>
      parsePack('const en = { a: { b: someRuntimeValue } } as const;\nexport default en;\n', 'fixture'),
    ).toThrow(/neither a nested object nor a static string/);
  });

  it('finds the pack object through `export default`, not through the file name', () => {
    // Historical revisions are parsed too, where "the binding is named after the
    // locale" is an assumption rather than a fact.
    const parsedOdd = parsePack('const table = { a: "x" } as const;\nexport default table;\n', 'fixture');
    expect([...parsedOdd]).toEqual([['a', 'x']]);
  });
});

// -- what counts as drift -----------------------------------------------------

describe('findDrift — an en value that changed without its translations', () => {
  const packsOf = (trees: Record<string, Nested>) =>
    new Map(LOCALES.map((lang) => [lang, parsePack(packSource(lang, trees[lang]), lang)]));
  const uniform = (value: (lang: string) => string): Record<string, Nested> =>
    treesFor((lang) => ({ greeting: value(lang) }));

  it('names every pack that did not follow', () => {
    const before = packsOf(uniform((lang) => `old-${lang}`));
    const after = packsOf({ ...uniform((lang) => `old-${lang}`), en: { greeting: 'new-en' } });
    const { findings, counters } = findDrift(before, after);
    expect(findings).toEqual([
      { key: 'greeting', enBefore: 'old-en', enAfter: 'new-en', unfollowed: FOLLOWERS },
    ]);
    expect(counters.changedEnKeys).toBe(1);
    expect(counters.followedPacks).toBe(0);
  });

  it('is silent when the same key changed in all ten packs', () => {
    const before = packsOf(uniform((lang) => `old-${lang}`));
    const after = packsOf(uniform((lang) => `new-${lang}`));
    const { findings, counters } = findDrift(before, after);
    expect(findings).toEqual([]);
    expect(counters.followedPacks).toBe(9);
  });

  it('reports only the packs that stood still, not the ones that moved', () => {
    const before = packsOf(uniform((lang) => `old-${lang}`));
    const after = packsOf({
      ...uniform((lang) => `old-${lang}`),
      en: { greeting: 'new-en' },
      ja: { greeting: 'new-ja' },
      ar: { greeting: 'new-ar' },
    });
    const { findings } = findDrift(before, after);
    expect(findings[0].unfollowed).toEqual(['zh', 'ko', 'de', 'fr', 'es', 'pt', 'ru']);
  });

  it('leaves added and removed en keys to all-locales-key-parity', () => {
    // A key set change is that test's finding, in both directions. Reporting it
    // here too would make one defect fail two gates with two different stories.
    const before = packsOf(uniform((lang) => `old-${lang}`));
    const after = new Map(before);
    after.set('en', parsePack(packSource('en', { greeting: 'old-en', added: 'brand new' }), 'en'));
    const grown = findDrift(before, after);
    expect(grown.findings).toEqual([]);
    expect(grown.counters.addedEnKeys).toBe(1);

    const shrunk = findDrift(after, before);
    expect(shrunk.findings).toEqual([]);
    expect(shrunk.counters.removedEnKeys).toBe(1);
  });

  it('skips — and counts — a key a pack does not define', () => {
    // The four `console.ai.*` outbound-message keys live in en and zh only, ON
    // PURPOSE (see all-locales-key-parity.test.ts / outbound-agent-messages.test.ts).
    // Demanding the other eight "follow" a key they must not define would put
    // this gate in direct contradiction with the one that owns key sets.
    const trees = treesFor((lang): Nested =>
      lang === 'en' || lang === 'zh' ? { outbound: `old-${lang}` } : { unrelated: `x-${lang}` },
    );
    const before = packsOf(trees);
    const after = packsOf({ ...trees, en: { outbound: 'new-en' }, zh: { outbound: 'new-zh' } });
    const { findings, counters } = findDrift(before, after);
    expect(findings).toEqual([]);
    expect(counters.absentInPack).toBe(8);
  });

  it('does not exempt a typography-only edit', () => {
    // Deliberate, and the waiver ledger is the exemption channel instead. A
    // punctuation heuristic would be a claim about MEANING dressed as a regex,
    // and objectui#3625 is what those claims cost.
    const before = packsOf(uniform(() => 'Save'));
    const after = packsOf({ ...uniform(() => 'Save'), en: { greeting: 'Save.' } });
    expect(findDrift(before, after).findings.map((f) => f.key)).toEqual(['greeting']);
  });
});

// -- the defect this gate exists for, replanted --------------------------------

describe('the objectui#3625 commit, reconstructed in a real git repo', () => {
  it('names the key and all eight packs that kept the retired sentence', () => {
    const { root, base, head } = reconstructed3625();
    const { findings } = analyze(root, { base, head });
    expect(findings).toHaveLength(1);
    expect(findings[0].key).toBe('view.readonlyTooltip');
    expect(findings[0].enBefore).toBe(RETIRED.en);
    expect(findings[0].enAfter).toBe(EN_READONLY);
    // zh followed and is absent; the eight that did not are all named.
    expect(findings[0].unfollowed).toEqual(['ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar']);
  });

  it('fails the build, and the message says which packs and what the sentence became', () => {
    const { root, base, head } = reconstructed3625();
    const { code, output } = runGateExpectingFailure(root, [...FIXTURE_FLOOR, '--base', base, '--head', head]);
    expect(code).toBe(1);
    expect(output).toContain('view.readonlyTooltip');
    expect(output).toContain(EN_READONLY);
    expect(output).toContain('unchanged in: ja, ko, de, fr, es, pt, ru, ar');
  });

  it('refuses to judge packs too small to be the real ones', () => {
    // Same reconstruction, run the way CI runs it — no lowered floor. The fixture
    // packs hold two keys, so the gate reports a collapsed scan instead of a
    // verdict. This is the anti-empty-comparison guard that every other gate in
    // this family opens with, and driving the CLI once without `--min-keys` is
    // what keeps it from being a line nothing exercises.
    const { root, base, head } = reconstructed3625();
    const { code, output } = runGateExpectingFailure(root, ['--base', base, '--head', head]);
    expect(code).toBe(1);
    expect(output).toContain('The scan collapsed');
    expect(output).toContain('expected at least 2000');
  });

  it('goes green when the same commit translates all nine packs', () => {
    const before = packFiles(treesFor((lang) => ({ view: { readonlyTooltip: RETIRED[lang] } })));
    const after = packFiles(
      treesFor((lang) => ({ view: { readonlyTooltip: `${RETIRED[lang]} [read-only]` } })),
    );
    const { root, shas } = repoWithCommits([before, after]);
    const { code, output } = runGate(root, [...FIXTURE_FLOOR, '--base', shas[0], '--head', shas[1]]);
    expect(code).toBe(0);
    expect(output).toContain('Every changed en value was followed by all nine translation packs.');
  });
});

// -- the waiver ledger --------------------------------------------------------

/** The reconstructed drift plus a ledger, as a two-commit repo the CLI can read. */
function reconstructed3625WithLedger(ledger: unknown): { root: string; base: string; head: string } {
  const { root, base, head } = reconstructed3625();
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, LEDGER_PATH), `${JSON.stringify(ledger, null, 2)}\n`);
  return { root, base, head };
}

const validWaiver = {
  waivers: {
    'view.readonlyTooltip': {
      en: EN_READONLY,
      reason: 'fixture waiver',
      issue: 'objectui#3650',
    },
  },
};

describe('the waiver ledger', () => {
  it('waives the finding when it transcribes the new en text verbatim', () => {
    const { root, base, head } = reconstructed3625WithLedger(validWaiver);
    const { code, output } = runGate(root, [...FIXTURE_FLOOR, '--base', base, '--head', head]);
    expect(code).toBe(0);
    expect(output).toContain('1 finding(s) waived by the ledger');
  });

  it('waives nothing when the transcription is off by so much as a word', () => {
    // The transcription is the mechanism, not paperwork: it is what stops a
    // waiver from covering the NEXT edit to the same key.
    const { root, base, head } = reconstructed3625WithLedger({
      waivers: {
        'view.readonlyTooltip': { en: 'System view — read only.', reason: 'fixture', issue: 'objectui#3650' },
      },
    });
    const { code, output } = runGateExpectingFailure(root, [...FIXTURE_FLOOR, '--base', base, '--head', head]);
    expect(code).toBe(1);
    expect(output).toContain('stale-waiver');
    expect(output).toContain('view.readonlyTooltip');
  });

  it('expires by itself the next time the key changes', () => {
    // The property that keeps the ledger from turning into an allowlist: a third
    // commit edits `en` again, and last PR's waiver stops applying — for the
    // fresh drift AND as a stale entry of its own.
    const { root, head } = reconstructed3625WithLedger(validWaiver);
    const third = {
      [packPath('en')]: packSource('en', {
        view: { readonlyTooltip: 'System view — defined in code. Read-only.' },
        common: { save: 'save-en' },
      }),
    };
    for (const [rel, contents] of Object.entries(third)) fs.writeFileSync(path.join(root, rel), contents);
    execFileSync('git', ['add', '-A', '-f'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'en changes again'], { cwd: root });
    const newHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const { code, output } = runGateExpectingFailure(root, [...FIXTURE_FLOOR, '--base', head, '--head', newHead]);
    expect(code).toBe(1);
    expect(output).toContain('stale-waiver');
    expect(output).toContain('the en text this waiver covers is gone');
  });

  it('rejects an entry for a key en does not have', () => {
    const enAfter = new Map([['real.key', 'text']]);
    const problems = checkLedger(
      { waivers: { 'ghost.key': { en: 'text', reason: 'r', issue: 'objectui#1' } } },
      enAfter,
    );
    expect(problems.map((p) => p.reason)).toEqual(['stale-waiver']);
    expect(problems[0].detail).toContain('no longer exists in the en pack');
  });

  it('rejects an entry that does not say what it covers or why', () => {
    const enAfter = new Map([['real.key', 'text']]);
    const problems = checkLedger(
      { waivers: { 'real.key': { en: 'text', reason: '  ', issue: '3650' } } },
      enAfter,
    );
    expect(problems.map((p) => p.detail).sort()).toEqual([
      'missing a `reason`',
      'missing an `issue` of the form objectui#1234',
    ]);
  });

  it('does not treat a waiver that fired nothing as an error', () => {
    // Every run after the waiving PR merges sees an empty diff and this exact
    // shape. Failing it would hand one PR's escape hatch to every later PR as a
    // red build; quantity is ratcheted by the ceiling below instead.
    const enAfter = new Map([['real.key', 'text']]);
    expect(checkLedger({ waivers: { 'real.key': { en: 'text', reason: 'r', issue: 'objectui#1' } } }, enAfter)).toEqual(
      [],
    );
  });

  it('never lets a stale waiver suppress a finding', () => {
    const finding = { key: 'k', enBefore: 'a', enAfter: 'b', unfollowed: ['ja'] };
    const enAfter = new Map([['k', 'b']]);
    expect(applyLedger([finding], { waivers: { k: { en: 'b', reason: 'r', issue: 'objectui#1' } } }, enAfter).waived)
      .toHaveLength(1);
    // Same entry, but `en` has moved on: it waives nothing.
    expect(
      applyLedger([finding], { waivers: { k: { en: 'a', reason: 'r', issue: 'objectui#1' } } }, enAfter).unwaived,
    ).toHaveLength(1);
  });
});

/**
 * The ratchet. The ledger ships empty and this ceiling is the only thing that
 * makes growing it a visible act: adding an entry means raising the number here,
 * in the same PR, where a reviewer reads it next to the transcribed sentence.
 * Lowering it is free and should happen whenever an entry is deleted.
 *
 * Deliberately a count, not `toEqual({})`: a ledger that may legitimately hold
 * one entry should still be pinned at one, and `toEqual({})` cannot express that.
 *
 * 0 -> 5 (objectui#3878). The ellipsis convergence moved 34 `en` values to U+2026
 * and 278 pack values with them; on five of those keys the packs were ALREADY
 * spelling it U+2026, so `en` changed with nothing for them to follow. That is
 * the inverse of the drift this gate hunts — the packs were right and `en` was
 * the outlier — and it is the one case the ledger exists for. Each entry
 * transcribes its new sentence, so the next `en` edit to any of the five expires
 * the waiver and fails the build until someone renews it.
 *
 * 5 -> 6 (objectui#10969). `marketplace.searchPlaceholder` dropped the
 * "manifest ID" jargon in `en` and eight packs; zh had already dropped it in
 * objectui#10900 (标识, identifier), so zh had nothing to follow — the same
 * one-pack-already-right shape as `search.placeholder` above.
 */
const WAIVER_CEILING = 6;

describe('the shipped ledger', () => {
  const ledger = readLedger(repoRoot);

  it(`holds at most ${WAIVER_CEILING} waiver(s) — a ratchet, and this number only goes down`, () => {
    expect(Object.keys(ledger.waivers)).toHaveLength(WAIVER_CEILING);
  });

  it('has no entry that the current en pack contradicts', () => {
    const enAfter = parsePack(fs.readFileSync(path.join(repoRoot, packPath('en')), 'utf8'), 'en.ts');
    expect(checkLedger(ledger, enAfter)).toEqual([]);
    for (const entry of Object.values(ledger.waivers) as Array<{ issue: string }>) {
      expect(entry.issue).toMatch(ISSUE_PATTERN);
    }
  });

  it('is real JSON with the shape the gate reads', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, LEDGER_PATH), 'utf8'));
    expect(raw.waivers).toBeTypeOf('object');
    expect(raw.designerWaivers).toBeTypeOf('object');
    expect(Array.isArray(raw.note)).toBe(true);
  });

  /** The designer section's own ratchet (objectui#8834). It ships EMPTY and its
   *  population had 0 findings on arrival, so this ceiling starts at 0 — raising
   *  it is a reviewed test edit in the same PR, exactly like WAIVER_CEILING. */
  it('holds at most 0 designer waiver(s) — a ratchet, and this number only goes down', () => {
    expect(Object.keys(ledger.designerWaivers)).toHaveLength(0);
  });
});

// -- the designer table, a second population (objectui#8834) ------------------

/**
 * The defect this population exists for is the one objectui#8834 opens with:
 * an `en` string in the metadata-admin designer's own table changes, the `zh`
 * row does not, and every gate in this repo is green — the table is not a
 * locale pack, so it was out of this gate's population entirely.
 *
 * These run over REAL throwaway git repos, base commit against head commit, so
 * the git-blob read on both sides is exercised rather than simulated.
 */
describe('the designer table as a second population', () => {
  const withDesigner = (en: Record<string, string>, zh: Record<string, string>) =>
    packFiles(treesFor(() => ({ a: 'x' })), designerSource(en, zh));

  it('names an en value that changed while its zh row did not', () => {
    const { root, shas } = repoWithCommits([
      withDesigner({ 'engine.fx.help': 'Up to 5 items' }, { 'engine.fx.help': '最多 5 项' }),
      withDesigner({ 'engine.fx.help': 'Up to 20 items' }, { 'engine.fx.help': '最多 5 项' }),
    ]);
    const result = analyzeDesigner(root, { base: shas[0], head: shas[1] });
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      key: 'ENGINE_STRINGS.engine.fx.help',
      enBefore: 'Up to 5 items',
      enAfter: 'Up to 20 items',
      unfollowed: ['zh'],
    });
  });

  it('is green when the zh row followed', () => {
    const { root, shas } = repoWithCommits([
      withDesigner({ 'engine.fx.help': 'Up to 5 items' }, { 'engine.fx.help': '最多 5 项' }),
      withDesigner({ 'engine.fx.help': 'Up to 20 items' }, { 'engine.fx.help': '最多 20 项' }),
    ]);
    expect(analyzeDesigner(root, { base: shas[0], head: shas[1] }).findings).toEqual([]);
  });

  it('skips a key the zh table does not define — the 55 one-sided keys, with no ledger', () => {
    // The whole reason this leg needs no exemption ledger: the per-key skip rule
    // this gate already states for the packs ("a pack that does not define the
    // key is skipped for that key") handles every deliberately zh-only family.
    // Mirrored here: an en key with no zh row changes, and nothing is reported.
    const { root, shas } = repoWithCommits([
      withDesigner({ 'engine.fx.solo': 'Before' }, {}),
      withDesigner({ 'engine.fx.solo': 'After' }, {}),
    ]);
    const result = analyzeDesigner(root, { base: shas[0], head: shas[1] });
    expect(result.findings).toEqual([]);
    expect(result.counters.absentInPack).toBe(1);
  });

  it('leaves added and removed keys to check:i18n-designer-parity', () => {
    const { root, shas } = repoWithCommits([
      withDesigner({ 'engine.fx.a': 'A' }, { 'engine.fx.a': '甲' }),
      withDesigner({ 'engine.fx.b': 'B' }, { 'engine.fx.b': '乙' }),
    ]);
    const result = analyzeDesigner(root, { base: shas[0], head: shas[1] });
    expect(result.findings).toEqual([]);
    expect(result.counters).toMatchObject({ addedEnKeys: 1, removedEnKeys: 1, changedEnKeys: 0 });
  });

  it('judges every pair in the list, prefixing each key with its table', () => {
    const base = withDesigner({ 'engine.fx.a': 'A' }, { 'engine.fx.a': '甲' });
    const head = { ...base };
    head[DESIGNER_TABLE] = base[DESIGNER_TABLE].replace("object: 'Object'", "object: 'Object type'");
    const { root, shas } = repoWithCommits([base, head]);
    const result = analyzeDesigner(root, { base: shas[0], head: shas[1] });
    expect(result.findings.map((finding) => finding.key)).toEqual(['TYPE_LABELS.object']);
  });

  it('has exactly one follower, and it is zh', () => {
    expect(DESIGNER_FOLLOWERS).toEqual(['zh']);
  });

  it('reads the working tree as the after side when no head is named', () => {
    const { root, shas } = repoWithCommits([
      withDesigner({ 'engine.fx.help': 'Before' }, { 'engine.fx.help': '前' }),
    ]);
    fs.writeFileSync(
      path.join(root, DESIGNER_TABLE),
      designerSource({ 'engine.fx.help': 'After' }, { 'engine.fx.help': '前' }),
    );
    expect(analyzeDesigner(root, { base: shas[0] }).findings.map((f) => f.key)).toEqual([
      'ENGINE_STRINGS.engine.fx.help',
    ]);
  });

  it('says so, loudly, when a pair did not exist at the base commit', () => {
    // A table that is NEW is a fact about history, not a stale extractor — but
    // "nothing was compared" must be printed, never inferred from a green.
    const base = packFiles(treesFor(() => ({ a: 'x' })));
    base[DESIGNER_TABLE] = base[DESIGNER_TABLE].replace('const TYPE_LABELS_EN', 'const LATER_LABELS_EN');
    const { root, shas } = repoWithCommits([base, packFiles(treesFor(() => ({ a: 'x' })))]);
    const result = analyzeDesigner(root, { base: shas[0], head: shas[1] });
    expect(result.skippedAtBase).toEqual(['TYPE_LABELS']);
    const run = runGate(root, ['--base', shas[0], '--head', shas[1], ...FIXTURE_FLOOR]);
    expect(run.output).toContain('TYPE_LABELS did not exist at the base commit');
  });

  it('throws rather than comparing nothing when a table is gone at HEAD', () => {
    const head = packFiles(treesFor(() => ({ a: 'x' })));
    head[DESIGNER_TABLE] = head[DESIGNER_TABLE].replace('const ENGINE_STRINGS_ZH', 'const RENAMED_ZH');
    const { root, shas } = repoWithCommits([packFiles(treesFor(() => ({ a: 'x' }))), head]);
    expect(() => analyzeDesigner(root, { base: shas[0], head: shas[1] })).toThrow(/the extractor is stale/);
  });

  it('folds the pair list into one lang -> (key -> value) map, namespaced by table', () => {
    const { values } = readDesignerTables(
      repoWithCommits([withDesigner({ 'engine.fx.a': 'A' }, { 'engine.fx.a': '甲' })]).root,
      null,
    );
    const { population, skipped } = designerPopulation(values);
    expect(skipped).toEqual([]);
    expect([...population.get('en')!.keys()].sort()).toEqual([
      'DOMAIN_LABELS.data',
      'ENGINE_STRINGS.engine.fx.a',
      'TYPE_LABELS.object',
    ]);
  });
});

describe('the designer population, end to end through the CLI', () => {
  // `scratch.txt` differs per commit so the second commit is never empty — git
  // refuses one, and the two "nothing changed" cases below write identical
  // tables on purpose.
  const designerCommits = (before: string, after: string) => [
    {
      ...packFiles(treesFor(() => ({ a: 'x' })), designerSource({ 'engine.fx.help': before }, { 'engine.fx.help': '最多 5 项' })),
      'scratch.txt': 'first',
    },
    {
      ...packFiles(treesFor(() => ({ a: 'x' })), designerSource({ 'engine.fx.help': after }, { 'engine.fx.help': '最多 5 项' })),
      'scratch.txt': 'second',
    },
  ];

  it('exits 1 and names the designer key whose zh row did not follow', () => {
    const { root, shas } = repoWithCommits(designerCommits('Up to 5 items', 'Up to 20 items'));
    const run = runGateExpectingFailure(root, ['--base', shas[0], '--head', shas[1], ...FIXTURE_FLOOR]);
    expect(run.code).toBe(1);
    expect(run.output).toContain('designer-table en string(s) changed without their zh row');
    expect(run.output).toContain('ENGINE_STRINGS.engine.fx.help');
  });

  it('exits 0 and says so when no designer value changed', () => {
    const { root, shas } = repoWithCommits(designerCommits('Up to 5 items', 'Up to 5 items'));
    const run = runGate(root, ['--base', shas[0], '--head', shas[1], ...FIXTURE_FLOOR]);
    expect(run.output).toContain('No designer-table en value changed in this range.');
  });

  it('fails loudly rather than passing when the designer scan collapses', () => {
    const { root, shas } = repoWithCommits(designerCommits('Up to 5 items', 'Up to 5 items'));
    const run = runGateExpectingFailure(root, ['--base', shas[0], '--head', shas[1], '--min-keys', '1']);
    expect(run.code).toBe(1);
    expect(run.output).toContain('The designer scan collapsed');
  });

  it('waives a designer finding through the ledger, and expires the waiver with the text', () => {
    const { root, shas } = repoWithCommits(designerCommits('Up to 5 items', 'Up to 20 items'));
    const ledger = (en: string) => ({
      [LEDGER_PATH]: JSON.stringify({
        note: [],
        waivers: {},
        designerWaivers: {
          'ENGINE_STRINGS.engine.fx.help': { en, reason: 'fixture', issue: 'objectui#8834' },
        },
      }),
    });
    // Transcribing the NEW text waives that one sentence...
    fs.mkdirSync(path.join(root, path.dirname(LEDGER_PATH)), { recursive: true });
    fs.writeFileSync(path.join(root, LEDGER_PATH), ledger('Up to 20 items')[LEDGER_PATH]);
    expect(
      runGate(root, ['--base', shas[0], '--head', shas[1], ...FIXTURE_FLOOR]).output,
    ).toContain('1 finding(s) waived by the ledger');
    // ...and a waiver whose text has moved on waives nothing and is itself a problem.
    fs.writeFileSync(path.join(root, LEDGER_PATH), ledger('Up to 9 items')[LEDGER_PATH]);
    const stale = runGateExpectingFailure(root, ['--base', shas[0], '--head', shas[1], ...FIXTURE_FLOOR]);
    expect(stale.output).toContain('designerWaivers');
    expect(stale.output).toContain('stale-waiver');
  });
});

// -- the base commit ----------------------------------------------------------

describe('resolving the commit to compare against', () => {
  it('fails loudly rather than passing when there is no base to diff', () => {
    // The failure mode this whole family of gates exists to prevent: a diff gate
    // that finds no diff and reports green. A shallow CI checkout (the default)
    // produces exactly that if the gate is permissive about it.
    const { root } = repoWithCommits([packFiles(treesFor((lang) => ({ a: `x-${lang}` })))]);
    execFileSync('git', ['checkout', '-q', '-b', 'detached-from-main'], { cwd: root });
    execFileSync('git', ['branch', '-q', '-D', 'main'], { cwd: root });

    const resolved = resolveBaseRef(root, { env: {} });
    expect(resolved.ok).toBe(false);

    const { code, output } = runGateExpectingFailure(root, []);
    expect(code).toBe(1);
    expect(output).toContain('Cannot resolve the commit to compare against');
    expect(output).toContain('a diff gate with no diff would pass while');
  });

  it('prefers the merge base with the PR base branch when CI names one', () => {
    const { root, shas } = repoWithCommits([
      packFiles(treesFor((lang) => ({ a: `x-${lang}` }))),
      packFiles(treesFor((lang) => ({ a: `y-${lang}` }))),
    ]);
    execFileSync('git', ['remote', 'add', 'origin', root], { cwd: root });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', shas[0]], { cwd: root });

    expect(resolveBaseRef(root, { env: { GITHUB_BASE_REF: 'main' } })).toMatchObject({
      ok: true,
      ref: shas[0],
      how: 'merge-base with origin/main',
    });
  });

  // ── an explicitly named base is authoritative (objectui#3766) ─────────────

  /** Well-formed, forty hex digits, and in no clone anywhere. */
  const ABSENT_SHA = '0123456789abcdef0123456789abcdef01234567';

  it('FAILS on an explicitly named --base that does not exist — it does NOT fall back', () => {
    // The defect objectui#3766 filed, in the shape it was measured. `--base` used
    // to be merely the FIRST link of the candidate chain, so a sha missing from
    // this clone (a shallow checkout, an unfetched sha, a typo) fell through to
    // `merge-base with main` — which in this fixture repo resolves to HEAD. The
    // gate then compared the packs at HEAD against the identical working tree,
    // found no changed en value, and printed a confident green (measured: exit 0,
    // with `(--base …)` in the summary line replaced by the candidate it actually
    // used, so the log gave the reader nothing to notice). Restoring the
    // fallthrough turns this case green again — exit 0 and the "followed by all
    // nine" line below — which is the reverse verification for the fix.
    //
    // "The base you named is missing" and "you named no base" are different
    // facts, and only the second may be answered by guessing. Ported verbatim in
    // spirit from `check-changeset-presence.test.ts`, where the sibling gate's
    // own tests caught this first (objectui#3762).
    const { root } = reconstructed3625();

    const { code, output } = runGateExpectingFailure(root, [...FIXTURE_FLOOR, '--base', ABSENT_SHA]);
    expect(code).toBe(1);
    expect(output).toContain('Cannot resolve the commit to compare against');
    expect(output).toContain(`--base ${ABSENT_SHA} (unresolved)`);
    expect(output).toContain('named EXPLICITLY');
    expect(output).toContain('a diff gate with no diff would pass while');
    // And specifically NOT the pass it used to produce by comparing against main.
    expect(output).not.toContain('Every changed en value was followed');
  });

  it('FAILS the same way on an OS_I18N_DRIFT_BASE that does not exist', () => {
    // The env var is the other documented explicit entrypoint — same authority,
    // same failure, and it is the one CI-adjacent callers reach for. Driven
    // through the real CLI with the var actually set, because `runGate` clears it
    // for every other test in this file.
    const { root } = reconstructed3625();

    const { code, output } = runGateExpectingFailure(root, FIXTURE_FLOOR, {
      OS_I18N_DRIFT_BASE: ABSENT_SHA,
    });
    expect(code).toBe(1);
    expect(output).toContain(`OS_I18N_DRIFT_BASE=${ABSENT_SHA} (unresolved)`);
    expect(output).toContain('named EXPLICITLY');
    expect(output).not.toContain('Every changed en value was followed');
  });

  it('consults NOTHING but the named base — not even a candidate that would resolve', () => {
    // The mechanism, asserted directly rather than through an exit code: `tried`
    // holds exactly one entry. `GITHUB_BASE_REF=main` plus a real `origin/main`
    // here means the discovery candidate WOULD have produced a base, so a single
    // `tried` entry is the proof that it was never asked.
    const { root, shas } = repoWithCommits([
      packFiles(treesFor((lang) => ({ a: `x-${lang}` }))),
      packFiles(treesFor((lang) => ({ a: `y-${lang}` }))),
    ]);
    execFileSync('git', ['remote', 'add', 'origin', root], { cwd: root });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', shas[0]], { cwd: root });

    const outcome = resolveBaseRef(root, { explicit: ABSENT_SHA, env: { GITHUB_BASE_REF: 'main' } });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.named).toBe(true);
      expect(outcome.tried).toEqual([`--base ${ABSENT_SHA} (unresolved)`]);
    }
    // Sanity: the same repo, same env, WITHOUT a named base still finds one.
    expect(resolveBaseRef(root, { env: { GITHUB_BASE_REF: 'main' } })).toMatchObject({ ok: true });
  });

  it('still resolves a named base that DOES exist, and --base outranks the env var', () => {
    const { root, shas } = repoWithCommits([
      packFiles(treesFor((lang) => ({ a: `x-${lang}` }))),
      packFiles(treesFor((lang) => ({ a: `y-${lang}` }))),
    ]);

    expect(resolveBaseRef(root, { explicit: shas[0], env: {} })).toMatchObject({
      ok: true,
      ref: shas[0],
      how: `--base ${shas[0]}`,
    });
    expect(resolveBaseRef(root, { env: { OS_I18N_DRIFT_BASE: shas[0] } })).toMatchObject({
      ok: true,
      ref: shas[0],
      how: `OS_I18N_DRIFT_BASE=${shas[0]}`,
    });
    // `--base` outranks the env var: both name a real commit, and the flag's is
    // the one compared against.
    const both = resolveBaseRef(root, { explicit: shas[0], env: { OS_I18N_DRIFT_BASE: shas[1] } });
    expect(both).toMatchObject({ ok: true, ref: shas[0], how: `--base ${shas[0]}` });
  });

  it('keeps guessing through the whole chain when NO base was named', () => {
    // The other half of objectui#3766, and the half CI depends on: only "you
    // named one and it is missing" became a failure. With nothing named, an
    // unresolvable `GITHUB_BASE_REF` still falls through to `origin/main` exactly
    // as before — `pnpm check:i18n-drift` passes no `--base`, so this is the path
    // every real CI run takes.
    const { root, shas } = repoWithCommits([
      packFiles(treesFor((lang) => ({ a: `x-${lang}` }))),
      packFiles(treesFor((lang) => ({ a: `y-${lang}` }))),
    ]);
    execFileSync('git', ['remote', 'add', 'origin', root], { cwd: root });
    execFileSync('git', ['update-ref', 'refs/remotes/origin/main', shas[0]], { cwd: root });

    // `GITHUB_BASE_REF` names a branch this clone does not have; the chain moves
    // on and `origin/main` answers.
    expect(resolveBaseRef(root, { env: { GITHUB_BASE_REF: 'no-such-branch' } })).toMatchObject({
      ok: true,
      ref: shas[0],
      how: 'merge-base with origin/main',
    });
    // And in a clone with no `origin` at all, the last link — the local `main` —
    // still answers, so the chain is intact end to end and not just at its head.
    const solo = repoWithCommits([packFiles(treesFor((lang) => ({ a: `x-${lang}` })))]);
    expect(resolveBaseRef(solo.root, { env: {} })).toMatchObject({
      ok: true,
      how: 'merge-base with main',
    });
  });

  it('reads the working tree as the after side when no head is named', () => {
    // So an agent editing en.ts locally gets the answer before committing.
    const { root, shas } = repoWithCommits([packFiles(treesFor((lang) => ({ a: `x-${lang}` })))]);
    fs.writeFileSync(path.join(root, packPath('en')), packSource('en', { a: 'edited in the working tree' }));
    const after = readPacks(root, null);
    expect(after.get('en')!.get('a')).toBe('edited in the working tree');
    const { findings } = analyze(root, { base: shas[0] });
    expect(findings.map((f) => f.key)).toEqual(['a']);
  });
});

// -- wiring -------------------------------------------------------------------

describe('the gate is wired to run', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const ci = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

  it('package.json exposes it as a named script', () => {
    expect(pkg.scripts['check:i18n-drift']).toBe('node scripts/check-i18n-en-drift.mjs');
  });

  it('ci.yml runs it after the install it needs (it imports typescript)', () => {
    const install = ci.indexOf('pnpm install --frozen-lockfile');
    const step = ci.indexOf('run: pnpm check:i18n-drift');
    expect(step, 'ci.yml does not run `pnpm check:i18n-drift`').toBeGreaterThan(-1);
    expect(step, 'the check runs before dependencies are installed').toBeGreaterThan(install);
  });

  it('gives that job a full-history checkout, or the merge base does not exist', () => {
    // actions/checkout defaults to depth 1. Without this the gate cannot resolve
    // a base — and by design that is a red build, not a silent pass, so losing
    // this line breaks CI loudly. The pin is here so the reason survives.
    const job = ci.slice(ci.indexOf('  type-check:'), ci.indexOf('run: pnpm check:i18n-drift'));
    expect(job).toContain('fetch-depth: 0');
  });

  it('is not hidden from the locale packs by ci.yml path filters', () => {
    // ci.yml `paths-ignore`s markdown, content/, docs/, apps/site/ and
    // .changeset/ on its `push` trigger — since objectui#3523 step 2 the only
    // trigger that still carries the filter (ci.yml:6; lint.yml:32 is the twin),
    // and the only thing the assertion below can see, since it slices the `on:`
    // block. None of them can match `packages/i18n/src/locales/*.ts` or the
    // ledger, so a push that edits an en string always starts this workflow.
    //
    // For a PULL REQUEST the conclusion holds for a second and stronger reason.
    // This lead-in used to state it in a bare present tense that read as if the
    // filter still applied there; objectui#4384 qualified it, together with its
    // near-verbatim twin in `check-action-forward-parity.test.ts`, closing the
    // #3857 / #4369 / #4381 family (PRs #4371 / #4380 / #4382). No
    // `paths-ignore` survives on `pull_request` at all, so such a PR starts this
    // workflow a fortiori — measured there: PR #3856, one markdown file, 16
    // checks. What decides a pull request now is the in-job `Decide whether this
    // change needs a full run` step, whose exclusion list is that `push` filter
    // unchanged, held identical to it by
    // `scripts/__tests__/merge-queue-reporting.test.ts` — so the patterns pinned
    // below are also what keeps the expensive steps running on a locale-pack PR.
    //
    // A new entry that DID cover them would make the gate unreachable for
    // exactly the PRs it judges, on both lanes at once — the objectui#3547 /
    // control-bytes.yml lesson, one workflow over.
    const ignored = ci.slice(0, ci.indexOf('jobs:')).match(/^\s+- '.*'$/gm) ?? [];
    for (const pattern of ignored) {
      expect(pattern).not.toMatch(/packages|scripts|locales/);
    }
    expect(ignored.length).toBeGreaterThan(0);
  });
});
