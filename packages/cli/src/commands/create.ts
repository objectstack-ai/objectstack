// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os create <type> [name]` — scaffold a kernel code plugin.
 *
 * ## `os create example` is retired (#16483)
 *
 * The `example` template emitted a SUBSET of what `os init` writes, plus one
 * README. #15531 rendered and hashed both command families' real emission: the
 * only template-level duplication left between them was this one template, and
 * the ruling (#15531, decision batch #66, option B) is that the template goes
 * rather than that the two families merge — they emit two different artifacts,
 * and a kernel code `Plugin` is not a declarative app.
 *
 * ⚠️ That batch entry is the whole of what is verified here, and it settles the
 * REMOVAL only. The terms this file implements on top of it — NO alias and NO
 * deprecation window — are recorded on card #16483 and are PENDING MAINTAINER
 * CONFIRMATION: a contract review could not locate the ruling they were
 * attributed to, so the attribution is written as unverified with its source
 * named rather than repeated. ⛔ Do not restate it as a settled ruling, and
 * ⛔ do not go looking for a ruling to make it true — it is filed for the
 * maintainer. The BEHAVIOUR is unaffected either way and is the shipped
 * precedent (`os g agent`, `RETIRED_GENERATORS` in `generate.ts`): the command
 * refuses rather than aliasing, which is what the message below says.
 *
 * ⛔ The template is not merely deleted. `os create example` still ANSWERS, and
 * the answer names `os init` — see {@link RETIRED_TEMPLATES}. Letting it fall
 * through to the `Unknown type:` branch would print the surviving roster and
 * nothing else, so a reader arriving from an old doc page, a tutorial or a CI
 * script would learn only that their spelling is not on the list, and the
 * natural next move is to hunt for the right spelling of something that no
 * longer exists. A removal that leaves a generic failure behind is the outcome
 * the ruling exists to prevent, so the refusal is part of the contract and is
 * pinned as one (`test/create-example-retired.e2e.test.ts`).
 *
 * ## What this command emits, and why it has two shapes
 *
 * ObjectStack is a developer tool, so a documented developer-facing command has
 * to work for the developer who follows the docs. This command is documented on
 * four public doc pages (`deployment/cli`, `plugins/index`, the two
 * `protocol/kernel` pages) and, until commit cf6b67164, every one of those readers got a
 * project that CANNOT INSTALL:
 *
 *   - the emitted `package.json` declared `@objectstack/spec` and
 *     `@objectstack/cli` as `workspace:*`, a pnpm protocol that resolves only
 *     inside a workspace that already contains those packages;
 *   - the emitted `tsconfig.json` declared `extends: '../../tsconfig.json'`,
 *     a file that exists in no directory the scaffold lands in (measured: for
 *     the `plugin` template it did not resolve even INSIDE this monorepo —
 *     `packages/plugins/<pkg>/../../tsconfig.json` is `packages/tsconfig.json`,
 *     which does not exist; every real plugin here spells `../../../`);
 *   - and the default output location was this repo's own `packages/plugins/`
 *     or `examples/`, so the command only did anything sensible when it was run
 *     from a checkout of ObjectStack itself.
 *
 * A fourth followed from making the emission real: the `plugin` template wrote
 * an `initialize` method, which is not part of the `Plugin` contract. `Plugin`
 * carries an index signature, so the excess property was accepted but got no
 * contextual type — the scaffold failed its own `strict` type-check with TS7006
 * — and the kernel loader refuses a plugin without `init` outright. It emits
 * `init` now; the warning the kernel protocol docs carried about renaming it is
 * gone with the defect.
 *
 * The fix is not to narrow the promise but to deliver it, so the DEFAULT is now
 * a standalone project:
 *
 *   `standalone`  (default)  every `@objectstack/*` dependency is a PUBLISHED
 *                            semver range pinned to the running CLI's own
 *                            version, the `tsconfig.json` is self-contained,
 *                            a `pnpm-workspace.yaml` carries the build
 *                            approvals a fresh `pnpm install` needs, the
 *                            package is named `plugin-<name>` and marked
 *                            `private`, and the project lands in the
 *                            developer's own directory.
 *   `in-repo`     (--in-repo) the platform-work shape: `workspace:*` deps, a
 *                            `tsconfig.json` that extends this repo's shared
 *                            `tsconfig.base.json`, a publishable
 *                            `@objectstack/plugin-<name>` landing under
 *                            `packages/plugins/`. Explicit and
 *                            documented, never the default — its output
 *                            installs nowhere else.
 *
 * ## The emitted package NAME follows the placement too (#15530)
 *
 * The audience decides the name, and commit cf6b67164 moved the audience without moving
 * the name: the standalone default kept stamping `@objectstack/plugin-<name>`
 * — a scope the developer it now scaffolds for cannot publish to — onto every
 * project, with the emitted README telling them to install it from there. The
 * rule and the reason live on {@link pluginPackageName}; the README is the
 * SECOND site that repeats the name and is fixed in the same place, because a
 * rename that reaches only the manifest leaves the README pointing at a package
 * that exists under no name at all.
 *
 * ## The version the standalone shape pins
 *
 * Every `@objectstack/*` package in this monorepo is released together on one
 * version, so the version that is guaranteed to exist and to be mutually
 * compatible is the CLI's own, pinned exactly. `getCliVersion()` (owned by
 * `init.ts`, which has pinned scaffolded deps this way since long before this
 * command did) reads it from the CLI package's own manifest; the version is
 * imported rather than re-derived so the two scaffolders cannot drift on the
 * one value that decides whether a scaffold resolves at all.
 *
 * ## Why the standalone shape reuses `init`'s renderers
 *
 * `renderPnpmWorkspaceYaml()`, `SCAFFOLD_PNPM_RANGE`, `renderScaffoldTsconfig()`
 * and the `SCAFFOLD_*_RANGE` constants are `init.ts`'s, and they are CALLED here
 * rather than restated. A restatement is the two-producer defect
 * `test/scaffold-workspace-consistency.test.ts` exists to catch, and it has
 * already been paid for twice in this repo: the build-approval block landed in
 * one scaffold path and not the other, and one of them shipped the pre-fix shape
 * for months; and the TypeScript range a scaffold installs was written in six
 * places and split into three values — the two CLI values 210 days apart, the
 * third 53 and recorded nowhere — on the value that decides whether the
 * scaffold type-checks at all. The emission policy has
 * one home now — see the block above `renderScaffoldPackageJson` in `init.ts`
 * for the measurement and for which values survived.
 *
 * ## The pin
 *
 * `scripts/create-scaffold-smoke.sh` scaffolds every template in `templates`
 * into a temporary directory OUTSIDE this repository, installs it from packed
 * tarballs (the honest stand-in for a registry install of an unreleased
 * version), and runs the project's own `build` and `typecheck`. It is wired
 * into `.github/workflows/os-create-smoke.yml`, path-filtered onto this file
 * and the templates, so it runs on exactly the changes that can break it.
 */

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { makeDirectorySync } from '../utils/make-directory.js';
import {
  getCliVersion,
  NPM_PACKAGE_NAME_MAX_LENGTH,
  renderPnpmWorkspaceYaml,
  renderScaffoldTsconfig,
  SCAFFOLD_NPM_OVERRIDES,
  SCAFFOLD_PNPM_RANGE,
  SCAFFOLD_TSCONFIG_INCLUDE_SRC_ONLY,
  SCAFFOLD_TYPES_NODE_RANGE,
  SCAFFOLD_TYPESCRIPT_RANGE,
  SCAFFOLD_VITEST_RANGE,
  SCAFFOLD_ZOD_RANGE,
  validateProjectName,
} from './init.js';

