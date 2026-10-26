import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  EMITTED_HOLE_DECLARATION,
  EMITTED_HOLE_PLACEHOLDER,
  EMITTED_IMPORT,
  EMITTED_MARKER,
  EMITTED_MARKER_EXAMPLE,
  EXIT_CODES,
  classifyEmittedDiagnostic,
  compileSnippets,
  declaresHolePlaceholder,
  derivePackageTypePaths,
  deriveEmittedManifestPaths,
  emittedCensus,
  emittedCensusSummary,
  emittedConstantTable,
  emittedManifestDeclarations,
  emittingPackageOf,
  listEmittedSources,
  scanEmittedTemplates,
} from '../check-doc-snippet-types.mjs';

/**
 * objectui#7864 — the emitted-code census.
 *
 * Code a generator EMITS from a template literal under `packages/NAME/src/**` is
 * compiled by nothing: `tsc` sees a string, `tsup` copies it through, and every
 * doc gate's scan surface stops short of `src/`. This file pins the instrument
 * that measures the class, and the three properties the card's binding
 * constraint turns on:
 *
 *   1. the recogniser is OPT-IN — an ordinary template literal is not compiled;
 *   2. the walk is NON-VACUOUS on the real tree, so a green census is a
 *      measurement rather than an empty set;
 *   3. a diagnostic on a recognised template is REPORTED and the exit code
 *      stays 0 — report-only is a ruling, and a census that could fail a build
 *      would have to be red today on objectui#7472's open site.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRIPT = 'scripts/check-doc-snippet-types.mjs';
const BACKTICK = '`';

/**
 * A `.ts` source whose exported function returns `body` from a template
 * literal. `marker`, when given, is written on the line immediately above the
 * template — where the census reads a declaration, the same place `scanFences`
 * reads a fragment marker.
 */
const emitterSource = (body: string, marker = ''): string =>
  `export function emit(): string {\n${marker ? `  ${marker}\n` : ''}  return ${BACKTICK}${body}${BACKTICK};\n}\n`;

function tempTree(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emitted-census-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  fs.mkdirSync(path.join(root, 'packages'), { recursive: true });
  return root;
}

/**
 * A tree holding one BUILT fixture package plus the four templates the ruling
 * asks to be told apart: one that compiles, one that does not, one that is not
 * recognised at all, and one hidden in a `TOOLING_FILE` path.
 */
function fixtureTree(): string {
  return tempTree({
    'package.json': JSON.stringify({ name: 'fixture-root' }),
    'packages/emitter/package.json': JSON.stringify({
      name: '@fixture/emitter',
      exports: { '.': { types: './dist/index.d.ts' } },
    }),
    'packages/emitter/dist/index.d.ts': 'export declare const real: number;\n',
    'packages/emitter/src/good.ts': emitterSource(
      "import { real } from '@fixture/emitter';\nexport const value = real;\n",
    ),
    'packages/emitter/src/bad.ts': emitterSource(
      "import { phantom } from '@fixture/emitter';\nexport const value = phantom;\n",
    ),
    'packages/emitter/src/plain.ts': emitterSource('SELECT * FROM users WHERE id = 1;\n'),
    'packages/emitter/src/__tests__/hidden.test.ts': emitterSource(
      "import { real } from '@fixture/emitter';\nexport const value = real;\n",
    ),
  });
}

/** The census, compiled the way the gate compiles it. */
function runCensus(root: string) {
  const census = emittedCensus({ root }) as unknown as {
    files: string[];
    excludedAsTooling: string[];
    templatesSeen: number;
    markerSeen: number;
    markerOnly: { file: string }[];
    moduleShapedMisses: string[];
    recognised: { file: string; line: number; holes: number; byHeuristic: boolean; marked: boolean }[];
    blocks: { doc: string; fenceLine: number; body: string }[];
  };
  const { paths } = derivePackageTypePaths(root) as unknown as { paths: Record<string, string[]> };
  const run = compileSnippets({ root, compiled: census.blocks, paths, declaredSpecifiers: [] }) as unknown as {
    semanticFailures: { block: { doc: string }; diagnostics: { code: number }[] }[];
    parseFailures: { block: { doc: string } }[];
    boundFailures: { block: { doc: string } }[];
    semanticallyJudged: number;
  };
  return { census, run };
}

