// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 50 — compiles the package type graph once: the lib and @objectstack/spec declaration files are parsed and bound once in this worker and shared by one TypeScript Program per emitted scaffold (each `os init` template, each `os g` generator, and the canary), each with its own tsconfig and diagnostics, instead of one `tsc` child per case; the file also imports the init and generate command modules to derive both rosters; slowest CI reading 33.0 s (run 41199450735, over the five scheduled ci.yml runs 41199450735 to 41271604267, one tsc child per case) x 1.25, rounded up

/**
 * PIN (#15976) — every scaffold this package emits must survive the
 * `tsc --noEmit` that the emitted project's OWN `typecheck` script runs.
 *
 * ## The defect
 *
 * `os init -t app`, `os init -t plugin` and `os g object` all wrote the same
 * annotation into the object file they emit:
 *
 *     import * as Data from '@objectstack/spec/data';
 *     const myAppItem: Data.Object = { … };
 *
 * `@objectstack/spec/data` exports no member named `Object`. So the primary
 * scaffolder — the first command a new user runs — produced a project that
 * fails its own `pnpm typecheck`:
 *
 *     error TS2694: Namespace '…/@objectstack/spec/dist/data/index'
 *                   has no exported member 'Object'
 *     tsc exit 2
 *
 * Measured on the PUBLISHED tarball (`npm pack @objectstack/spec@17.3.0`,
 * extracted and linked into a driven emission), which is what a real user
 * installs, and identically at TypeScript 5.3.3, 5.8.3 and 6.0.3 — so it was
 * never a compiler-version effect. The repair is `Data.ServiceObject`, the
 * `z.input` authoring type that `object.zod.ts` has always exported and that
 * the hand-written docs already used (`concepts/metadata-driven.mdx`,
 * `getting-started/quick-reference.mdx`). Nothing was added to the spec.
 *
 * The object scaffolds have since moved off the annotation altogether: they
 * declare through `ObjectSchema.create({ … })`, the one authorised shape for a
 * `*.object.ts` (ruling 5644350230), whose return type is derived from the
 * declaration it validates. This pin is unchanged by that — the other
 * generators still annotate with namespace members (`UI.View`,
 * `Automation.Flow`, …), and the factory's VALUE import from
 * `@objectstack/spec/data` is exactly what this sandbox has to resolve.
 *
 * ## ⭐ Why every existing scaffold pin was green through it
 *
 * This package already had two scaffold sweeps, and NEITHER could see this
 * defect — not by omission, but by construction:
 *
 *   `generate-scaffold-validates.test.ts`   loads each scaffold via
 *                                           `bundle-require`
 *   `init-scaffold-authoring-rules.test.ts` loads each template via the
 *                                           command's own `validateScaffold`
 *
 * Both are RUNTIME pins: they materialize the TypeScript and then execute it.
 * The loader underneath is esbuild, which **erases type annotations without
 * checking them**. `const x: Data.Object = {…}` and `const x: Data.Whatever =
 * {…}` transpile to byte-identical JavaScript, so a broken annotation is
 * invisible to every runtime-shaped assertion this package can write. The
 * scaffolds genuinely did parse, validate and load — they simply did not
 * COMPILE, and nothing here had ever asked a compiler.
 *
 * That is the gap this file fills, and it is why it runs the TypeScript
 * compiler over a materialized project instead of importing the module. The
 * type layer is a separate axis from the schema layer, and it needs its own
 * instrument.
 *
 * ## One compiler, one Program per sandbox
 *
 * Each sandbox is compiled as its OWN Program, from its own `tsconfig.json`,
 * with the diagnostics `tsc --noEmit -p <root>` reports — so a case still asks
 * exactly "does this emitted project pass its own `typecheck` script", and no
 * scaffold can lean on another's declarations. What the sandboxes share is the
 * read-only part every one of them used to redo in its own `tsc` child: the
 * parsed and bound `lib.*.d.ts` and `@objectstack/spec` declaration files,
 * held in one source-file cache (the compiler's own reuse model: the language
 * service shares source files across programs the same way). The compiler is
 * the `typescript` package `typescript/bin/tsc` resolves to, loaded once in
 * this worker instead of once per case.
 *
 * ## The rosters are derived, both of them
 *
 * `TEMPLATES` (what `os init` emits) and `GENERATOR_SCAFFOLD_TARGETS` (what
 * `os g` emits, itself derived from `GENERATORS`) are read directly. A
 * template or generator added tomorrow is type-checked on the day it lands,
 * not the day somebody remembers to extend a hand-kept list — the same reason
 * the two sibling sweeps derive their rosters.
 *
 * ## The compiler options are the scaffolder's own
 *
 * The `tsconfig.json` each sandbox gets comes from `renderScaffoldTsconfig`,
 * the renderer `init` writes the real file with. Restating the options here
 * would let this pin drift into type-checking under a profile no user has —
 * `moduleResolution: 'bundler'` in particular is what resolves the
 * `@objectstack/spec/data` subpath at all, so a restatement that lost it would
 * turn every case into TS2307 or, worse, green over an unresolved module.
 *
 * ## The canary — what makes this a reading that CAN fail
 *
 * A tsc harness that resolves nothing, or discovers no files, reports zero
 * errors and reads exactly like a pass. So `CANARY` compiles a deliberately
 * absent member of the SAME namespace under the SAME profile and is asserted
 * to fail with TS2694 — the incident's own error code. Red there proves the
 * sandbox resolves `@objectstack/spec/data`, that tsc reaches the file, and
 * that this exact defect class surfaces. If the canary ever reports TS2307
 * instead, the spec package's `dist/` is not built and no verdict below means
 * anything; build it with `pnpm --filter '@objectstack/cli^...' build`.
 *
 * ## Sandbox placement
 *
 * Under this package's own `node_modules`, the placement
 * `generate-scaffold-validates.test.ts` measured and documented: git-ignored
 * (a materialized scaffold is a build artifact, not a fixture), and beneath
 * `packages/cli`, so an emitted `import … from '@objectstack/spec/…'` resolves
 * by the ordinary upward walk exactly as it does for a real user's project.
 * ⛔ Not `os.tmpdir()`: nothing up the tree from there resolves the spec
 * package, and every case would degrade to TS2307.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  TEMPLATES,
  sanitizeNamespace,
  writeTemplateSrcFiles,
  renderScaffoldTsconfig,
  SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG,
  SCAFFOLD_TSCONFIG_INCLUDE_SRC_ONLY,
} from '../src/commands/init.js';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { probeBindings } from './helpers/scaffold-bindings.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** See the docblock's "Sandbox placement". */
const TMP_ROOT = fs.mkdtempSync(
  path.join(HERE, '..', 'node_modules', '.scaffold-typecheck-'),
);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** The project name / artifact stem every case below is driven with. */
const PROJECT_NAME = 'my-app';
const STEM = 'probe_thing';