/**
 * Where the scaffold is going to live, which is the only thing the emitted
 * dependency ranges and `tsconfig.json` differ on.
 */
export type ScaffoldPlacement = 'standalone' | 'in-repo';

/** ⛔ Never `in-repo` — that placement emits a project that installs nowhere. */
export const DEFAULT_PLACEMENT: ScaffoldPlacement = 'standalone';

/**
 * The dependency spec every `@objectstack/*` entry in an emitted manifest gets.
 *
 * `standalone` is the CLI's own version, EXACT (no `^`/`~`, a prerelease kept
 * verbatim) — a published version that npm, pnpm, yarn and bun all resolve,
 * and the pin the docs prescribe, because a breaking change may ship in a
 * minor or a patch on the v18 line. `workspace:*` is emitted ONLY for the
 * in-repo placement, where a workspace really does supply those names.
 */
export function objectstackDependencySpec(placement: ScaffoldPlacement): string {
  return placement === 'in-repo' ? 'workspace:*' : getCliVersion();
}

/**
 * The TypeScript range an emitted manifest declares, by placement.
 *
 * `standalone` is `SCAFFOLD_TYPESCRIPT_RANGE`, the support floor the docs
 * promise a developer's own project. `in-repo` is this workspace's TypeScript:
 * the scaffold extends `tsconfig.base.json`, whose `ignoreDeprecations: "6.0"`
 * only TypeScript 6 accepts, so the standalone floor (installed as 5.x) failed
 * the new package's first `tsc` with TS5103. ⛔ Never `SCAFFOLD_TYPESCRIPT_RANGE`
 * here, and never this range for `standalone`.
 *
 * `test/create-in-repo-scaffold-typechecks.test.ts` pins it equal to the range
 * the repository root and every sibling under `packages/plugins/` declare, so a
 * workspace TypeScript bump reddens there until this moves with it.
 */
