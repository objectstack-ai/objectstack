// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

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
 * That is the gap this file fills, and it is why it spawns `tsc` over a
 * materialized project instead of importing the module. The type layer is a
 * separate axis from the schema layer, and it needs its own instrument.
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
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  TEMPLATES,
  sanitizeNamespace,
  writeTemplateSrcFiles,
  renderScaffoldTsconfig,
  SCAFFOLD_TSCONFIG_INCLUDE_WITH_ROOT_CONFIG,
  SCAFFOLD_TSCONFIG_INCLUDE_SRC_ONLY,
} from '../src/commands/init.js';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { childEnv } from './helpers/serve-process.js';

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
 * Run the emitted project's own `typecheck` script: `tsc --noEmit`.
 *
 * The child's environment is DECLARED (`check:cli-test-child-env`, #11595):
 * every spawn under `packages/cli/test/**` owes one, so that what a child
 * inherits is legible at the call site rather than being the vitest worker's
 * environment by default. `childEnv()` is this directory's choke point — the
 * environment minus the `VITEST_*` family — and `NO_COLOR` pairs with
 * `--pretty false` to keep tsc's diagnostics greppable in the failure message.
 */
function typecheckProject(root: string): { code: number; output: string } {
  const tscBin = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const res = spawnSync(
    process.execPath,
    [tscBin, '--pretty', 'false', '--noEmit', '-p', root],
    { cwd: root, encoding: 'utf-8', env: childEnv({ NO_COLOR: '1' }) },
  );
  return { code: res.status ?? 1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
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
      fs.writeFileSync(path.join(dir, `${STEM}.ts`), generator.generate(STEM));

      const { code, output } = typecheckProject(root);

      expect(
        code,
        `\`os g ${type} ${STEM}\` emits a file the author's own \`tsc --noEmit\` refuses:\n${output}`,
      ).toBe(0);
    },
    120_000,
  );
});