describe('the recogniser is opt-in — an ordinary template literal is not compiled', () => {
  it('recognises the import-bearing templates and leaves the plain one alone', () => {
    const { census } = runCensus(fixtureTree());
    const sites = census.recognised.map((r) => r.file).sort();
    expect(sites).toEqual(['packages/emitter/src/bad.ts', 'packages/emitter/src/good.ts']);
    expect(
      sites,
      'a template with no import is not code this gate has any business compiling — without ' +
        'this control the census would be judging the corpus SQL, CSS and prose',
    ).not.toContain('packages/emitter/src/plain.ts');
  });

  it('excludes TOOLING_FILE paths by the rule check-phantom-dependencies.mjs already owns', () => {
    const { census } = runCensus(fixtureTree());
    expect(census.excludedAsTooling).toEqual(['packages/emitter/src/__tests__/hidden.test.ts']);
    expect(census.recognised.map((r) => r.file)).not.toContain(
      'packages/emitter/src/__tests__/hidden.test.ts',
    );
  });

  it('counts the excluded population instead of dropping it — a member in a fixture is its own fact', () => {
    const { census } = runCensus(fixtureTree());
    expect(census.excludedAsTooling.length).toBe(1);
  });

  it('honours the marker, so a template the heuristic cannot see is opted in by one comment', () => {
    const root = tempTree({
      'package.json': JSON.stringify({ name: 'fixture-root' }),
      'packages/emitter/package.json': JSON.stringify({ name: '@fixture/emitter' }),
      'packages/emitter/src/marked.ts': emitterSource(
        'export const emitted = 1;\n',
        EMITTED_MARKER_EXAMPLE,
      ),
    });
    const { census } = runCensus(root);
    expect(census.recognised.map((r) => r.file)).toEqual(['packages/emitter/src/marked.ts']);
    expect(census.markerOnly.map((r) => r.file)).toEqual(['packages/emitter/src/marked.ts']);
    expect(
      census.recognised[0].byHeuristic,
      'this template carries no import — it is in the census because the marker put it there',
    ).toBe(false);
  });

  it('keeps ONE vocabulary with the fragment marker', () => {
    expect(EMITTED_MARKER_EXAMPLE).toContain('doc-snippet:');
    expect(EMITTED_MARKER.test(EMITTED_MARKER_EXAMPLE)).toBe(true);
    expect(EMITTED_MARKER.test('// doc-snippet: emits tsx')).toBe(true);
    expect(EMITTED_MARKER.test('/* doc-snippet: fragment - a doc block, not an emitter */')).toBe(false);
  });

  it('bounds the heuristic, so a long template with no import does not find a distant `from`', () => {
    expect(EMITTED_IMPORT.test("import { a } from 'b';")).toBe(true);
    expect(EMITTED_IMPORT.test("import 'side-effect';")).toBe(true);
    expect(EMITTED_IMPORT.test('import {\n  a,\n  b,\n} from "c";')).toBe(true);
    expect(EMITTED_IMPORT.test('const x = 1;\n')).toBe(false);
    expect(
      EMITTED_IMPORT.test(`import java.util;\n${'// filler\n'.repeat(60)}const from = 'x';\n`),
      'unbounded, the lazy search would reach a `from` hundreds of lines below an `import` that ' +
        'is not one, and every long template in the corpus would recognise',
    ).toBe(false);
  });
});