export const IN_REPO_TYPESCRIPT_RANGE = '^6.0.3';

export function typescriptDependencySpec(placement: ScaffoldPlacement): string {
  return placement === 'in-repo' ? IN_REPO_TYPESCRIPT_RANGE : SCAFFOLD_TYPESCRIPT_RANGE;
}

/**
 * The `extends` an in-repo scaffold needs to reach this repo's shared
 * `tsconfig.base.json` — the file every package here extends — DERIVED from
 * where the template lands rather than written down. Writing it down is how the
 * `plugin` template came to declare `'../../tsconfig.json'` from a directory two
 * levels below `packages/`, which resolves to a file that does not exist.
 *
 * ⛔ Never the root `tsconfig.json`: that is the type-check program for
 * `scripts/` and the top-level configs, and its `exclude` (`packages`, `apps`,
 * `examples`, `ui`) resolves against the root, so a scaffold that inherited it
 * matched none of its own `src/` — `tsc` stopped with TS18003, "No inputs were
 * found".
 */
export function baseTsconfigExtends(inRepoDir: string, projectDirName: string): string {
  const depth = path.posix.join(inRepoDir, projectDirName).split('/').filter(Boolean).length;
  return `${'../'.repeat(depth)}tsconfig.base.json`;
}

/** A rendered file: JSON objects are stringified on write, strings land as-is. */
type FileRenderer = (name: string) => unknown;

export interface CreateTemplate {
  description: string;
  /** Directory, relative to the monorepo root, the `--in-repo` placement uses. */
  inRepoDir: string;
  /** The project directory's own name, in either placement. */
  dirName: (name: string) => string;
  /** Every file this template emits for a given placement, keyed by its path. */
  filesFor: (placement: ScaffoldPlacement) => Record<string, FileRenderer>;
  /**
   * The DEFAULT (standalone) file map — what `os create <type> <name>` writes
   * when nobody passes a flag. Kept as a plain property so a caller that only
   * cares about the default shape (the manifest-schema sweep in
   * `test/scaffold-manifest-schema.test.ts`) reads it without knowing about
   * placements at all.
   */
  files: Record<string, FileRenderer>;
}

function defineTemplate(t: Omit<CreateTemplate, 'files'>): CreateTemplate {
  return {
    ...t,
    get files() {
      return t.filesFor(DEFAULT_PLACEMENT);
    },
  };
}

/**
 * The package name a scaffold is about to write, READ BACK off the rendered
 * manifest rather than recomposed here.
 *
 * Recomposing it would be a second copy of the composition that nothing keeps
 * in step with the renderer — the same restatement that let this command's
 * emitted name drift away from what `os init` enforces. Reading the rendered
 * object measures the string that actually lands on disk, and a template added
 * later is covered without being told to declare anything.
 *
 * ⭐ Load-bearing since #15530, not merely tidy: the composition is no longer
 * ONE string. The standalone placement emits an unscoped `plugin-<name>` and
 * `--in-repo` a scoped `@objectstack/plugin-<name>`, so a recomposition here
 * would have to know the placement rule too — and would be judging the wrong
 * length for one of the two placements the moment the rule moved.
 *
 * `null` when the template emits no `package.json`, or emits one without a
 * string `name`: there is then no package name to judge, which is not the same
 * as judging one and finding it fine.
 */
export function emittedPackageName(
  template: CreateTemplate,
  placement: ScaffoldPlacement,
  name: string,
): string | null {
  const render = template.filesFor(placement)['package.json'];
  if (!render) return null;
  const manifest = render(name) as { name?: unknown } | null | undefined;
  return typeof manifest?.name === 'string' ? manifest.name : null;
}

/**
 * The one rule `os create` needs and `os init` cannot.
 *
 * `init`'s argument IS the package name, so measuring the argument is the same
 * measurement. `create` COMPOSES its argument into a longer name, and npm's
 * 214-character ceiling counts every character of the composition — the
 * `plugin-` prefix the standalone placement writes (7), or the whole
 * `@objectstack/plugin-` the in-repo placement writes (20), before the user's
 * first character. A 214-character name is therefore legal for `init`
 * (measured: accepted) and illegal for `create` in EITHER placement — which is
 * why the shared validator is shared and this check is not.
 *
 * ⛔ Never re-derive the prefix length here: the caller hands in the string
 * `emittedPackageName` read back off the rendered manifest, so this measures
 * the bytes that would land whichever placement produced them.
 */
export function validateEmittedPackageName(packageName: string): string | null {
  const over = packageName.length - NPM_PACKAGE_NAME_MAX_LENGTH;
  if (over <= 0) return null;
  return (
    `The package name this would emit is ${packageName.length} characters; npm's limit is `
    + `${NPM_PACKAGE_NAME_MAX_LENGTH}. Shorten the project name by at least ${over} character`
    + `${over === 1 ? '' : 's'}.`
  );
}