/**
 * Declaration files every sandbox reads (`lib.*.d.ts`, `@objectstack/spec`'s
 * `dist/`), parsed and bound once and handed to each sandbox's Program.
 *
 * Only files OUTSIDE the sandbox are cached: a sandbox's own sources are read
 * fresh by its own Program. Every sandbox compiles under the same
 * `SCAFFOLD_TSCONFIG_COMPILER_OPTIONS` (they differ only in `rootDir` and
 * `include`, which change no parse), and the key carries the parse options
 * the compiler asks with, so a cached file is the file that sandbox's own
 * `tsc` would have parsed.
 */
const SHARED_DECLARATIONS = new Map<string, ts.SourceFile>();

const FORMAT_HOST: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (fileName) => fileName,
  getCurrentDirectory: () => process.cwd(),
  getNewLine: () => '\n',
};

/**
 * Run the emitted project's own `typecheck` script: `tsc --noEmit -p <root>`.
 *
 * In process, one Program per sandbox (see the docblock's "One compiler, one
 * Program per sandbox"). The verdict is `tsc`'s: exit 0 exactly when the
 * config, options, global, syntactic, semantic and declaration diagnostics
 * that `tsc --noEmit` reports hold no error, and the output is those
 * diagnostics in `--pretty false` form, so a failure message is still
 * greppable for its `TS####` code.
 */
function typecheckProject(root: string): { code: number; output: string } {
  const configErrors: ts.Diagnostic[] = [];
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(root, 'tsconfig.json'),
    { noEmit: true },
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => configErrors.push(diagnostic),
    },
  );
  if (!parsed) {
    return { code: 1, output: ts.formatDiagnostics(configErrors, FORMAT_HOST) };
  }

  const host = ts.createCompilerHost(parsed.options);
  const readSourceFile = host.getSourceFile.bind(host);
  const inSandbox = (fileName: string) => !path.relative(root, fileName).startsWith('..');
  host.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    if (inSandbox(fileName)) {
      return readSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    }
    const key = `${fileName}\u0000${JSON.stringify(languageVersionOrOptions)}`;
    let file = SHARED_DECLARATIONS.get(key);
    if (file === undefined) {
      file = readSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
      if (file !== undefined) SHARED_DECLARATIONS.set(key, file);
    }
    return file;
  };

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: parsed.options,
    host,
    projectReferences: parsed.projectReferences,
    configFileParsingDiagnostics: ts.getConfigFileParsingDiagnostics(parsed),
  });
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...program.emit().diagnostics];
  const errors = diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error);
  return {
    // `tsc --noEmit` with an error answers ExitStatus.DiagnosticsPresent_OutputsSkipped.
    code: errors.length === 0 ? 0 : 1,
    output: ts.formatDiagnostics(diagnostics, FORMAT_HOST),
  };
}

/** A sandbox project carrying the tsconfig `init` really writes. */
function sandbox(label: string, include: readonly string[], rootDir: string): string {
  const root = fs.mkdtempSync(path.join(TMP_ROOT, `${label}-`));
  fs.writeFileSync(
    path.join(root, 'tsconfig.json'),
    JSON.stringify(renderScaffoldTsconfig({ rootDir, include: [...include] }), null, 2) + '\n',
  );
  return root;
}

