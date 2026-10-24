import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are inferred from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import ts from 'typescript';
import {
  EXIT_CODES,
  MIN_REASON_LENGTH,
  TS_FENCE_LANGUAGES,
  UNGATED_EXAMPLES,
  codesMatch,
  exampleCensus,
  exportedOwnerOf,
  fencesOfExample,
  funnelLines,
  judge,
  ledgerKey,
  builtTwinSpecifier,
  listExampleSources,
  preludeFor,
} from '../check-doc-example-types.mjs';

/**
 * objectui#8258 — the test for `scripts/check-doc-example-types.mjs`.
 *
 * The gate compiles JSDoc `@example` blocks on exported symbols against the
 * BUILT types. Two kinds of assertion live here, and the split matters:
 *
 *   INSTRUMENT  cases built from fixture text, which prove the extraction and
 *               the four ledger verdicts behave as the header says — including
 *               the two that make the ledger shrink-only, which are the ones a
 *               reader would otherwise have to take on trust.
 *   CORPUS      cases about THIS repository, which prove the instrument is
 *               pointed at a real population and that the ledger is exact. They
 *               are what stops the gate going green by scanning nothing.
 *
 * ⛔ What is deliberately NOT here: a case that runs the whole gate and asserts
 * exit 0. That is `pnpm check:doc-examples`' job, it needs the built closure,
 * and duplicating it here would make this file's runtime depend on a build.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const gateSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'check-doc-example-types.mjs'), 'utf8');

// ── instrument: extraction ───────────────────────────────────────────────────

describe('fence extraction inside an `@example` body', () => {
  it('reads ts, tsx and typescript fences and nothing else', () => {
    const fences = fencesOfExample(
      ['```ts', 'const a = 1;', '```', '```json', '{}', '```', '```tsx', '<div />', '```'].join('\n'),
    );
    expect(fences.map((f) => f.language)).toEqual(['ts', 'json', 'tsx']);
    expect(fences.filter((f) => TS_FENCE_LANGUAGES.has(f.language))).toHaveLength(2);
  });

  it('closes a block at a fence of its own run length, so a wider wrapper is one block', () => {
    const fences = fencesOfExample(['````ts', '```', 'const a = 1;', '```', '````'].join('\n'));
    expect(fences).toHaveLength(1);
    expect(fences[0].body).toBe(['```', 'const a = 1;', '```'].join('\n'));
  });

  it('keeps the snippet own indentation', () => {
    const fences = fencesOfExample(['```ts', 'if (x) {', '  go();', '}', '```'].join('\n'));
    expect(fences[0].body).toContain('\n  go();');
  });

  it('an unterminated fence runs to the end rather than swallowing the walk', () => {
    const fences = fencesOfExample(['```ts', 'const a = 1;'].join('\n'));
    expect(fences).toHaveLength(1);
    expect(fences[0].body).toBe('const a = 1;');
  });
});

describe('the exported owner is read from the AST, never from the text', () => {
  const ownerOf = (source: string, needle: string) => {
    const sf = ts.createSourceFile('probe.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    let found: ReturnType<typeof exportedOwnerOf> | null = null;
    const visit = (node: ts.Node) => {
      if (node.getText(sf).startsWith(needle) && found === null) found = exportedOwnerOf(node);
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sf, visit);
    return found;
  };

  it('names an exported function', () => {
    expect(ownerOf('export function useThing() {}', 'export function')).toEqual({
      exported: true,
      symbol: 'useThing',
    });
  });

  it('names the VARIABLE, not the statement, for an exported const', () => {
    expect(ownerOf('export const thing = 1;', 'export const')).toEqual({
      exported: true,
      symbol: 'thing',
    });
  });

  it('walks OUTWARD: a property inside an exported interface belongs to the interface', () => {
    const sf = ts.createSourceFile(
      'probe.ts',
      'export interface Shape {\n  /** @example 1 */\n  size: number;\n}',
      ts.ScriptTarget.ES2022,
      true,
    );
    const iface = sf.statements[0] as ts.InterfaceDeclaration;
    expect(exportedOwnerOf(iface.members[0])).toEqual({ exported: true, symbol: 'Shape' });
  });

  it('reports a non-exported declaration as not exported', () => {
    expect(ownerOf('function local() {}', 'function local')).toEqual({
      exported: false,
      symbol: null,
    });
  });

  it('the word `export` inside a STRING does not make a declaration exported', () => {
    expect(ownerOf('const doc = "export function fake() {}";\nfunction real() {}', 'function real')).toEqual({
      exported: false,
      symbol: null,
    });
  });
});