/**
 * The JavaScript identifier the emitted plugin's exported symbol is built from
 * — DERIVED from the project name, never copied out of it.
 *
 * ## The defect this replaces
 *
 * `validateProjectName` accepts exactly what npm accepts, and that is correct:
 * `foo.bar` is a legal npm package name and `@objectstack/plugin-foo.bar` is
 * publishable. The same string is then interpolated into an *identifier*
 * position (`export const <ident>Plugin`), where npm's charset is far wider
 * than JavaScript's. The predecessor of this function folded `-x` into `X` and
 * passed everything else straight through, so
 *
 *     os create plugin foo.bar   ->   export const foo.barPlugin: Plugin = {
 *
 * exited 0 having written a property access where a binding name belongs.
 * `1foo` (npm-legal) reached the same position as `1fooPlugin`, and `a_b` as
 * `a_bPlugin` — legal, but not the camel fold the `-` case promises.
 *
 * ## The rule
 *
 * The fold is GENERALISED, not narrowed: every run of characters illegal in a
 * JS identifier is the separator `-` already was — dropped, with the character
 * after it upper-cased — and a leading digit takes the `'a'` prefix that
 * `init.ts`'s `sanitizeNamespace()` has always used for exactly
 * this rule. Ordinary names are unchanged: `my-app` still yields `myApp`.
 *
 * ⛔ This normalises the CODE identifier and nothing else. The package name,
 * its scope and the emitted directory name stay byte-for-byte what the user
 * typed, and what `os create` accepts is unchanged.
 *
 * ⛔ No reserved-word handling, deliberately: every emission site appends
 * `Plugin`, so the identifier that lands is never a bare keyword.
 */
