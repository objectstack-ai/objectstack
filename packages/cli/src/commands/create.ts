// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os create <type> [name]` — scaffold a plugin or an example application.
 *
 * ## What this command emits, and why it has two shapes
 *
 * ObjectStack is a developer tool, so a documented developer-facing command has
 * to work for the developer who follows the docs. This command is documented on
 * four public doc pages (`deployment/cli`, `plugins/index`, the two
 * `protocol/kernel` pages) and, until #14824, every one of those readers got a
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
 *                            approvals a fresh `pnpm install` needs, and the
 *                            project lands in the developer's own directory.
 *   `in-repo`     (--in-repo) the platform-work shape: `workspace:*` deps, a
 *                            `tsconfig.json` that extends this repo's root
 *                            config, landing under `packages/plugins/` or
 *                            `examples/`. Explicit and documented, never the
 *                            default — its output installs nowhere else.
 *
 * ## The version the standalone shape pins
 *
 * Every `@objectstack/*` package in this monorepo is released together on one
 * version, so the range that is guaranteed to exist and to be mutually
 * compatible is the CLI's own. `getCliVersion()` (owned by `init.ts`, which
 * has pinned scaffolded deps this way since long before this command did) reads
 * it from the CLI package's own manifest; the range is imported rather than
 * re-derived so the two scaffolders cannot drift on the one value that decides
 * whether a scaffold resolves at all.
 *
 * ## Why the standalone shape reuses `init`'s renderers
 *
 * `renderPnpmWorkspaceYaml()` and `SCAFFOLD_PNPM_RANGE` are `init.ts`'s, and
 * they are CALLED here rather than restated. A restatement is the two-producer
 * defect `test/scaffold-workspace-consistency.test.ts` exists to catch, and it
 * has already been paid for once in this repo: the build-approval block landed
 * in one scaffold path and not the other, and one of them shipped the pre-fix
 * shape for months.
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
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import {
  getCliVersion,
  NPM_PACKAGE_NAME_MAX_LENGTH,
  renderPnpmWorkspaceYaml,
  sanitizeNamespace,
  SCAFFOLD_PNPM_RANGE,
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
 * `standalone` is caret-pinned to the CLI's own version — a published range
 * that npm, pnpm, yarn and bun all resolve. `workspace:*` is emitted ONLY for
 * the in-repo placement, where a workspace really does supply those names.
 */
export function objectstackDependencySpec(placement: ScaffoldPlacement): string {
  return placement === 'in-repo' ? 'workspace:*' : `^${getCliVersion()}`;
}

/**
 * The `extends` an in-repo scaffold needs to reach this repo's root
 * `tsconfig.json`, DERIVED from where the template lands rather than written
 * down. Writing it down is how the `plugin` template came to declare
 * `'../../tsconfig.json'` from a directory two levels below `packages/`, which
 * resolves to a file that does not exist.
 */
export function rootTsconfigExtends(inRepoDir: string, projectDirName: string): string {
  const depth = path.posix.join(inRepoDir, projectDirName).split('/').filter(Boolean).length;
  return `${'../'.repeat(depth)}tsconfig.json`;
}

/**
 * The compiler options a standalone scaffold carries in full, because it
 * extends nothing. Deliberately the same set `objectstack init` writes: two
 * scaffolders that disagree about `moduleResolution` is a support question
 * nobody can answer, and `bundler` is what resolves the `exports` subpaths
 * (`@objectstack/spec/contracts`, `/kernel`) the templates import.
 */
const STANDALONE_COMPILER_OPTIONS = {
  target: 'ES2022',
  module: 'ESNext',
  moduleResolution: 'bundler',
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
} as const;

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
 * The scoped package name a scaffold is about to write, READ BACK off the
 * rendered manifest rather than recomposed here.
 *
 * Recomposing it would be a second copy of `@objectstack/plugin-${name}` that
 * nothing keeps in step with the renderer — the same restatement that let this
 * command's emitted name drift away from what `os init` enforces. Reading the
 * rendered object measures the string that actually lands on disk, and a
 * template added later is covered without being told to declare anything.
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
 * measurement. `create` composes its argument into a SCOPED name, and npm's
 * 214-character ceiling counts the scope: `@objectstack/plugin-` spends 20 of
 * them before the user's first character. A 200-character name is therefore
 * legal for `init` (measured: accepted) and illegal for `create` (measured:
 * emits a 220-character name npm refuses) — which is why the shared validator
 * is shared and this check is not.
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

function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
}