describe('a diagnostic on a recognised template is REPORTED, and nothing fails', () => {
  it('reports the phantom import and leaves the compiling one clean', () => {
    const { run } = runCensus(fixtureTree());
    expect(run.semanticFailures.map((f) => f.block.doc)).toEqual(['packages/emitter/src/bad.ts']);
    expect(run.semanticFailures[0].diagnostics.map((d) => d.code)).toContain(2305);
    expect(run.semanticallyJudged, 'both recognised templates reached the semantic phase').toBe(2);
  });

  it('points the diagnostic at the real source line, not one line past it', () => {
    const root = fixtureTree();
    const { census, run } = runCensus(root);
    const bad = census.recognised.find((r) => r.file === 'packages/emitter/src/bad.ts');
    const block = run.semanticFailures[0].block as unknown as { fenceLine: number };
    expect(
      block.fenceLine + 1,
      "a fenced block's body starts on the line AFTER its fence; a template literal's starts ON " +
        'its backtick, so the anchor is one line earlier and the printed number is the real line',
    ).toBe(bad!.line);
  });

  it('exits 0 on findings and NEVER 1 — report-only is the card\'s ruling, not an oversight', () => {
    // Both halves of the contract, and which one runs where. On a BUILT tree
    // this is the positive control the ruling asks for: real diagnostics are
    // printed and the status is still 0. In the unit-test job, which does not
    // build this gate's closure, the run leaves through `couldNotRun` instead —
    // which is the OTHER half worth pinning: an unbuilt tree is "I could not
    // run", and neither state is ever `documentsFailed`.
    const result = spawnSync('node', [SCRIPT, '--emit-census'], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 300_000,
    });
    expect(
      result.status,
      `the census may never exit ${EXIT_CODES.documentsFailed} ("I ran and found errors"): a finding ` +
        'here is a census row, and objectui#7472\'s site is an OPEN card this PR may not fix.\n' +
        `${result.stdout ?? ''}\n${result.stderr ?? ''}`,
    ).not.toBe(EXIT_CODES.documentsFailed);
    expect([EXIT_CODES.verified, EXIT_CODES.couldNotRun]).toContain(result.status);
    if (result.status === EXIT_CODES.verified) {
      expect(result.stdout).toContain('Emitted-code census (report-only, objectui#7864)');
      expect(result.stdout).toContain('REPORT-ONLY');
      expect(
        result.stdout,
        'on this corpus the census has findings; a run that printed none would mean the ' +
          'recogniser stopped recognising, not that the corpus got clean',
      ).toMatch(/\[(semantic|syntax|bound)]/);
    }
  }, 300_000);

  it('leaves the documentation verdict untouched — the flag is the whole of the change', () => {
    const source = fs.readFileSync(path.join(repoRoot, SCRIPT), 'utf8');
    expect(source).toContain("argv.includes('--emit-census')");
    expect(
      source.indexOf("argv.includes('--emit-census')"),
      'the census must run AFTER the precondition gate: it compiles against the same built ' +
        'closure, so an unbuilt tree is "I could not run" for it too',
    ).toBeGreaterThan(source.indexOf('const blocking = blockingPreconditions(state.findings);'));
  });
});

describe('`${…}` holes are substituted by a stated placeholder', () => {
  it('substitutes every hole and keeps the literal text around them', () => {
    const templates = scanEmittedTemplates(
      `const a = ${BACKTICK}const schema = \${json};\nexport class \${name}Plugin {}${BACKTICK};\n`,
    ) as unknown as { text: string; holes: number }[];
    expect(templates).toHaveLength(1);
    expect(templates[0].holes).toBe(2);
    expect(templates[0].text).toBe(
      `const schema = ${EMITTED_HOLE_PLACEHOLDER};\nexport class ${EMITTED_HOLE_PLACEHOLDER}Plugin {}`,
    );
  });

  it('uses an IDENTIFIER, because the corpus interpolates inside identifiers too', () => {
    expect(
      /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(EMITTED_HOLE_PLACEHOLDER),
      'an expression-shaped placeholder (`null`, `0 as any`) is a syntax error in `${name}Plugin`',
    ).toBe(true);
  });

  it('declares the placeholder with `var`, never a block-scoped binding', () => {
    expect(EMITTED_HOLE_DECLARATION).toBe(`declare var ${EMITTED_HOLE_PLACEHOLDER}: any;`);
    expect(
      EMITTED_HOLE_DECLARATION,
      'a block-scoped declaration read above its own line is TS2448 — a diagnostic the ' +
        'instrument would have invented',
    ).not.toMatch(/\b(const|let)\b/);
  });

  it('appends the declaration, so every diagnostic line number still points at the source', () => {
    const root = tempTree({
      'package.json': JSON.stringify({ name: 'fixture-root' }),
      'packages/emitter/package.json': JSON.stringify({ name: '@fixture/emitter' }),
      'packages/emitter/src/holes.ts': emitterSource("import 'x';\nconst schema = ${json};\n"),
    });
    const { census } = runCensus(root);
    expect(census.blocks).toHaveLength(1);
    expect(census.blocks[0].body.startsWith("import 'x';")).toBe(true);
    expect(census.blocks[0].body.trimEnd().endsWith(EMITTED_HOLE_DECLARATION)).toBe(true);
  });

  it('skips the declaration when the placeholder is itself a declared name', () => {
    // `export const ${vars.pascalName}` becomes `export const __hole__`, and a
    // declaration beside it is TS2395 — measured on
    // `packages/create-plugin/src/templates.ts` before this guard existed.
    expect(declaresHolePlaceholder(`export const ${EMITTED_HOLE_PLACEHOLDER} = 1;\n`)).toBe(true);
    expect(declaresHolePlaceholder(`export const value = ${EMITTED_HOLE_PLACEHOLDER};\n`)).toBe(false);
    expect(
      declaresHolePlaceholder('this is not typescript at all ### <<<\n'),
      'a body that does not parse never reaches the semantic phase, so it needs no declaration',
    ).toBe(true);
  });

  it('descends into a hole\'s expression, so a nested emitter is censused in its own right', () => {
    const templates = scanEmittedTemplates(
      `const a = ${BACKTICK}outer \${${BACKTICK}import 'inner';${BACKTICK}} end${BACKTICK};\n`,
    ) as unknown as { text: string }[];
    expect(templates).toHaveLength(2);
    expect(templates.map((t) => t.text)).toContain("import 'inner';");
  });
});