export function sanitizeIdentifier(name: string): string {
  const stem = name.replace(/^@[^/]+\//, ''); // drop an npm scope if present
  let ident = stem.replace(
    /[^A-Za-z0-9]+(.)?/g,
    (_match: string, next?: string) => (next ? next.toUpperCase() : ''),
  );
  if (!ident) ident = 'plugin';
  if (/^[0-9]/.test(ident)) ident = `a${ident}`;
  return ident;
}

const PLUGIN_IN_REPO_DIR = 'packages/plugins';

/** The project directory the `plugin` template lands in, in either placement. */
function pluginDirName(name: string): string {
  return `plugin-${name}`;
}

/**
 * The package name the `plugin` template writes — DERIVED from the placement,
 * exactly as its dependency specs and its `tsconfig.json` already are.
 *
 * ## Why the standalone name is unscoped
 *
 * `@objectstack` is a scope the developer this command scaffolds FOR cannot
 * publish to. Until commit cf6b67164 that was arguably fine, because the default output
 * landed inside this monorepo, where every sibling really does carry the scope.
 * That commit pointed the default at the developer's own directory and the name
 * did not move with the audience — so the standalone emission stamped a scope
 * its owner does not own onto every project generated from it. ⚠️ Nothing in
 * this repository can see that: the name is never resolved from a registry
 * inside the project, so `pnpm install`, the type-check and the scaffold smoke
 * are all green on it. The cost is paid once, later, at `npm publish`, in
 * someone else's terminal.
 *
 * The #15530 ruling is that the standalone default emits `plugin-<name>` —
 * unscoped, and the same string as {@link pluginDirName}, which is what the
 * scaffolder prints and what the developer already sees on disk. ⛔ Those are
 * not two spellings of one convention: the package name is COMPOSED from the
 * directory name here, so a template that renames its directory cannot leave a
 * stale package name behind it.
 *
 * ⭐ The name is the readable half. `"private": true` — emitted beside it, for
 * the standalone placement only — is the STRUCTURAL half, and the one that
 * actually prevents the defect: `npm publish` refuses a private manifest
 * loudly, whatever the name says. A later change that keeps this name and drops
 * that flag reinstates the defect with better prose.
 *
 * `--in-repo` keeps `@objectstack/plugin-<name>` and stays publishable: that
 * placement lands under `packages/plugins/`, where every sibling genuinely
 * carries that scope and whoever runs it genuinely can publish there.
 *
 * ⛔ Module-private on purpose, unlike its five exported neighbours. Each of
 * those is exported because a test in this package IMPORTS it; nothing imports
 * this one, and nothing should — `test/create.test.ts` pins the two composed
 * names as LITERALS precisely so the pin cannot move with the function it is
 * pinning. An `export` here would widen this module's surface for no reader.
 */
function pluginPackageName(placement: ScaffoldPlacement, name: string): string {
  return placement === 'in-repo'
    ? `@objectstack/${pluginDirName(name)}`
    : pluginDirName(name);
}

export const templates: Record<string, CreateTemplate> = {
  plugin: defineTemplate({
    description: 'Create a new kernel code plugin (TypeScript implementing the kernel Plugin contract)',
    inRepoDir: PLUGIN_IN_REPO_DIR,
    dirName: pluginDirName,
    filesFor: (placement: ScaffoldPlacement) => {
      const standalone = placement === 'standalone';
      const files: Record<string, FileRenderer> = {
        'package.json': (name: string) => ({
          name: pluginPackageName(placement, name),
          version: '0.1.0',
          // ⛔ Standalone only, and ⛔ never dropped as "just a default the
          // developer will change": this is the line that makes an accidental
          // `npm publish` fail loudly instead of landing a package in a
          // namespace its author does not own. The unscoped name above is the
          // readable half; this is the enforcing one. The in-repo placement
          // omits it because `packages/plugins/*` really is published from here
          // — see {@link pluginPackageName}.
          ...(standalone ? { private: true } : {}),
          description: `ObjectStack Plugin: ${name}`,
          // `tsc` emits ES modules under the compiler options below, so the
          // manifest has to declare the project as ESM or Node refuses the
          // emitted `dist/index.js`. The in-repo placement inherits its module
          // semantics from the shared base config it extends, so it does not.
          ...(standalone ? { type: 'module' } : {}),
          main: 'dist/index.js',
          types: 'dist/index.d.ts',
          // Not a build-script allowlist (that is pnpm-workspace.yaml) — the
          // minimum pnpm that reads that file at all.
          ...(standalone ? { engines: { pnpm: SCAFFOLD_PNPM_RANGE } } : {}),
          // `build` and `dev` compile through `tsconfig.build.json`, which
          // leaves the starter test out of `dist`; `typecheck` reads
          // `tsconfig.json`, which keeps it in. See `tsconfig.build.json` below.
          // `test` is `vitest run`, one pass that exits, as `os init` emits:
          // bare `vitest` watches in a terminal and never returns.
          scripts: {
            build: 'tsc -p tsconfig.build.json',
            dev: 'tsc -p tsconfig.build.json --watch',
            test: 'vitest run',
            typecheck: 'tsc --noEmit',
          },
          keywords: ['objectstack', 'plugin', name],
          author: '',
          license: 'MIT',
          dependencies: {
            '@objectstack/spec': objectstackDependencySpec(placement),
            zod: SCAFFOLD_ZOD_RANGE,
          },
          devDependencies: {
            '@types/node': SCAFFOLD_TYPES_NODE_RANGE,
            typescript: typescriptDependencySpec(placement),
            vitest: SCAFFOLD_VITEST_RANGE,
          },
          // The same npm override `os init` emits, from the same constant, so
          // it always equals `devDependencies.vitest` above (npm refuses one
          // that differs: `EOVERRIDE`) — see SCAFFOLD_NPM_OVERRIDES for the
          // npm 10 crash it prevents. Standalone only: npm reads `overrides`
          // from the ROOT manifest alone and pnpm never reads it, so inside
          // this monorepo's workspace the block would be inert.
          ...(standalone ? { overrides: { ...SCAFFOLD_NPM_OVERRIDES } } : {}),
        }),
        'tsconfig.json': (name: string) =>
          standalone
            ? renderScaffoldTsconfig({
                rootDir: 'src',
                include: SCAFFOLD_TSCONFIG_INCLUDE_SRC_ONLY,
              })
            : {
                // The shape a sibling under `packages/plugins/` declares
                // (`plugin-email` is one): the shared base, Node's types, and
                // an `exclude` of its own, so nothing it inherits resolves
                // against another directory.
                extends: baseTsconfigExtends(PLUGIN_IN_REPO_DIR, pluginDirName(name)),
                compilerOptions: {
                  outDir: 'dist',
                  rootDir: 'src',
                  types: ['node'],
                },
                include: ['src/**/*'],
                exclude: ['dist', 'node_modules'],
              },
        // The config `build` and `dev` compile with (#25175). `tsconfig.json`
        // includes all of `src/`, the starter test with it, so `typecheck`
        // still catches a type error in a test. Built through that same config,
        // `tsc` also emitted `dist/index.test.js`, and vitest, whose default
        // exclude is only `node_modules` and `.git`, then collected the
        // compiled copy beside the source: `npm run build && npm test` ran the
        // suite twice, and the package shipped its tests. Excluding the tests
        // HERE, never in `tsconfig.json`, keeps both halves. ⛔ `exclude` in an
        // extending config replaces the base list rather than adding to it, so
        // `dist` and `node_modules` are restated.
        'tsconfig.build.json': () => ({
          extends: './tsconfig.json',
          exclude: ['dist', 'node_modules', 'src/**/*.test.ts'],
        }),
        'src/index.ts': (name: string) => `import type { Plugin } from '@objectstack/spec/contracts';

/**
 * ${name} Plugin for ObjectStack
 */
export const ${sanitizeIdentifier(name)}Plugin: Plugin = {
  name: '${name}',
  version: '0.1.0',
  
  // \`_context\` is the kernel's plugin context: register services and hooks
  // through it. Drop the underscore once init reads it.
  async init(_context) {
    console.log('Initializing ${name} plugin...');
    // Plugin initialization logic
  },
  
  async destroy() {
    console.log('Destroying ${name} plugin...');
    // Plugin cleanup logic
  },
};

export default ${sanitizeIdentifier(name)}Plugin;
`,
        // The starter test the `test` script runs (#25175). Without a test
        // file, `vitest run` exits 1 with "No test files found", so a fresh
        // project failed its own `npm test` — the defect `os init -t plugin`
        // had, closed there by `package.test.ts`. This one runs the checks the
        // kernel runs on a plugin at `use()`, before any of its code: the
        // loader's `name` and `init` presence checks, then the protocol's
        // `PluginSchema` (`assertPluginContract` in `@objectstack/core`),
        // through `@objectstack/spec`, which the manifest already declares. It
        // deliberately boots no kernel: that needs `@objectstack/verify`
        // declared, and the comment points the author at the documented
        // harness for that step instead. `test/scaffold-test-script-passes.test.ts`
        // runs it in a sandbox, after a build as well as before one.
        'src/index.test.ts': (name: string) => `import { describe, expect, it } from 'vitest';
import { PluginSchema } from '@objectstack/spec/kernel';
import plugin from './index';

// The kernel checks a plugin when it is handed one, before it runs any of its
// code: a plugin with no name or no init is refused outright, and every other
// key is judged against the protocol's PluginSchema. This file runs the same
// checks, so a plugin the kernel would refuse fails here first.
//
// To test what the plugin does once it runs, such as the services its init
// registers, boot it in a real stack with @objectstack/verify:
// https://objectstack.ai/docs/protocol/kernel/plugin-spec#a-runtime-plugin
describe('the ${name} plugin', () => {
  it('passes the checks the kernel runs when it loads a plugin', () => {
    expect(plugin.name).toBeTruthy();
    expect(typeof plugin.init).toBe('function');

    const contract = PluginSchema.safeParse(plugin);
    expect(contract.error?.issues ?? []).toEqual([]);
  });
});
`,
        'README.md': (name: string) => {
          const packageName = pluginPackageName(placement, name);
          // ⛔ The README is not downstream of the manifest rename — it REPEATS
          // the name, at the title, at the install line and at the import
          // specifier. Renaming the manifest alone would leave this file
          // telling a developer to `pnpm add` a package that now exists under
          // no name at all, which is the same defect one layer out. All three
          // sites read `packageName` for that reason.
          //
          // The install instruction itself is placement-dependent (#15530):
          // the standalone project is `private` and unpublished, so a registry
          // install is not something its reader can run — the only instruction
          // that WORKS from a freshly scaffolded directory is a local link.
          // The in-repo project is a real workspace sibling under a scope this
          // repo publishes, so it keeps the install it always had.
          //
          // ⛔ Never spell the local reference as a PATH (`pnpm add ../<dir>`,
          // `link:../<dir>`): the scaffolder knows where this project landed
          // and knows nothing about where the reader's app is, so any relative
          // path is a guess about a directory layout it never created — a
          // reference the newcomer cannot follow, and one
          // `test/init-template-comments-self-contained.test.ts` refuses on
          // exactly that ground. `pnpm link --global` names no location at all
          // and both halves run where the reader already is.
          const install = standalone
            ? `This project is \`private\` and carries no npm scope, so there is nothing to
install from a registry — and \`npm publish\` refuses it until you give it a name
you own and drop that flag. Link it into your app locally in the meantime:

\`\`\`bash
# here — your app loads dist/index.js, so build it first
pnpm install && pnpm build
pnpm link --global

# in your ObjectStack app
pnpm link --global ${packageName}
\`\`\``
            : `\`\`\`bash
pnpm add ${packageName}
\`\`\``;
          return `# ${packageName}

ObjectStack Plugin: ${name}

## Installation

${install}

## Usage

The plugin is exported as \`${sanitizeIdentifier(name)}Plugin\` — a JavaScript
identifier derived from the package name \`${name}\`. Characters that npm allows
in a package name but JavaScript does not allow in an identifier (a dot, a
hyphen, an underscore, a leading digit) are folded away, so the exported symbol
can differ from the name.

\`\`\`typescript
import { defineStack } from '@objectstack/spec';
import { ${sanitizeIdentifier(name)}Plugin } from '${packageName}';

// Use the plugin in your ObjectStack configuration — always through
// defineStack(): \`os validate\` / \`os build\` refuse any other default export.
export default defineStack({
  plugins: [
    ${sanitizeIdentifier(name)}Plugin,
  ],
});
\`\`\`

## License

MIT
`;
        },
      };

      // pnpm does not run dependency build scripts unless they are approved in
      // this file, and pnpm 11 made the omission a HARD ERROR — without it a
      // fresh `pnpm install` on the scaffold exits 1. ⛔ Never emitted for the
      // in-repo placement: a `pnpm-workspace.yaml` inside a workspace declares
      // the directory its OWN workspace root, which severs `workspace:*`.
      if (standalone) {
        files['pnpm-workspace.yaml'] = () => renderPnpmWorkspaceYaml();
      }
      return files;
    },
  }),
};

/**
 * Templates that were withdrawn, and what this command says when one is run.
 *
 * ⛔ A retired template is NOT an unknown template, and must never be allowed to
 * fall through to the `Unknown type:` branch below. That branch prints the
 * surviving roster and nothing else — so the reader of an old doc page, an
 * older tutorial or a CI script that still names the retired template learns
 * only that their spelling is off the list, and goes looking for the right
 * spelling of something that no longer exists. The retirement replaces the
 * command with a SIGNPOST; a generic failure is the outcome it exists to
 * prevent.
 *
 * `example` (#16483, under the #15531 ruling): the template emitted a subset of
 * what `os init` writes plus one README, measured by rendering and hashing both
 * command families' whole emission. Every entry therefore owes both halves —
 * why the template went, and the command to run instead, spelled so it can be
 * copied straight out of the terminal.
 */
export const RETIRED_TEMPLATES: Record<string, {
  /** Reason clause completing "`os create <type>` was retired — …". */
  reason: string;
  /** Body lines, printed in order; an empty string prints a blank line. */
  detail: string[];
}> = {
  example: {
    // ⛔ No `#NNNN` in the printed strings below: a runtime message reaches
    // authors and operators who cannot resolve a tracker id. The card is
    // named in this comment and in the block above (`pnpm check:doc-authoring`).
    reason: 'it was a weaker `os init`.',
    detail: [
      'It emitted a SUBSET of what `os init` writes, plus one README. The two',
      'command families were measured file by file and hashed: there was no',
      'shape this template produced that `os init` does not.',
      '',
      'Use `os init` instead — it writes the same tsconfig.json and an',
      'equivalent objectstack.config.ts, and adds src/objects, a .gitignore and',
      'the dependency install this template never had:',
      '',
      '    os init <name>             ->  a full application project',
      '    os init <name> -t empty    ->  config only, no src/objects',
      '',
      'There is no alias and no deprecation window: `os create example` will not',
      'come back, so change the command rather than pinning an older CLI.',
      '',
      '`os create plugin <name>` is unaffected. It scaffolds the kernel code',
      '`Plugin` contract, which `os init` does not emit — see the scaffolder',
      'table on https://objectstack.ai/docs/deployment/cli',
    ],
  },
};

/** The roster an unknown type is shown, derived so a removal cannot outlive it. */
function availableTypes(): string {
  return Object.keys(templates).join(', ');
}

export default class Create extends Command {
  static override description =
    'Create a new standalone kernel code plugin from a built-in template';

  static override args = {
    type: Args.string({
      description: `Type of project to create (${Object.keys(templates).join(', ')})`,
      required: true,
    }),
    name: Args.string({ description: 'Name of the project', required: false }),
  };

  static override flags = {
    dir: Flags.string({
      char: 'd',
      description: 'Target directory (default: ./<project-name> in the current directory)',
    }),
    'in-repo': Flags.boolean({
      default: false,
      description:
        'Scaffold INSIDE an ObjectStack monorepo checkout (packages/plugins/) with '
        + 'workspace:* dependencies. For platform work only — the emitted project installs nowhere else.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Create);

    console.log(chalk.bold(`\n📦 ObjectStack Project Creator`));
    console.log(chalk.dim(`-------------------------------`));
    
    // A withdrawn template answers for itself, AHEAD of the roster lookup and
    // ahead of the "name is required" check below — `os create example` with no
    // name at all must still reach the signpost rather than be told to supply
    // an argument to a command that no longer exists. See RETIRED_TEMPLATES.
    const retired = RETIRED_TEMPLATES[args.type];
    if (retired) {
      console.error(chalk.red(`\n❌ \`os create ${args.type}\` was retired — ${retired.reason}`));
      console.error('');
      for (const line of retired.detail) {
        console.error(line ? chalk.dim(`  ${line}`) : '');
      }
      console.error('');
      process.exit(1);
    }

    if (!templates[args.type as keyof typeof templates]) {
      console.error(chalk.red(`\n❌ Unknown type: ${args.type}`));
      console.log(chalk.dim(`Available types: ${availableTypes()}`));
      process.exit(1);
    }
    
    if (!args.name) {
      console.error(chalk.red('\n❌ Project name is required'));
      console.log(chalk.dim(`Usage: objectstack create ${args.type} <name>`));
      process.exit(1);
    }

    // ⛔ BEFORE the first write, which is the whole property — a refusal that
    // arrives after `mkdirSync` has fixed the message and not the defect.
    //
    // This command used to validate nothing it emitted, so `os create plugin
    // "My App"` exited 0 having written `./plugin-My App/` with a manifest
    // reading `name: "@objectstack/plugin-My App"` — a name npm refuses —
    // while `os init "My App"` refused the same input and wrote nothing. The
    // rule set is `init`'s, imported rather than restated: the two scaffolders
    // already share four symbols, and the one they did not share is the one
    // they disagreed on.
    const nameError = validateProjectName(args.name);
    if (nameError) {
      console.error(chalk.red(`\n❌ ${nameError}`));
      console.log(chalk.dim(`  Usage: objectstack create ${args.type} <name>`));
      process.exit(1);
    }

    const template = templates[args.type as keyof typeof templates];
    const cwd = process.cwd();
    const placement: ScaffoldPlacement = flags['in-repo'] ? 'in-repo' : DEFAULT_PLACEMENT;
    const projectDirName = template.dirName(args.name);

    // The check `init` cannot need, on the string `init` never composes. Also
    // before any write, and read off the rendered manifest so it measures what
    // would land rather than a second copy of how it is built.
    const willEmit = emittedPackageName(template, placement, args.name);
    const packageNameError = willEmit ? validateEmittedPackageName(willEmit) : null;
    if (packageNameError) {
      console.error(chalk.red(`\n❌ ${packageNameError}`));
      process.exit(1);
    }

    // Refuse `--in-repo` outside a workspace rather than emit the one thing
    // this command is no longer allowed to emit: a project that cannot install.
    if (placement === 'in-repo' && !fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))) {
      console.error(chalk.red('\n❌ --in-repo needs to run from a pnpm workspace root'));
      console.log(
        chalk.dim(
          `  No pnpm-workspace.yaml in ${cwd}. --in-repo emits workspace:* dependencies, which\n`
          + '  resolve only inside a workspace that already provides @objectstack/*.\n'
          + '  Drop the flag to scaffold a standalone project that installs from the registry.',
        ),
      );
      process.exit(1);
    }

    // Determine target directory
    let targetDir: string;
    if (flags.dir) {
      targetDir = path.resolve(cwd, flags.dir);
    } else if (placement === 'in-repo') {
      targetDir = path.join(cwd, template.inRepoDir, projectDirName);
    } else {
      targetDir = path.join(cwd, projectDirName);
    }
    
    // Check if directory already exists
    if (fs.existsSync(targetDir)) {
      console.error(chalk.red(`\n❌ Directory already exists: ${targetDir}`));
      process.exit(1);
    }
    
    console.log(`📁 Creating ${args.type}: ${chalk.blue(args.name)}`);
    console.log(`📂 Location: ${chalk.dim(targetDir)}`);
    if (placement === 'in-repo') {
      console.log(chalk.yellow('⚠️  --in-repo: workspace:* dependencies — this project installs only in this monorepo'));
    }
    console.log('');
    
    try {
      // Create directory. Bounded (#23858): a `--dir` that can never be made
      // is refused at once with the OS's code and the path, never a loop.
      makeDirectorySync(targetDir);
      
      // Create files from template
      for (const [filePath, contentFn] of Object.entries(template.filesFor(placement))) {
        const fullPath = path.join(targetDir, filePath);
        const dir = path.dirname(fullPath);
        
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        
        const content = contentFn(args.name);
        const fileContent = typeof content === 'string' 
          ? content 
          : JSON.stringify(content, null, 2) + '\n';
        
        fs.writeFileSync(fullPath, fileContent);
        console.log(chalk.green(`✓ Created ${filePath}`));
      }
      
      console.log('');
      console.log(chalk.green('✅ Project created successfully!'));
      console.log('');
      console.log(chalk.bold('Next steps:'));
      console.log(chalk.dim(`  cd ${path.relative(cwd, targetDir)}`));
      console.log(chalk.dim('  pnpm install'));
      console.log(chalk.dim('  pnpm build'));
      console.log('');
      
    } catch (error: any) {
      console.error(chalk.red('\n❌ Failed to create project:'));
      console.error(error.message || error);
      
      // Clean up on error
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true });
      }
      
      process.exit(1);
    }
  }
}
