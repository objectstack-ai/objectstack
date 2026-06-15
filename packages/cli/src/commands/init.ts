// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { Args, Command, Flags } from '@oclif/core';
import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { printHeader, printSuccess, printError, printStep, printKV, printInfo } from '../utils/format.js';

// ─── Version resolution ──────────────────────────────────────────────
//
// The CLI is published to npm together with every other `@objectstack/*`
// package in this monorepo, so they all share the same release version.
// We pin scaffolded dependencies to whatever version of the CLI is
// running, which guarantees the generated `package.json` resolves
// outside the workspace (and pins a tested, compatible matrix).

let cachedCliVersion: string | null = null;

export function getCliVersion(): string {
  if (cachedCliVersion) return cachedCliVersion;
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // dist/commands/init.js → ../../package.json   (built layout)
    // src/commands/init.ts  → ../../package.json   (source layout, used by tests)
    const pkgPath = path.resolve(here, '..', '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    cachedCliVersion = String(pkg.version || '0.0.0');
  } catch {
    cachedCliVersion = '0.0.0';
  }
  return cachedCliVersion;
}

/** Caret-pinned to the CLI's own version (e.g. `^6.5.0`). */
function pkgVersion(): string {
  return `^${getCliVersion()}`;
}

/**
 * Convert an npm package name into a valid ObjectStack namespace identifier.
 *
 * Namespace rules (from `ManifestSchema` in `@objectstack/spec`):
 *   - 2-20 chars, `^[a-z][a-z0-9_]{1,19}$`
 *   - Reserved: `base`, `system`, `sys`
 *
 * npm names allow hyphens/dots/scopes (e.g. `@acme/my-app`); identifiers don't.
 * We strip the scope, replace separators with `_`, lowercase, prefix a leading
 * digit, truncate to 20, and pad short names so the result always satisfies
 * the regex. Reserved names get a `_app` suffix.
 */