describe('the census reports what it cannot see, and separates its own artefacts', () => {
  it('classifies an interpolated specifier, a sibling and a real diagnostic apart', () => {
    const chain = (code: number, text: string) => ({ code, messageText: text });
    expect(
      classifyEmittedDiagnostic(
        chain(2307, `Cannot find module './schemas/${EMITTED_HOLE_PLACEHOLDER}' or its corresponding type declarations.`),
      ),
    ).toBe('interpolated');
    expect(classifyEmittedDiagnostic(chain(2307, "Cannot find module './App' or its corresponding type declarations."))).toBe(
      'sibling',
    );
    expect(
      classifyEmittedDiagnostic(chain(2882, "Cannot find module or type declarations for side-effect import of './index.css'.")),
    ).toBe('sibling');
    expect(classifyEmittedDiagnostic(chain(2307, "Cannot find module 'vite-plugin-dts'."))).toBe('code');
    expect(
      classifyEmittedDiagnostic(chain(2769, "No overload matches this call.")),
      'anything that is not a module-not-found is a fact about the emitted code',
    ).toBe('code');
  });

  it('prints the blind side beside the recognised count', () => {
    const root = fixtureTree();
    const { census, run } = runCensus(root);
    const { packageDirOf } = derivePackageTypePaths(root) as unknown as {
      packageDirOf: Record<string, string>;
    };
    const summary = (emittedCensusSummary(census, run, packageDirOf) as unknown as string[]).join('\n');
    expect(summary).toContain('Walked');
    expect(summary).toContain('Recognised');
    expect(
      summary,
      'a census that cannot see what it excludes is not a census — the opt-in route\'s ' +
        'population and the templates NEITHER route reaches are printed every run',
    ).toContain('Blind side');
    expect(summary).toContain('Judged');
    expect(summary).toContain('Diagnostics');
  });

  it('keys the per-package split by DIRECTORY as well as name — on this tree they disagree', () => {
    expect(
      emittingPackageOf('packages/vscode-extension/src/extension.ts', {
        'object-ui': 'packages/vscode-extension',
      }),
      'packages/vscode-extension publishes as `object-ui`; a split keyed on the name alone ' +
        'prints a row nobody can find on disk',
    ).toBe('packages/vscode-extension (object-ui)');
  });
});