/** Materialize one `os init` template exactly as the command emits it. */
function emitInitTemplate(templateKey: string): string {
  const template = TEMPLATES[templateKey];
  const namespace = sanitizeNamespace(PROJECT_NAME);
  const root = sandbox(`init-${templateKey}`, SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG, '.');
  fs.writeFileSync(
    path.join(root, 'objectstack.config.ts'),
    template.configContent(PROJECT_NAME, namespace),
  );
  writeTemplateSrcFiles(template.srcFiles, root, PROJECT_NAME, namespace);
  return root;
}

describe('every emitted scaffold compiles under the tsconfig it ships with', () => {
  // ── Controls ──────────────────────────────────────────────────────────
  //
  // Without these the suite below could pass by measuring nothing at all.

  it('the canary proves the harness resolves the spec package and CAN go red', () => {
    const root = sandbox('canary', SCAFFOLD_TSCONFIG_INCLUDE_SRC_ONLY, 'src');
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'src', 'canary.ts'),
      `import * as Data from '@objectstack/spec/data';

const probe: Data.NoSuchMemberForTheCanary = { name: 'probe' };

export default probe;
`,
    );

    const { code, output } = typecheckProject(root);

    expect(code, `the canary must NOT compile — this harness reports:\n${output}`).not.toBe(0);
    expect(
      output,
      'the canary must fail with TS2694 (the incident\'s own error code). ' +
        'TS2307 here means `@objectstack/spec` dist is not built, and every ' +
        "verdict in this file is meaningless until it is:\n" +
        "  pnpm --filter '@objectstack/cli^...' build\n" +
        `tsc said:\n${output}`,
    ).toContain('TS2694');
    expect(output).toContain('NoSuchMemberForTheCanary');
  }, 120_000);

  it('both rosters are populated, and the incident\'s own surface is still emitted', () => {
    const templateKeys = Object.keys(TEMPLATES);
    expect(templateKeys.length).toBeGreaterThan(0);
    expect(GENERATOR_SCAFFOLD_TARGETS.length).toBeGreaterThan(0);

    // #15976 was an annotation of a `@objectstack/spec/data` namespace member
    // in an emitted object file. If a future edit stopped emitting object
    // files altogether, every assertion below would still pass while covering
    // none of the incident — so the surface itself is pinned as present.
    const namespace = sanitizeNamespace(PROJECT_NAME);
    const initObjectSources = templateKeys.flatMap((key) =>
      Object.entries(TEMPLATES[key].srcFiles ?? {})
        .filter(([p]) => p.includes('src/objects/') && !p.endsWith('index.ts'))
        .map(([, contentFn]) => contentFn(PROJECT_NAME, namespace)),
    );
    expect(initObjectSources.length).toBeGreaterThan(0);
    expect(
      initObjectSources.filter((src) => src.includes("from '@objectstack/spec/data'")).length,
      'no `os init` template emits an object file importing `@objectstack/spec/data` any more — ' +
        'this pin has stopped covering #15976',
    ).toBeGreaterThan(0);

    const objectGenerator = GENERATOR_SCAFFOLD_TARGETS.find((g) => g.type === 'object');
    expect(objectGenerator, '`os g object` is gone from the roster').toBeDefined();
    expect(objectGenerator!.generate(STEM)).toContain("from '@objectstack/spec/data'");
  });

  // ── The sweep ─────────────────────────────────────────────────────────

  it.each(Object.keys(TEMPLATES))(
    '`os init -t %s` emits a project that passes its own `pnpm typecheck`',
    (templateKey) => {
      const root = emitInitTemplate(templateKey);
      const { code, output } = typecheckProject(root);

      expect(
        code,
        `\`os init -t ${templateKey}\` emits a project that fails the \`tsc --noEmit\` its own ` +
          `package.json \`typecheck\` script runs. This is what a new user meets on their ` +
          `first command:\n${output}`,
      ).toBe(0);
    },
    120_000,
  );

  it.each(GENERATOR_SCAFFOLD_TARGETS.map((g) => [g.type, g] as const))(
    '`os g %s` emits a file that type-checks',
    (type, generator) => {
      const root = sandbox(`gen-${type}`, SCAFFOLD_TSCONFIG_INCLUDE_SRC_ONLY, 'src');
      const dir = path.join(root, generator.defaultDir);
      fs.mkdirSync(dir, { recursive: true });
      // The file NAME is `generate-file-name-registry-parity.test.ts`'s axis,
      // not this one's; what is measured here is the SOURCE that lands in it.
      // [#21325] A binding scaffold renders against references resolved off the
      // stack; the probe stack's stand in, since what is measured is the type
      // of the file, not what it binds.
      fs.writeFileSync(path.join(dir, `${STEM}.ts`), generator.generate(STEM, undefined, probeBindings(generator)));

      const { code, output } = typecheckProject(root);

      expect(
        code,
        `\`os g ${type} ${STEM}\` emits a file the author's own \`tsc --noEmit\` refuses:\n${output}`,
      ).toBe(0);
    },
    120_000,
  );
});