// ── instrument: the one transformation ───────────────────────────────────────

describe('the documented symbol import is injected only when all three conditions hold', () => {
  const block = { symbol: 'useThing', package: '@object-ui/x', body: 'const r = useThing();' };
  const fromRoot = new Map([['@object-ui/x useThing', '@object-ui/x']]);

  it('injects when the block references the symbol and does not import it', () => {
    expect(preludeFor(block, fromRoot)).toBe("import { useThing } from '@object-ui/x';\n");
  });

  it('does NOT inject when the block never references the symbol', () => {
    expect(preludeFor({ ...block, body: 'const r = 1;' }, fromRoot)).toBe('');
  });

  it('does NOT inject when the block already imports the symbol itself', () => {
    expect(
      preludeFor({ ...block, body: "import { useThing } from 'somewhere';\nuseThing();" }, fromRoot),
    ).toBe('');
  });

  it('does NOT inject when NO probed specifier could import the symbol — the gate never blames an example for this transformation', () => {
    expect(preludeFor(block, new Map())).toBe('');
  });

  it('injects the specifier the probe RESOLVED, not the package name — objectui#8743', () => {
    const twin = '/repo/packages/x/dist/internal/thing.js';
    expect(preludeFor(block, new Map([['@object-ui/x useThing', twin]]))).toBe(
      `import { useThing } from '${twin}';\n`,
    );
  });
});

// ── instrument: the second injection candidate (objectui#8743) ───────────────

describe("candidate 2: the documented symbol's own built declaration", () => {
  const roots: string[] = [];
  const fixture = (files: Record<string, string>) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-example-twin-'));
    roots.push(root);
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, body);
    }
    return root;
  };
  afterAll(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  it('is the dist twin of the source file when that per-file declaration exists', () => {
    const root = fixture({ 'packages/types/dist/zod/imported-defaults.d.ts': 'export {};\n' });
    expect(builtTwinSpecifier('packages/types/src/zod/imported-defaults.ts', root)).toBe(
      path.join(root, 'packages/types/dist/zod/imported-defaults.js'),
    );
  });

  it('is null when the build BUNDLES its declarations, so there is no per-file twin', () => {
    const root = fixture({ 'packages/data-objectstack/dist/index.d.ts': 'export {};\n' });
    expect(builtTwinSpecifier('packages/data-objectstack/src/cache/MetadataCache.ts', root)).toBe(
      null,
    );
  });

  it('is null for a path that is not `packages/NAME/src/...`', () => {
    const root = fixture({ 'apps/console/dist/main.d.ts': 'export {};\n' });
    expect(builtTwinSpecifier('apps/console/src/main.ts', root)).toBe(null);
  });

  it('is an ABSOLUTE specifier, which THE BOUND never refuses', () => {
    const root = fixture({ 'packages/types/dist/a.d.ts': 'export {};\n' });
    const twin = builtTwinSpecifier('packages/types/src/a.ts', root);
    expect(twin).not.toBe(null);
    expect(path.isAbsolute(twin as string)).toBe(true);
  });
});

// ── instrument: the four ledger verdicts ─────────────────────────────────────