describe('on this repository — the walk is non-vacuous and reaches both known members', () => {
  const census = emittedCensus({ root: repoRoot }) as unknown as {
    files: string[];
    excludedAsTooling: string[];
    templatesSeen: number;
    recognised: { file: string; line: number }[];
    blocks: { doc: string }[];
  };

  it('walks a real population, so a green census is a measurement rather than an empty set', () => {
    expect(
      census.files.length,
      'the walk collapsed — every count the census prints would be a zero that means nothing',
    ).toBeGreaterThan(500);
    expect(census.excludedAsTooling.length).toBeGreaterThan(100);
    expect(census.templatesSeen).toBeGreaterThan(500);
  });

  it('recognises at least the two members objectui#7864 names', () => {
    const sites = new Set(census.recognised.map((r) => r.file));
    expect(
      sites,
      'PR objectui#7863 fixed this one; the census must still SEE it, or nothing would notice ' +
        'the phantom import coming back',
    ).toContain('packages/vscode-extension/src/extension.ts');
    expect(
      sites,
      'objectui#7472 is the known UNFIXED member. The card requires the census to show it; ' +
        'it does not permit this PR to fix it, and that is why the gate is report-only.',
    ).toContain('packages/cli/src/utils/app-generator.ts');
    expect(census.recognised.length).toBeGreaterThanOrEqual(2);
  });

  it('names objectui#7472\'s site at the path it actually occupies', () => {
    // The card writes `packages/cli/src/app-generator.ts`; the file is one
    // directory deeper. Pinned so the next reader does not re-derive it.
    expect(fs.existsSync(path.join(repoRoot, 'packages/cli/src/utils/app-generator.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'packages/cli/src/app-generator.ts'))).toBe(false);
  });

  it('lets no TOOLING_FILE path into the compiled set', () => {
    for (const block of census.blocks) {
      expect(block.doc).not.toMatch(/(^|\/)(__tests__|__mocks__|__benchmarks__)\//);
      expect(block.doc).not.toMatch(/\.(test|spec|bench|stories)\.[cm]?[jt]sx?$/);
    }
  });

  it('collects only source files under a package src/', () => {
    const { files } = listEmittedSources(repoRoot) as unknown as { files: string[] };
    for (const file of files.slice(0, 50)) {
      expect(file).toMatch(/^packages\/[^/]+\/src\/.+\.tsx?$/);
    }
  });
});

describe('wiring — a census nothing runs is not a census', () => {
  const workflow = fs.readFileSync(
    path.join(repoRoot, '.github/workflows/repo-gates.yml'),
    'utf8',
  );

  it('runs the census in the workflow that already builds this gate\'s closure', () => {
    expect(workflow).toContain('--emit-census');
  });

  it('runs it AFTER the build and BEFORE the blocking gate, so a red gate cannot hide the number', () => {
    const build = workflow.indexOf('turbo run build');
    const census = workflow.indexOf(`node ${SCRIPT} --emit-census`);
    const gate = workflow.search(new RegExp(`run: node ${SCRIPT.replace(/[.\\/]/g, '\\$&')}\\s*$`, 'm'));
    expect(build).toBeGreaterThan(-1);
    expect(census).toBeGreaterThan(build);
    expect(
      census,
      'the number is meant to be re-read on every run; placed after the blocking step it would ' +
        'be skipped on exactly the runs where the corpus moved',
    ).toBeLessThan(gate);
  });

  it('is written up on the page objectui#3653 pins, and declared report-only there', () => {
    const doc = fs.readFileSync(path.join(repoRoot, 'content/docs/guide/ci-cd-pipeline.md'), 'utf8');
    expect(doc).toContain('--emit-census');
    const row = doc.split('\n').find((line) => line.includes('--emit-census'));
    expect(row, 'the page must say what it runs').toBeDefined();
    // The paragraph the command lives in, bounded by its own blank lines: a
    // byte window would pass on a `report-only` belonging to another section.
    const at = doc.indexOf('--emit-census');
    const start = doc.lastIndexOf('\n\n', at);
    const end = doc.indexOf('\n\n', at);
    // Whitespace-normalised: this page hard-wraps, so a sentence that must be
    // present is split across lines in the source and matches nothing verbatim.
    const paragraph = doc
      .slice(start, end === -1 ? doc.length : end)
      .toLowerCase()
      .replace(/\s+/g, ' ');
    expect(
      paragraph,
      'a step the page does not declare report-only is a guardrail readers believe in',
    ).toContain('report-only');
    expect(paragraph).toContain('exits 0 regardless of what it finds');
  });
});

/**
 * objectui#8397 — the manifest the emitted file's READER installs.
 *
 * The root bound refuses a specifier that reaches a snippet only through this
 * workspace's own installation, "not through anything the emitted file's reader
 * installs". For a GENERATOR that premise can be false: the same generator also
 * writes the reader's `package.json`. These pin the three properties that make
 * reading it a narrowing of the bound's PREMISE rather than a hole in the bound:
 * the manifest is read from the AST (not executed), it is scoped to the emitting
 * package, and a specifier is mapped only at an identical declared range.
 *
 * ⛔ The one thing they must never pin: a census that reads cleaner because less
 * of it is compiled. Every assertion here is about a block JOINING the semantic
 * program.
 */
describe("objectui#8397 — the manifest the emitted file's reader installs", () => {
  const DEP = 'fixture-only-dep';
  /**
   * The gate's own ROOT-DECLARED control specifier, pinned here because the
   * fixture has to INSTALL it for the control to mean anything: a specifier that
   * resolves nowhere would produce TS2307 whether the bound ran or not.
   */
  const ROOT_DECLARED_CONTROL = 'vitest';

  /**
   * A tree whose ROOT declares `fixture-only-dep` (so the bound bites) and whose
   * `packages/emitter` generator emits a manifest declaring it too. The ranges
   * are parameters because range equality is the whole of the mapping rule.
   *
   * The dev-dependency map lives in a SECOND file and arrives in the manifest by
   * spread — the shape `packages/cli` actually has, and the one a same-file
   * reader would drop the manifest for.
   */
  function generatorTree({
    rootRange = '^1.0.0',
    emittedRange = '^1.0.0',
    manifestFields = "name: 'generated',\n    version: '0.1.0',",
    secondPackage = true,
  } = {}): string {
    const files: Record<string, string> = {
      'package.json': JSON.stringify({
        name: 'fixture-root',
        devDependencies: { [DEP]: rootRange, [ROOT_DECLARED_CONTROL]: '^4.0.0' },
      }),
      [`node_modules/${ROOT_DECLARED_CONTROL}/package.json`]: JSON.stringify({
        name: ROOT_DECLARED_CONTROL,
        version: '4.0.0',
        types: './index.d.ts',
      }),
      [`node_modules/${ROOT_DECLARED_CONTROL}/index.d.ts`]: 'export declare const control: number;\n',
      // The gate reads "is it installed?" from pnpm's virtual store, so the
      // fixture lays one out: an UNINSTALLED control produces TS2307 whether the
      // bound ran or not, and would pin nothing. The store is the WORKSPACE
      // root's (objectstack#25733), so the fixture is one.
      'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
      [`node_modules/.pnpm/${ROOT_DECLARED_CONTROL}@4.0.0/node_modules/${ROOT_DECLARED_CONTROL}/package.json`]:
        JSON.stringify({ name: ROOT_DECLARED_CONTROL, version: '4.0.0', types: './index.d.ts' }),
      [`node_modules/.pnpm/${ROOT_DECLARED_CONTROL}@4.0.0/node_modules/${ROOT_DECLARED_CONTROL}/index.d.ts`]:
        'export declare const control: number;\n',
      [`node_modules/${DEP}/package.json`]: JSON.stringify({
        name: DEP,
        version: '1.0.0',
        types: './index.d.ts',
      }),
      [`node_modules/${DEP}/index.d.ts`]: 'export declare const fixture: number;\n',
      'packages/emitter/package.json': JSON.stringify({ name: '@fixture/emitter' }),
      'packages/emitter/src/ranges.ts':
        `export const DEV_DEPENDENCIES: Record<string, string> = {\n  '${DEP}': '${emittedRange}'\n};\n`,
      'packages/emitter/src/templates.ts':
        "import { DEV_DEPENDENCIES } from './ranges';\n\n" +
        'export function buildPackageJson(): Record<string, unknown> {\n' +
        `  return {\n    ${manifestFields}\n    devDependencies: { ...DEV_DEPENDENCIES }\n  };\n}\n\n` +
        'export function buildTestFile(): string {\n  return ' +
        BACKTICK +
        `import { fixture } from '${DEP}';\nexport const value = fixture;\n` +
        BACKTICK +
        ';\n}\n',
    };
    if (secondPackage) {
      files['packages/other/package.json'] = JSON.stringify({ name: '@fixture/other' });
      files['packages/other/src/templates.ts'] =
        'export function buildOther(): string {\n  return ' +
        BACKTICK +
        `import { fixture } from '${DEP}';\nexport const value = fixture;\n` +
        BACKTICK +
        ';\n}\n';
    }
    return tempTree(files);
  }

  function runWithManifests(root: string) {
    const census = emittedCensus({ root }) as unknown as { blocks: { doc: string }[] };
    const { paths, packageDirOf } = derivePackageTypePaths(root) as unknown as {
      paths: Record<string, string[]>;
      packageDirOf: Record<string, string>;
    };
    const manifests = emittedManifestDeclarations({ root }) as unknown as {
      byPackage: Record<string, Record<string, string>>;
      sites: string[];
      unreadable: { detail: string }[];
      ambiguous: string[];
    };
    const mapped = deriveEmittedManifestPaths(root, manifests.byPackage, packageDirOf) as unknown as {
      pathsByPackage: Record<string, Record<string, string[]>>;
      anchored: { emitter: string; specifier: string; anchor: string }[];
      unresolvable: { emitter: string; specifier: string; detail: string }[];
    };
    const run = compileSnippets({
      root,
      compiled: census.blocks,
      paths,
      declaredSpecifiers: [],
      extraPathsByPackage: mapped.pathsByPackage,
    }) as unknown as {
      boundFailures: { block: { doc: string }; specifiers: string[] }[];
      semanticFailures: { block: { doc: string }; diagnostics: { code: number }[] }[];
      semanticallyJudged: number;
      rootDeclaredDiagnostics: { code: number }[];
      rootDeclaredControl: string;
      rootDeclaredInstalledAt: string | null;
    };
    return { census, manifests, mapped, run };
  }

  it('reads a manifest a FUNCTION returns as an object — the feasibility question the card left open', () => {
    const { manifests } = runWithManifests(generatorTree());
    expect(
      manifests.byPackage['packages/emitter'],
      '`buildPackageJson` returns an object, not a template literal. That is not a blocker: the ' +
        'census already parses these files, and the object literal is read from the same tree.',
    ).toEqual({ [DEP]: '^1.0.0' });
    expect(manifests.sites).toHaveLength(1);
    expect(manifests.sites[0]).toMatch(/^packages\/emitter\/src\/templates\.ts:\d+$/);
  });

  it('follows a dependency map spread in from another file of the SAME package', () => {
    const { manifests } = runWithManifests(generatorTree());
    expect(Object.keys(manifests.byPackage['packages/emitter'])).toEqual([DEP]);
  });

  it('moves the refused template INTO the semantic program — the count that changes is `judged`', () => {
    const root = generatorTree();
    const before = (() => {
      const census = emittedCensus({ root }) as unknown as { blocks: { doc: string }[] };
      const { paths } = derivePackageTypePaths(root) as unknown as { paths: Record<string, string[]> };
      return compileSnippets({ root, compiled: census.blocks, paths, declaredSpecifiers: [] }) as unknown as {
        boundFailures: { block: { doc: string } }[];
        semanticallyJudged: number;
      };
    })();
    const after = runWithManifests(root);

    expect(
      before.boundFailures.map((f) => f.block.doc).sort(),
      'without the emitted manifest BOTH templates are refused for a specifier the root declares',
    ).toEqual(['packages/emitter/src/templates.ts', 'packages/other/src/templates.ts']);
    expect(after.run.semanticallyJudged).toBe(before.semanticallyJudged + 1);
    expect(
      after.census.blocks.length,
      '⛔ the standing fence: nothing may be removed from what is compiled. The recognised ' +
        'population is identical and only the JUDGED count moved, upward.',
    ).toBe(2);
  });

  it("is scoped to the EMITTING package — one generator's manifest does not speak for another's", () => {
    const { run } = runWithManifests(generatorTree());
    expect(
      run.boundFailures.map((f) => f.block.doc),
      'a merged map would have silenced the bound for a package that emits no manifest at all — ' +
        'the same failure being fixed, one level up',
    ).toEqual(['packages/other/src/templates.ts']);
  });

  it('keeps the ROOT-DECLARED control refused in the very program where the emitter resolves it', () => {
    const { run } = runWithManifests(generatorTree());
    expect(
      run.rootDeclaredControl,
      'the fixture installs this specifier on purpose; if the gate picks another one the ' +
        'fixture must install THAT one, or this control stops proving anything',
    ).toBe(ROOT_DECLARED_CONTROL);
    expect(run.rootDeclaredInstalledAt, 'an uninstalled control proves nothing').toBeTruthy();
    expect(
      run.rootDeclaredDiagnostics.map((d) => d.code),
      'the control file carries no emitted-manifest map, so the bound must still bite there — ' +
        'the two facts have to hold together or the map is an exemption wearing a rule\'s clothes',
    ).toContain(2307);
  });

  it('maps ONLY at an identical declared range, and reports the mismatch instead of guessing', () => {
    const { mapped, run } = runWithManifests(
      generatorTree({ rootRange: '^1.0.0', emittedRange: '^2.0.0' }),
    );
    expect(mapped.anchored).toEqual([]);
    expect(mapped.unresolvable.map((u) => [u.specifier, u.detail])).toEqual([
      [DEP, 'no manifest here declares that range'],
    ]);
    expect(
      run.boundFailures.map((f) => f.block.doc).sort(),
      'a range this repository does not declare would be judged against types the reader never ' +
        'installs — the refusal is the honest answer, and the summary prints why',
    ).toEqual(['packages/emitter/src/templates.ts', 'packages/other/src/templates.ts']);
  });

  it('names the anchor it mapped through, so the evidence is readable off the run', () => {
    const { mapped } = runWithManifests(generatorTree());
    expect(mapped.anchored).toEqual([
      { emitter: 'packages/emitter', specifier: DEP, range: '^1.0.0', anchor: '.' },
    ]);
  });

  it('requires `name` and `version` — narrow in the safe direction', () => {
    const { manifests, run } = runWithManifests(
      generatorTree({ manifestFields: "private: true," }),
    );
    expect(
      manifests.byPackage,
      'a bare `{ devDependencies: … }` is some other object. Missing a real manifest costs a ' +
        'refusal, which is the status quo; admitting a non-manifest widens the bound.',
    ).toEqual({});
    expect(run.boundFailures.length).toBe(2);
  });

  it('reports a range it cannot read to a literal, and maps nothing for it', () => {
    const root = tempTree({
      'package.json': JSON.stringify({ name: 'fixture-root', devDependencies: { [DEP]: '^1.0.0' } }),
      'packages/emitter/package.json': JSON.stringify({ name: '@fixture/emitter' }),
      'packages/emitter/src/templates.ts':
        'declare function rangeOf(name: string): string;\n' +
        'export function buildPackageJson(): Record<string, unknown> {\n' +
        `  return { name: 'g', version: '0.1.0', dependencies: { '${DEP}': rangeOf('x') } };\n}\n`,
    });
    const manifests = emittedManifestDeclarations({ root }) as unknown as {
      byPackage: Record<string, unknown>;
      unreadable: { detail: string; specifier?: string }[];
    };
    expect(manifests.byPackage).toEqual({});
    expect(manifests.unreadable).toEqual([
      {
        site: expect.stringMatching(/^packages\/emitter\/src\/templates\.ts:\d+$/),
        field: 'dependencies',
        specifier: DEP,
        detail: 'the range is not a literal',
      },
    ]);
  });

  it('follows no name a package declares twice — a guess here maps the wrong version', () => {
    const root = tempTree({
      'package.json': JSON.stringify({ name: 'fixture-root', devDependencies: { [DEP]: '^1.0.0' } }),
      'packages/emitter/package.json': JSON.stringify({ name: '@fixture/emitter' }),
      'packages/emitter/src/one.ts': `export const DEV_DEPENDENCIES = { '${DEP}': '^1.0.0' };\n`,
      'packages/emitter/src/two.ts': `export const DEV_DEPENDENCIES = { '${DEP}': '^2.0.0' };\n`,
      'packages/emitter/src/templates.ts':
        "import { DEV_DEPENDENCIES } from './one';\n" +
        'export function buildPackageJson(): Record<string, unknown> {\n' +
        "  return { name: 'g', version: '0.1.0', devDependencies: { ...DEV_DEPENDENCIES } };\n}\n",
    });
    const manifests = emittedManifestDeclarations({ root }) as unknown as {
      byPackage: Record<string, unknown>;
      ambiguous: string[];
      unreadable: { detail: string }[];
    };
    expect(manifests.ambiguous).toEqual(['packages/emitter: DEV_DEPENDENCIES']);
    expect(
      manifests.byPackage,
      'a name two files define is two answers to one question, and either choice maps a range ' +
        'the reader may not install',
    ).toEqual({});
    expect(manifests.unreadable.map((u) => u.detail)).toEqual([
      'spread of `DEV_DEPENDENCIES` cannot be followed',
    ]);
  });

  it('exposes the constant table it followed, unique names only', () => {
    const table = emittedConstantTable([]) as unknown as { table: Map<string, unknown>; ambiguous: string[] };
    expect(table.ambiguous).toEqual([]);
    expect(table.table.size).toBe(0);
  });

  it('on THIS repository — reads create-plugin\'s own emitted manifest', () => {
    const manifests = emittedManifestDeclarations({ root: repoRoot }) as unknown as {
      byPackage: Record<string, Record<string, string>>;
      sites: string[];
    };
    const emitted = manifests.byPackage['packages/create-plugin'];
    expect(
      emitted,
      '`buildPackageJson` is the manifest a scaffolded plugin installs; these six specifiers are ' +
        'exactly the ones the census used to refuse its own generator for',
    ).toBeDefined();
    for (const specifier of [
      '@testing-library/jest-dom',
      '@testing-library/react',
      'vitest',
      'vite',
      'vite-plugin-dts',
      '@vitejs/plugin-react',
    ]) {
      expect(emitted, `${specifier} is declared by the generated package.json`).toHaveProperty(specifier);
    }
    expect(manifests.sites.some((s) => s.startsWith('packages/create-plugin/src/templates.ts:'))).toBe(true);
  });
});