const PLUGIN_IN_REPO_DIR = 'packages/plugins';
const EXAMPLE_IN_REPO_DIR = 'examples';

export const templates: Record<string, CreateTemplate> = {
  plugin: defineTemplate({
    description: 'Create a new ObjectStack plugin',
    inRepoDir: PLUGIN_IN_REPO_DIR,
    dirName: (name: string) => `plugin-${name}`,
    filesFor: (placement: ScaffoldPlacement) => {
      const standalone = placement === 'standalone';
      const files: Record<string, FileRenderer> = {
        'package.json': (name: string) => ({
          name: `@objectstack/plugin-${name}`,
          version: '0.1.0',
          description: `ObjectStack Plugin: ${name}`,
          // `tsc` emits ES modules under the compiler options below, so the
          // manifest has to declare the project as ESM or Node refuses the
          // emitted `dist/index.js`. The in-repo placement inherits its module
          // semantics from the root config it extends, so it does not.
          ...(standalone ? { type: 'module' } : {}),
          main: 'dist/index.js',
          types: 'dist/index.d.ts',
          // Not a build-script allowlist (that is pnpm-workspace.yaml) — the
          // minimum pnpm that reads that file at all.
          ...(standalone ? { engines: { pnpm: SCAFFOLD_PNPM_RANGE } } : {}),
          scripts: {
            build: 'tsc',
            dev: 'tsc --watch',
            test: 'vitest',
            typecheck: 'tsc --noEmit',
          },
          keywords: ['objectstack', 'plugin', name],
          author: '',
          license: 'MIT',
          dependencies: {
            '@objectstack/spec': objectstackDependencySpec(placement),
            zod: '^4.3.6',
          },
          devDependencies: {
            '@types/node': '^22.0.0',
            typescript: '^5.8.0',
            vitest: '^4.0.0',
          },
        }),
        'tsconfig.json': (name: string) =>
          standalone
            ? {
                compilerOptions: {
                  ...STANDALONE_COMPILER_OPTIONS,
                  outDir: 'dist',
                  rootDir: 'src',
                  declaration: true,
                },
                include: ['src/**/*'],
                exclude: ['dist', 'node_modules'],
              }
            : {
                extends: rootTsconfigExtends(PLUGIN_IN_REPO_DIR, `plugin-${name}`),
                compilerOptions: {
                  outDir: 'dist',
                  rootDir: 'src',
                },
                include: ['src/**/*'],
              },
        'src/index.ts': (name: string) => `import type { Plugin } from '@objectstack/spec/contracts';

/**
 * ${name} Plugin for ObjectStack
 */
export const ${toCamelCase(name)}Plugin: Plugin = {
  name: '${name}',
  version: '0.1.0',
  
  async init(context) {
    console.log('Initializing ${name} plugin...');
    // Plugin initialization logic
  },
  
  async destroy() {
    console.log('Destroying ${name} plugin...');
    // Plugin cleanup logic
  },
};

export default ${toCamelCase(name)}Plugin;
`,
        'README.md': (name: string) => `# @objectstack/plugin-${name}

ObjectStack Plugin: ${name}

## Installation

\`\`\`bash
pnpm add @objectstack/plugin-${name}
\`\`\`

## Usage

\`\`\`typescript
import { ${toCamelCase(name)}Plugin } from '@objectstack/plugin-${name}';

// Use the plugin in your ObjectStack configuration
export default {
  plugins: [
    ${toCamelCase(name)}Plugin,
  ],
};
\`\`\`

## License

MIT
`,
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

  example: defineTemplate({
    description: 'Create a new ObjectStack example application',
    inRepoDir: EXAMPLE_IN_REPO_DIR,
    dirName: (name: string) => name,
    filesFor: (placement: ScaffoldPlacement) => {
      const standalone = placement === 'standalone';
      const files: Record<string, FileRenderer> = {
        'package.json': (name: string) => ({
          name: `@example/${name}`,
          version: '0.1.0',
          private: true,
          ...(standalone ? { type: 'module' } : {}),
          description: `ObjectStack Example: ${name}`,
          ...(standalone ? { engines: { pnpm: SCAFFOLD_PNPM_RANGE } } : {}),
          scripts: {
            build: 'objectstack compile',
            dev: 'objectstack dev',
            test: 'vitest',
            typecheck: 'tsc --noEmit',
          },
          dependencies: {
            '@objectstack/spec': objectstackDependencySpec(placement),
            '@objectstack/cli': objectstackDependencySpec(placement),
            zod: '^4.3.6',
          },
          devDependencies: {
            '@types/node': '^22.0.0',
            tsx: '^4.21.0',
            typescript: '^5.8.0',
            vitest: '^4.0.0',
          },
        }),
        'objectstack.config.ts': (name: string) => {
          const namespace = sanitizeNamespace(name);
          return `import { defineStack } from '@objectstack/spec';

// Barrel imports — add more as you create new type folders
// import * as objects from './src/objects';
// import * as actions from './src/actions';
// import * as apps from './src/apps';

export default defineStack({
  manifest: {
    id: 'com.example.${namespace}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'app',
    name: '${name}',
    description: '${name} example application',
    // Protocol compatibility range: the metadata-protocol major this app is
    // authored against. The runtime checks it before it loads anything, so a
    // runtime outside the range refuses this app at the boundary with the
    // exact migration command instead of crashing later. Scaffolding stamped
    // it to match the ObjectStack version you installed — change it when you
    // deliberately move to a new protocol major, not to silence a mismatch.
    // Guide: https://objectstack.ai/docs/upgrading
    engines: { protocol: '^${PROTOCOL_MAJOR}' },
  },
  
  objects: [
    // Object.values(objects),  // Uncomment after creating src/objects/index.ts
  ],
  
  apps: [
    // Object.values(apps),     // Uncomment after creating src/apps/index.ts
  ],
});
`;
        },
        'README.md': (name: string) => `# ${name} Example

ObjectStack example application: ${name}

## Quick Start

\`\`\`bash
# Install dependencies
pnpm install

# Build the configuration
pnpm build

# Run in development mode
pnpm dev
\`\`\`

## Structure

- \`objectstack.config.ts\` - Main configuration file
- \`dist/objectstack.json\` - Compiled artifact

## Learn More

${
  standalone
    ? '- [ObjectStack Documentation](https://objectstack.ai/docs)\n'
      + '- [CLI Reference](https://objectstack.ai/docs/deployment/cli)\n'
    : '- [ObjectStack Documentation](../../content/docs)\n- [Examples](../)\n'
}`,
        'tsconfig.json': (name: string) =>
          standalone
            ? {
                compilerOptions: {
                  ...STANDALONE_COMPILER_OPTIONS,
                  outDir: 'dist',
                  rootDir: '.',
                  declaration: true,
                },
                include: ['*.ts', 'src/**/*'],
                exclude: ['dist', 'node_modules'],
              }
            : {
                extends: rootTsconfigExtends(EXAMPLE_IN_REPO_DIR, name),
                compilerOptions: {
                  outDir: 'dist',
                  rootDir: '.',
                },
                include: ['*.ts', 'src/**/*'],
              },
      };

      if (standalone) {
        files['pnpm-workspace.yaml'] = () => renderPnpmWorkspaceYaml();
      }
      return files;
    },
  }),
};

export default class Create extends Command {
  static override description =
    'Create a new standalone plugin or example project from a built-in template';

  static override args = {
    type: Args.string({ description: 'Type of project to create (plugin, example)', required: true }),
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
        'Scaffold INSIDE an ObjectStack monorepo checkout (packages/plugins/ or examples/) with '
        + 'workspace:* dependencies. For platform work only — the emitted project installs nowhere else.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Create);

    console.log(chalk.bold(`\n📦 ObjectStack Project Creator`));
    console.log(chalk.dim(`-------------------------------`));
    
    if (!templates[args.type as keyof typeof templates]) {
      console.error(chalk.red(`\n❌ Unknown type: ${args.type}`));
      console.log(chalk.dim('Available types: plugin, example'));
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
      // Create directory
      fs.mkdirSync(targetDir, { recursive: true });
      
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