describe('the ledger is re-derived, never trusted', () => {
  const reason = 'a written reason long enough to be a declaration';

  it('a failing block with no row is a FAILURE — the default is COVERED', () => {
    const { findings } = judge({ results: [{ key: 'a.ts:1 A', codes: [2322] }], ledger: {} });
    expect(findings.map((f) => f.reason)).toEqual(['undeclared-failure']);
  });

  it('a failing block whose row matches is exempt, and nothing is reported', () => {
    const { findings, exempt } = judge({
      results: [{ key: 'a.ts:1 A', codes: [2322] }],
      ledger: { 'a.ts:1 A': { codes: [2322], reason } },
    });
    expect(findings).toEqual([]);
    expect(exempt).toEqual(['a.ts:1 A']);
  });

  it('SHRINK-ONLY: a row whose block now COMPILES is stale, and that is a red', () => {
    const { findings } = judge({
      results: [{ key: 'a.ts:1 A', codes: [] }],
      ledger: { 'a.ts:1 A': { codes: [2322], reason } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('stale-ledger-row');
    expect(findings[0].detail).toContain('COMPILES now');
  });

  it('SHRINK-ONLY: a row whose block fails DIFFERENTLY is a red — a row may not cover a failure it never declared', () => {
    const { findings } = judge({
      results: [{ key: 'a.ts:1 A', codes: [2322] }],
      ledger: { 'a.ts:1 A': { codes: [2304], reason } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toBe('ledger-row-drifted');
    expect(findings[0].detail).toContain('TS2304');
    expect(findings[0].detail).toContain('TS2322');
  });

  it('a row naming a block that is gone is stale', () => {
    const { findings } = judge({ results: [], ledger: { 'gone.ts:1 A': { codes: [2322], reason } } });
    expect(findings.map((f) => f.reason)).toEqual(['stale-ledger-row']);
    expect(findings[0].detail).toContain('no such example');
  });

  it('a row with no written reason is not a declaration', () => {
    const { findings } = judge({
      results: [{ key: 'a.ts:1 A', codes: [2322] }],
      ledger: { 'a.ts:1 A': { codes: [2322], reason: 'short' } },
    });
    expect(findings.map((f) => f.reason)).toEqual(['unexplained-ledger-row']);
  });

  it('a clean block with no row is silent — the whole point of the exercise', () => {
    expect(judge({ results: [{ key: 'a.ts:1 A', codes: [] }], ledger: {} }).findings).toEqual([]);
  });

  it('codes are compared as a SET: a doubled diagnostic is not a changed failure', () => {
    expect(codesMatch([2322, 2322], [2322])).toBe(true);
    expect(codesMatch([2322, 2304], [2304, 2322])).toBe(true);
    expect(codesMatch([2322], [2322, 2304])).toBe(false);
  });
});

// ── corpus: this repository ──────────────────────────────────────────────────

describe('this repository', () => {
  const census = exampleCensus({ root: repoRoot });

  it('walks a plausible number of sources — an empty walk makes every verdict vacuous', () => {
    expect(census.files.length).toBeGreaterThan(500);
    expect(census.excludedAsTooling.length).toBeGreaterThan(100);
  });

  it('has examples to judge — the compiled tier is not empty', () => {
    expect(census.blocks.length).toBeGreaterThan(50);
  });

  it('every block in the compiled tier names an exported symbol and a package', () => {
    for (const block of census.blocks) {
      expect(block.symbol, block.file).toBeTruthy();
      expect(block.package, block.file).toMatch(/^@object-ui\/|^object-ui$/);
    }
  });

  it('the bare tier is COUNTED, not dropped — the header stands or falls on that number', () => {
    expect(census.bare.length).toBeGreaterThan(0);
    expect(census.exported.length).toBe(
      census.withTsFence.length + census.otherFenceOnly.length + census.bare.length,
    );
  });

  it('the funnel prints every narrowing step, so the enforced number is derived', () => {
    const lines = funnelLines(census);
    expect(lines.join('\n')).toContain('EXPORTED declarations');
    expect(lines.join('\n')).toContain('BLOCKS in the compiled tier');
    expect(lines.at(-1)).toContain(String(census.blocks.length));
  });

  it('tooling files contribute nothing to the compiled tier', () => {
    const toolingFiles = new Set(census.excludedAsTooling);
    for (const block of census.blocks) expect(toolingFiles.has(block.file)).toBe(false);
  });
});

describe('the real ledger', () => {
  const census = exampleCensus({ root: repoRoot });
  const keys = new Set(census.blocks.map((b) => ledgerKey(b)));

  it('every row names a block that is actually in the compiled tier', () => {
    for (const key of Object.keys(UNGATED_EXAMPLES)) expect(keys.has(key), key).toBe(true);
  });

  it('every row carries a written reason and a code list', () => {
    for (const [key, row] of Object.entries(UNGATED_EXAMPLES)) {
      expect(row.reason.trim().length, key).toBeGreaterThanOrEqual(MIN_REASON_LENGTH);
      expect(row.codes.length, key).toBeGreaterThan(0);
      expect(row.codes.every((c) => Number.isInteger(c)), key).toBe(true);
    }
  });

  it('is a DEBT, not the corpus: some blocks are off it and therefore actually judged', () => {
    const declared = Object.keys(UNGATED_EXAMPLES).length;
    expect(declared).toBeLessThan(census.blocks.length);
    expect(census.blocks.length - declared).toBeGreaterThan(0);
  });

  it('a row that names a card names one this repository can be asked about', () => {
    for (const [key, row] of Object.entries(UNGATED_EXAMPLES)) {
      if (row.card === null) continue;
      expect(row.card, key).toMatch(/^objectui#\d+$/);
    }
  });

  /**
   * objectui#8875 clause 3. The key used to be `path:line symbol`, and the line
   * number in it was not decoration — it was a STORED literal compared for
   * equality, so an edit anywhere above a documented symbol invalidated every
   * row below it in that file and reddened `main` on a branch that had not
   * touched a single example. PR #8895 added three imports to
   * `packages/types/src/objectql.ts` and did exactly that; objectui#8614 is the
   * same failure one card earlier.
   *
   * The maintainer ruled the class on 2026-09-10 — 跨文件的「某文件第几行」引用，
   * 这种完全没必要吧，是否应该避免 — and the repair the ruling names is to stop
   * storing the number, ⛔ not to recompute it after every shift. So the shape
   * is pinned in BOTH directions: the key generator may not produce one, and the
   * ledger may not carry one.
   */
  it('keys carry no line address, in either direction', () => {
    const LINE_ADDRESS = /\.[A-Za-z]+:\d+/;

    for (const key of Object.keys(UNGATED_EXAMPLES)) {
      expect(
        key,
        `${key} embeds a line address. objectui#8875 clause 3 retired that key shape: a stored ` +
          `line number is a snapshot of a moving quantity, so an unrelated edit above the block ` +
          `invalidates the row and reddens a branch that changed nothing. Key by ` +
          `\`path symbol #ordinal\` — see \`ledgerKey\`.`,
      ).not.toMatch(LINE_ADDRESS);
      expect(key, `${key} is not in the \`path symbol #ordinal\` shape`).toMatch(/ #\d+$/);
    }

    // The generator, not only today's ledger: a ledger cleaned by hand while the
    // generator still emits addresses would go red on the next collected block
    // instead of here.
    for (const block of census.blocks) {
      expect(ledgerKey(block), 'ledgerKey emitted a line address').not.toMatch(LINE_ADDRESS);
    }

    // Anti-vacuity. A regex that matched nothing would pass both loops above on
    // an empty tree, so it is shown FIRING on the shape it is written to reject.
    //
    // ⛔ ASSEMBLED, not written out. A literal address here would itself be a
    // cross-file line citation, and the differential gate landed alongside this
    // change would report it as newly added — correctly. A control for a shape
    // does not need to be an instance of the thing the shape names.
    const RETIRED_KEY_SHAPE = ['packages/types/src/objectql.ts', ':', '1618', ' ObjectFormSchema'].join('');
    expect(RETIRED_KEY_SHAPE).toMatch(LINE_ADDRESS);
  });

  it('the ordinal discriminates the symbols that document more than one example', () => {
    // The ordinal is not ceremony: five symbols in this tree carry several
    // `@example` blocks, and `path symbol` alone would collapse them onto one
    // key — silently, by making several rows the same row. Keys are checked for
    // uniqueness against the block count so that collapse cannot happen quietly.
    const generated = census.blocks.map((b) => ledgerKey(b));
    expect(new Set(generated).size).toBe(census.blocks.length);
    expect(new Set(census.blocks.map((b) => `${b.file} ${b.symbol}`)).size).toBeLessThan(
      census.blocks.length,
    );
  });
});

// ── the card's own acceptance criterion ──────────────────────────────────────

describe('objectui#7974 — the defect this gate was filed for, after the repair landed', () => {
  const key = 'packages/mobile/src/useSpecGesture.ts useSpecGesture #1';

  it('its example is IN the compiled tier — the gate reaches the block the card named', () => {
    const census = exampleCensus({ root: repoRoot });
    expect(census.blocks.map((b) => ledgerKey(b))).toContain(key);
  });

  it('the block now passes the ARRAY its declared type asks for, not the scalar the card measured', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'packages/mobile/src/useSpecGesture.ts'), 'utf8');
    expect(source).toContain("direction: ['left']");
    expect(source, 'the scalar the card measured').not.toContain("direction: 'left'");
  });

  it('its row no longer declares TS2322, and no longer names a card that owns a repair', () => {
    const row = UNGATED_EXAMPLES[key];
    expect(row).toBeDefined();
    expect(row.codes).not.toContain(2322);
    expect(row.card).toBeNull();
  });

  it('the row SURVIVED the repair rather than being deleted — the block still returns outside a function', () => {
    // The row's own instruction said to delete it when the card landed. Deleting
    // it would have been an UNDECLARED FAILURE, not a green: repairing the
    // example removed the TS2322 half and left the hook-body excerpt its two
    // siblings in the same package are declared for.
    expect(UNGATED_EXAMPLES[key].codes).toEqual([1108]);
    expect(UNGATED_EXAMPLES['packages/mobile/src/useGesture.ts useGesture #1'].codes).toEqual([1108]);
    expect(UNGATED_EXAMPLES['packages/mobile/src/useTouchTarget.ts useTouchTarget #1'].codes).toEqual([1108]);
  });

  it('the row is the ONLY thing keeping this green — remove it and the block is an undeclared failure', () => {
    const { findings } = judge({
      results: [{ key, codes: UNGATED_EXAMPLES[key].codes }],
      ledger: {},
    });
    expect(findings.map((f) => f.reason)).toEqual(['undeclared-failure']);
  });

  it('when the block is made self-contained the row goes STALE, so the debt cannot outlive the defect', () => {
    const { findings } = judge({
      results: [{ key, codes: [] }],
      ledger: { [key]: UNGATED_EXAMPLES[key] },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ reason: 'stale-ledger-row', site: key });
  });
});

// ── the decisions this gate is asked to state in its own source ──────────────

describe('the script states its own rulings, so they cannot drift out of the source', () => {
  it('states why bare `@example` bodies are counted and not compiled', () => {
    expect(gateSource).toContain('Why bare `@example` bodies are counted and not compiled');
  });

  it('states the ONE transformation and that it is the only one', () => {
    expect(gateSource).toContain('The ONE transformation, stated out loud');
  });

  it('records that the `declare var NAME: any` route was priced and REFUSED', () => {
    expect(gateSource).toContain('declare var NAME: any');
    expect(gateSource).toContain('REFUSED');
  });

  it('states the template-literal decision and points at the instrument that already owns it', () => {
    expect(gateSource).toContain('The template-literal half of objectui#8258');
    expect(gateSource).toContain('--emit-census');
  });

  it('carries the three exit codes the sibling carries, for the reason the sibling gives', () => {
    expect(EXIT_CODES).toEqual({ verified: 0, examplesFailed: 1, couldNotRun: 2 });
  });

  it('refuses a verdict when the walk collapses or the compiled tier is empty', () => {
    expect(gateSource).toContain('would be a zero that means nothing');
    expect(gateSource).toContain('The compiled tier is EMPTY');
  });
});

// ── the sibling is not perturbed ─────────────────────────────────────────────

describe('the sibling harness is imported, not forked', () => {
  it('imports the compile harness rather than re-spelling it', () => {
    expect(gateSource).toContain("from './check-doc-snippet-types.mjs'");
    expect(gateSource).toMatch(/import \{[^}]*compileSnippets[^}]*\} from '\.\/check-doc-snippet-types\.mjs'/s);
  });

  it("does not re-declare the sibling's controls — a second sentinel would be a second answer", () => {
    expect(gateSource).not.toContain('ThisNameIsDefinitelyNotExported');
  });

  it('the strictness region of the sibling is untouched by this card', () => {
    const sibling = fs.readFileSync(
      path.join(repoRoot, 'scripts', 'check-doc-snippet-types.mjs'),
      'utf8',
    );
    const banner = sibling.indexOf('── Fence scanning');
    expect(banner).toBeGreaterThan(0);
    // The region is licensed: this card may read it, never edit it. Pinned by
    // content rather than by hash so the failure names WHAT moved.
    expect(sibling.slice(banner)).toContain('export function scanFences(source)');
    expect(sibling.slice(banner)).toContain('export function compileSnippets(');
  });

  it('the walk uses the same tooling rule the other source-walking gates use', () => {
    const { files, excludedAsTooling } = listExampleSources(repoRoot);
    expect(files.some((f) => f.includes('__tests__'))).toBe(false);
    expect(excludedAsTooling.some((f) => f.includes('__tests__') || /\.test\./.test(f))).toBe(true);
  });
});

// ── wiring: a script nothing runs is not a gate (objectui#8757) ───────────────

/**
 * objectui#8757. Until that card this gate was declared in the root
 * `package.json` and invoked by NO workflow, while its sibling
 * `check-doc-snippet-types.mjs` was invoked by one. The cost is on the record
 * rather than assumed: a defect this gate catches reached `main` and was
 * repaired 71 minutes later with nothing observing in either direction, and the
 * card that reported the red was written from a stale merge base — because no
 * run existed to read. A whole dispatch round was spent on a premise that had
 * already been repaired before the card was filed.
 *
 * So the wiring is pinned, not merely done. Everything below is modelled on the
 * sibling's own `wiring` block for the same reasons that block gives, and reads
 * the YAML as text with whole-line comments removed — the headers in this
 * repository name other workflows and other scripts in prose.
 */
describe('wiring — the gate runs in CI, and in a workflow a docs-only pull request can start', () => {
  const GATE = 'scripts/check-doc-example-types.mjs';
  const SIBLING = 'scripts/check-doc-snippet-types.mjs';
  const HOME = 'repo-gates.yml';
  const workflowDir = path.join(repoRoot, '.github/workflows');
  const workflowFiles = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

  const yamlOf = (file: string): string =>
    fs
      .readFileSync(path.join(workflowDir, file), 'utf8')
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');

  it('has a workflow that gates pull requests, not just pushes', () => {
    expect(workflowFiles, 'the workflow directory scan returned implausibly few files').toContain(HOME);
    const yaml = yamlOf(HOME);
    expect(yaml, 'a check nothing runs is not a gate — objectui#8757').toContain(GATE);
    expect(yaml).toContain('pull_request:');
  });

  it('runs it in NO path-filtered workflow — an `@example` moves with the source it documents', () => {
    expect(workflowFiles.length, 'the workflow directory scan returned implausibly few files').toBeGreaterThan(5);
    for (const file of workflowFiles) {
      const yaml = yamlOf(file);
      if (!yaml.includes(GATE)) continue;
      expect(yaml, `${file} filters paths and would miss a change this gate exists to judge`).not.toMatch(
        /^\s*paths(-ignore)?:/m,
      );
    }
  });

  it('lives in exactly one workflow — one gate, one home', () => {
    expect(workflowFiles.filter((f) => yamlOf(f).includes(GATE))).toEqual([HOME]);
  });

  /**
   * The gate's exit `2` means THE GATE COULD NOT RUN — the packages are unbuilt
   * — and is neither green nor red. Invoked before its own build it would
   * return exactly that on every run, which is the counterfeit shape: a step
   * that runs, prints a page of text and judged nothing.
   */
  it('is invoked AFTER the build, so a precondition exit is not a state CI can reach', () => {
    const yaml = yamlOf(HOME);
    const build = yaml.indexOf('turbo run build');
    const invoke = yaml.search(new RegExp(`run: node ${GATE.replace(/[.\\/]/g, '\\$&')}\\s*$`, 'm'));
    expect(build, 'the workflow must build the packages the covered examples import').toBeGreaterThan(-1);
    expect(invoke, 'the workflow must invoke the gate itself').toBeGreaterThan(-1);
    expect(build, 'invoked before its own build, the gate would exit 2 on every run').toBeLessThan(invoke);
  });

  /**
   * Both gates block, so whichever is second is skipped when the first is red.
   * Ordering the newly wired gate FIRST would let it mask an established one —
   * the worse of the two directions, and the one this asserts against.
   */
  it('is invoked AFTER the sibling blocking gate, so a new gate cannot mask an established one', () => {
    const yaml = yamlOf(HOME);
    const sibling = yaml.search(new RegExp(`run: node ${SIBLING.replace(/[.\\/]/g, '\\$&')}\\s*$`, 'm'));
    const invoke = yaml.search(new RegExp(`run: node ${GATE.replace(/[.\\/]/g, '\\$&')}\\s*$`, 'm'));
    expect(sibling, 'the sibling blocking gate must still be invoked').toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(-1);
    expect(invoke).toBeGreaterThan(sibling);
  });

  /**
   * objectui#3653's discipline, applied by hand here: the page that inventories
   * this repository's gates must name the command a contributor can be stopped
   * by. `doc-snippet-types.yml` carries no `commandParity` unit in
   * `ci-cd-pipeline-doc.test.ts` — verified when this landed — so this stands in
   * for one rather than relying on a pin that does not cover the section.
   */
  it('is documented on the page that inventories the gates, by command', () => {
    const page = fs.readFileSync(
      path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'),
      'utf8',
    );
    expect(page, 'a contributor stopped by this gate must be able to find it').toContain(
      'pnpm check:doc-examples',
    );
    expect(page).toContain(GATE);
    // The by-command row, asserted as the whole row rather than by a regex that
    // could drift onto the prose mentions elsewhere in the same section.
    const row = page
      .split('\n')
      .filter((line) => line.startsWith('|') && line.includes('`pnpm check:doc-examples`'));
    expect(row, 'exactly one by-command table row must name this gate').toHaveLength(1);
    expect(row[0], 'the page must say the gate BLOCKS, not merely that it exists').toContain('**Yes**');
    expect(row[0]).toContain(GATE);
  });

  it('the root package.json alias and the workflow invoke the same script', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['check:doc-examples']).toBe(`node ${GATE}`);
    expect(yamlOf(HOME)).toContain(`run: node ${GATE}`);
  });
});