export function sanitizeNamespace(name: string): string {
  let s = name.replace(/^@[^/]+\//, '');           // drop npm scope
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_'); // separators → _
  s = s.replace(/^_+|_+$/g, '');                   // trim underscores
  if (!s) s = 'app';
  if (/^[0-9]/.test(s)) s = 'a' + s;               // must start with a letter
  if (s.length < 2) s = (s + '_app').slice(0, 20);
  if (s.length > 20) s = s.slice(0, 20).replace(/_+$/, '');
  if (['base', 'system', 'sys'].includes(s)) s = (s + '_app').slice(0, 20);
  return s;
}

/**
 * Native dependencies the scaffold pulls in (transitively) that need their
 * build scripts to run at install time. pnpm 10+ blocks dependency build
 * scripts by default; without this allowlist `better-sqlite3` (used by the
 * default standalone SQLite store, via knex) ships uncompiled and `serve`
 * fails with "Could not locate the bindings file".
 *
 * Current pnpm reads this from `pnpm-workspace.yaml`, NOT the `pnpm` field in
 * package.json (that field is now ignored and emits a deprecation warning).
 * npm/yarn/bun build native modules by default and ignore this file.
 */
export const SCAFFOLD_BUILT_DEPENDENCIES = ['better-sqlite3', 'esbuild'];

/**
 * Render the `pnpm-workspace.yaml` that allowlists native build scripts.
 * Kept minimal (no `packages:` key) so it acts purely as a settings file for
 * the single-package scaffold rather than declaring a workspace.
 */
export function renderPnpmWorkspaceYaml(builtDeps: string[] = SCAFFOLD_BUILT_DEPENDENCIES): string {
  return [
    '# Allowlist native dependency build scripts so `pnpm install` compiles',
    '# them (pnpm 10+ blocks build scripts by default). Without this,',
    '# better-sqlite3 ships uncompiled and `objectstack serve` fails with',
    '# "Could not locate the bindings file".',
    'onlyBuiltDependencies:',
    ...builtDeps.map((d) => `  - ${d}`),
    '',
  ].join('\n');
}

export const TEMPLATES: Record<string, {
  description: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
  configContent: (name: string, namespace: string) => string;
  srcFiles: Record<string, (name: string, namespace: string) => string>;
}> = {
  app: {
    description: 'Full application with objects, views, and actions',
    get dependencies() {
      const v = pkgVersion();
      return {
        '@objectstack/spec': v,
        '@objectstack/runtime': v,
        '@objectstack/objectql': v,
        '@objectstack/driver-memory': v,
      };
    },
    get devDependencies() {
      return {
        '@objectstack/cli': pkgVersion(),
        'typescript': '^5.3.0',
      };
    },
    scripts: {
      dev: 'objectstack dev',
      // `serve` is production mode and boots from the compiled artifact
      // (dist/objectstack.json). Compile first so `pnpm start` works straight
      // after `pnpm install` without a separate build step.
      start: 'objectstack compile && objectstack serve',
      build: 'objectstack compile',
      validate: 'objectstack validate',
      typecheck: 'tsc --noEmit',
    },
    configContent: (name: string, namespace: string) => `import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.example.${namespace}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'app',
    name: '${toTitleCase(name)}',
    description: '${toTitleCase(name)} application built with ObjectStack',
  },

  objects: Object.values(objects),
});
`,
    srcFiles: {
      'src/objects/index.ts': (_name, namespace) => `export { default as ${toCamelCase(namespace)}Item } from './${namespace}_item';
`,
      'src/objects/__name___item.ts': (_name, namespace) => `import * as Data from '@objectstack/spec/data';

const ${toCamelCase(namespace)}Item: Data.Object = {
  name: '${namespace}_item',
  label: '${toTitleCase(namespace)} Item',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      required: true,
    },
    description: {
      type: 'textarea',
      label: 'Description',
    },
    status: {
      type: 'select',
      label: 'Status',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Active', value: 'active' },
        { label: 'Archived', value: 'archived' },
      ],
      defaultValue: 'draft',
    },
  },
};

export default ${toCamelCase(namespace)}Item;
`,
    },
  },

  plugin: {
    description: 'Reusable plugin with objects and extensions',
    get dependencies() {
      return {
        '@objectstack/spec': pkgVersion(),
      };
    },
    get devDependencies() {
      return {
        '@objectstack/cli': pkgVersion(),
        'typescript': '^5.3.0',
        'vitest': '^4.0.18',
      };
    },
    scripts: {
      build: 'objectstack compile',
      validate: 'objectstack validate',
      test: 'vitest run',
      typecheck: 'tsc --noEmit',
    },
    configContent: (name: string, namespace: string) => `import { defineStack } from '@objectstack/spec';
import * as objects from './src/objects';

export default defineStack({
  manifest: {
    id: 'com.objectstack.plugin-${name}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'plugin',
    name: '${toTitleCase(name)} Plugin',
    description: 'ObjectStack Plugin: ${toTitleCase(name)}',
  },

  objects: Object.values(objects),
});
`,
    srcFiles: {
      'src/objects/index.ts': (_name, namespace) => `export { default as ${toCamelCase(namespace)}Item } from './${namespace}_item';
`,
      'src/objects/__name___item.ts': (_name, namespace) => `import * as Data from '@objectstack/spec/data';

const ${toCamelCase(namespace)}Item: Data.Object = {
  name: '${namespace}_item',
  label: '${toTitleCase(namespace)} Item',
  fields: {
    name: {
      type: 'text',
      label: 'Name',
      required: true,
    },
  },
};

export default ${toCamelCase(namespace)}Item;
`,
    },
  },

  empty: {
    description: 'Minimal project with just a config file',
    get dependencies() {
      return {
        '@objectstack/spec': pkgVersion(),
      };
    },
    get devDependencies() {
      return {
        '@objectstack/cli': pkgVersion(),
        'typescript': '^5.3.0',
      };
    },
    scripts: {
      build: 'objectstack compile',
      validate: 'objectstack validate',
      typecheck: 'tsc --noEmit',
    },
    configContent: (name: string, namespace: string) => `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: {
    id: 'com.example.${namespace}',
    namespace: '${namespace}',
    version: '0.1.0',
    type: 'app',
    name: '${toTitleCase(name)}',
    description: '',
  },
});
`,
    srcFiles: {},
  },
};

function toCamelCase(str: string): string {
  return str.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function printWarning(msg: string) {
  console.log(chalk.yellow(`  ⚠ ${msg}`));
}

/**
 * Detect the package manager that invoked this CLI by inspecting
 * `npm_config_user_agent` (set by every modern PM). Falls back to `npm`,
 * which is universally available and the safest default for `npx`-style
 * invocations.
 */
export function detectPackageManager(env: NodeJS.ProcessEnv = process.env): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  const ua = env.npm_config_user_agent || '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

/**
 * Validate that `name` is a usable npm package name AND a safe directory
 * segment. Mirrors the subset of rules used by `npm init`/`create-vite`.
 */
function validateProjectName(name: string): string | null {
  if (!name) return 'Project name is required';
  if (name.length > 214) return 'Project name must be ≤ 214 characters';
  if (/[A-Z]/.test(name)) return 'Project name must be lowercase';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return 'Project name must start with a lowercase letter or digit and contain only [a-z0-9._-]';
  }
  if (name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    return 'Project name must not contain path separators';
  }
  return null;
}

export default class Init extends Command {
  static override id = 'init';

  static override description = 'Initialize a new ObjectStack project';

  static override args = {
    name: Args.string({
      description: 'Project name. When provided, a new directory with this name is created; otherwise the current directory is used.',
      required: false,
    }),
  };

  static override flags = {
    template: Flags.string({ char: 't', description: 'Template: app, plugin, empty', default: 'app' }),
    install: Flags.boolean({ description: 'Install dependencies', default: true, allowNo: true }),
    'package-manager': Flags.string({
      char: 'p',
      description: 'Package manager to use for install (auto-detected from npm_config_user_agent)',
      options: ['npm', 'pnpm', 'yarn', 'bun'],
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Init);

    printHeader('Init');

    const startCwd = process.cwd();
    const template = TEMPLATES[flags.template];

    if (!template) {
      printError(`Unknown template: ${flags.template}`);
      console.log(chalk.dim(`  Available: ${Object.keys(TEMPLATES).join(', ')}`));
      this.error(`Unknown template: ${flags.template}`);
    }

    // Resolve target directory + project name.
    //
    // If a name is supplied, scaffold into ./<name>/ (created if missing).
    // This matches `npm create`, `pnpm create`, `vite`, etc. — the user's
    // confusion in the bug report came from `init my-app` overwriting the
    // current directory while the printed summary said "Project: my-app".
    //
    // If no name is supplied, scaffold into the current directory and use
    // its basename as the project name.
    let targetDir: string;
    let projectName: string;
    if (args.name) {
      const nameError = validateProjectName(args.name);
      if (nameError) {
        printError(nameError);
        this.error(nameError);
      }
      projectName = args.name;
      targetDir = path.resolve(startCwd, args.name);
      if (fs.existsSync(targetDir)) {
        const entries = fs.readdirSync(targetDir).filter((e) => e !== '.git');
        if (entries.length > 0) {
          const msg = `Target directory ${targetDir} is not empty`;
          printError(msg);
          console.log(chalk.dim('  Choose a different name or remove the existing directory first.'));
          this.error(msg);
        }
      } else {
        fs.mkdirSync(targetDir, { recursive: true });
      }
    } else {
      targetDir = startCwd;
      projectName = path.basename(startCwd);
      const nameError = validateProjectName(projectName);
      if (nameError) {
        printError(`Current directory name "${projectName}" is not a valid project name. ${nameError}`);
        console.log(chalk.dim('  Re-run with an explicit name: `objectstack init my-app`'));
        this.error(nameError);
      }
    }

    // Check for existing config
    if (fs.existsSync(path.join(targetDir, 'objectstack.config.ts'))) {
      printError(`objectstack.config.ts already exists in ${targetDir}`);
      console.log(chalk.dim('  Use `objectstack generate` to add metadata to an existing project'));
      this.error('objectstack.config.ts already exists');
    }

    // Convert the npm-name (which allows hyphens, dots, scopes) into a
    // valid ObjectStack namespace identifier. Threaded into every template
    // function so object names use `${namespace}_${shortName}` form and
    // satisfy `defineStack()` validation.
    const namespace = sanitizeNamespace(projectName);

    printKV('Project', projectName);
    printKV('Namespace', namespace);
    printKV('Template', `${flags.template} — ${template.description}`);
    printKV('Directory', targetDir);
    console.log('');

    const createdFiles: string[] = [];

    let installSucceeded = false;
    let installAttempted = false;
    let chosenPm: 'npm' | 'pnpm' | 'yarn' | 'bun' = 'npm';

    try {
      // 1. Create package.json if missing
      const pkgPath = path.join(targetDir, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        const pkg = {
          name: projectName,
          version: '0.1.0',
          private: true,
          type: 'module',
          scripts: template.scripts,
          dependencies: template.dependencies,
          devDependencies: template.devDependencies,
        };
        fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
        createdFiles.push('package.json');
      } else {
        printInfo('package.json already exists, skipping');
      }

      // 1b. Create pnpm-workspace.yaml so pnpm compiles the native deps the
      // standalone store needs (see SCAFFOLD_BUILT_DEPENDENCIES). Harmless for
      // npm/yarn/bun, which ignore this file and build native modules anyway.
      // Use an exclusive write ('wx') rather than exists()-then-write so the
      // "don't clobber an existing file" check is atomic (no TOCTOU race).
      const pnpmWorkspacePath = path.join(targetDir, 'pnpm-workspace.yaml');
      try {
        fs.writeFileSync(pnpmWorkspacePath, renderPnpmWorkspaceYaml(), { flag: 'wx' });
        createdFiles.push('pnpm-workspace.yaml');
      } catch (err: any) {
        if (err?.code !== 'EEXIST') throw err;
      }

      // 2. Create objectstack.config.ts
      const configContent = template.configContent(projectName, namespace);
      fs.writeFileSync(path.join(targetDir, 'objectstack.config.ts'), configContent);
      createdFiles.push('objectstack.config.ts');

      // 3. Create tsconfig.json if missing
      const tsconfigPath = path.join(targetDir, 'tsconfig.json');
      if (!fs.existsSync(tsconfigPath)) {
        const tsconfig = {
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            outDir: 'dist',
            rootDir: '.',
            declaration: true,
          },
          include: ['*.ts', 'src/**/*'],
          exclude: ['dist', 'node_modules'],
        };
        fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2) + '\n');
        createdFiles.push('tsconfig.json');
      }

      // 4. Create src files. File paths use `__name__` as a placeholder for
      // the namespace (NOT the npm name) so generated identifiers stay snake
      // _case even when the project name contains hyphens (e.g. `my-app` →
      // namespace `my_app` → `src/objects/my_app_item.ts`).
      for (const [filePath, contentFn] of Object.entries(template.srcFiles)) {
        const resolvedPath = filePath.replace(/__name__/g, namespace);
        const fullPath = path.join(targetDir, resolvedPath);
        const dir = path.dirname(fullPath);

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, contentFn(projectName, namespace));
        createdFiles.push(resolvedPath);
      }

      // 5. Create .gitignore if missing
      const gitignorePath = path.join(targetDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, `node_modules/\ndist/\n*.tsbuildinfo\n`);
        createdFiles.push('.gitignore');
      }

      // Summary
      console.log(chalk.bold('  Created files:'));
      for (const f of createdFiles) {
        console.log(chalk.green(`    + ${f}`));
      }
      console.log('');

      // Install dependencies
      if (flags.install) {
        chosenPm = (flags['package-manager'] as typeof chosenPm | undefined) ?? detectPackageManager();
        printStep(`Installing dependencies with ${chosenPm}...`);
        installAttempted = true;
        const { execSync } = await import('child_process');
        try {
          execSync(`${chosenPm} install`, { stdio: 'inherit', cwd: targetDir });
          installSucceeded = true;
        } catch {
          printWarning(`Dependency installation with ${chosenPm} failed. Run \`${chosenPm} install\` manually in ${targetDir}.`);
        }
      }

      // Self-test the scaffold so we catch template regressions (e.g. an
      // invalid namespace or object name) before the user discovers them by
      // running `objectstack dev`. Only runs when deps are present —
      // `defineStack()` validation lives in `@objectstack/spec`.
      if (installSucceeded) {
        printStep('Validating scaffold...');
        try {
          const { bundleRequire } = await import('bundle-require');
          const { mod } = await bundleRequire({
            filepath: path.join(targetDir, 'objectstack.config.ts'),
            cwd: targetDir,
          });
          const stack = mod.default ?? mod;
          if (!stack?.manifest?.namespace) {
            throw new Error('Rendered config has no manifest.namespace');
          }
          printSuccess(`Scaffold validated (namespace: ${stack.manifest.namespace})`);
        } catch (err: any) {
          printError(`Scaffold validation failed: ${err.message || err}`);
          console.log(chalk.dim('  This is a CLI bug — please report it at https://github.com/objectstack-ai/framework/issues'));
          this.error('Scaffold validation failed');
        }
      }

      if (!installAttempted || installSucceeded) {
        printSuccess('Project initialized!');
        console.log('');
        console.log(chalk.bold('  Next steps:'));
        if (targetDir !== startCwd) {
          console.log(chalk.dim(`    cd ${path.relative(startCwd, targetDir) || '.'}`));
        }
        const runCmd = chosenPm === 'npm' ? 'npx objectstack' : `${chosenPm} exec objectstack`;
        if (!installAttempted) {
          console.log(chalk.dim(`    ${chosenPm} install            # Install dependencies`));
        }
        console.log(chalk.dim(`    ${runCmd} validate   # Check configuration`));
        console.log(chalk.dim(`    ${runCmd} dev        # Start development server`));
        console.log(chalk.dim(`    ${runCmd} generate   # Add objects, views, etc.`));
        console.log('');
      } else {
        // Install failed — surface clear remediation instead of pretending success.
        printError('Project scaffolded, but dependency installation failed.');
        console.log('');
        console.log(chalk.bold('  To finish setup:'));
        if (targetDir !== startCwd) {
          console.log(chalk.dim(`    cd ${path.relative(startCwd, targetDir) || '.'}`));
        }
        console.log(chalk.dim(`    ${chosenPm} install`));
        console.log('');
        this.error('Dependency installation failed');
      }

    } catch (error: any) {
      printError(error.message || String(error));
      this.error(error.message || String(error));
    }
  }
}
