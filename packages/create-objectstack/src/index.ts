// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.

/**
 * create-objectstack — scaffold a new ObjectStack environment.
 *
 * One template source: the bundled `blank` template. It lives at
 * `dist/templates/blank/` (copied from `src/templates/blank/` by tsup
 * `onSuccess`) and is cloned via recursive fs copy, which also restores the
 * placeholder names npm strips at publish (see TEMPLATE_FILE_ALIASES). Always
 * available offline.
 *
 * There used to be a second category — remote content templates (`todo`,
 * `compliance`, `content`, `contracts`, `procurement`) fetched as a tarball
 * from the sibling repo `objectstack-ai/templates`. Those five were delisted
 * from the official marketplace and are no longer maintained, so the catalog
 * no longer offers them and the tarball-fetch path that served them is gone.
 * `template-registry.ts` still names them, so `-t todo` refuses with an
 * explanation instead of a bare "unknown template".
 *
 * After the files land in `targetDir`, four files are rewritten with the
 * user-supplied project name:
 *   - package.json              .name
 *   - objectstack.manifest.json .name + .displayName
 *   - objectstack.config.ts     manifest.id and manifest.name string literals
 *   - README.md                 first H1
 *
 * Then we run `<pm> install` — and only afterwards can the Dockerfile's runtime
 * image tag be pinned, because the template carries a caret range and the tag
 * has to name the @objectstack/cli version npm actually resolved (#9017). With
 * `--skip-install` there is no resolved version, so the template keeps `latest`
 * and its comment keeps telling the reader to pin by hand — true in that path.
 *
 * Finally we (best-effort) install the ObjectStack skills bundle via
 * `npx skills add objectstack-ai/objectstack/skills --all`.
 * The `/skills` subpath scopes discovery to the curated, customer-published
 * catalog — repo-internal skills (e.g. under `.claude/skills/`) must never
 * reach scaffolded projects.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { syncObjectStackDeps } from './pkg-utils.js';
import { copyDir } from './template-copy.js';
import {
  readTemplateNamespace,
  rewriteObjectNamePrefix,
  findStaleNamespacePrefixes,
} from './rewrite-identity.js';
import { lookupTemplate, templateNames } from './template-registry.js';
import { readResolvedCliVersion, pinRuntimeImage } from './runtime-image.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_TEMPLATES_DIR = path.resolve(__dirname, 'templates');

// ─── Helpers ────────────────────────────────────────────────────────

function toTitleCase(str: string): string {
  return str.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert an npm package name into a valid ObjectStack namespace identifier
 * (regex `^[a-z][a-z0-9_]{1,19}$`, reserved: base/system/sys). Mirrors the
 * implementation in `@objectstack/cli` so both scaffolders agree.
 */
export function sanitizeNamespace(name: string): string {
  let s = name.replace(/^@[^/]+\//, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
  s = s.replace(/^_+|_+$/g, '');
  if (!s) s = 'app';
  if (/^[0-9]/.test(s)) s = 'a' + s;
  if (s.length < 2) s = (s + '_app').slice(0, 20);
  if (s.length > 20) s = s.slice(0, 20).replace(/_+$/, '');
  if (['base', 'system', 'sys'].includes(s)) s = (s + '_app').slice(0, 20);
  return s;
}

function readCliVersion(): string {
  try {
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '0.0.0');
  } catch {
    return '0.0.0';
  }
}

function printHeader(title: string) {
  console.log(chalk.bold(`\n◆ ${title}`));
  console.log(chalk.dim('─'.repeat(40)));
}
function printKV(key: string, value: string) {
  console.log(`  ${chalk.dim(key + ':')} ${chalk.white(value)}`);
}
function printSuccess(msg: string) { console.log(chalk.green(`  ✓ ${msg}`)); }
function printError(msg: string)   { console.log(chalk.red(`  ✗ ${msg}`)); }
function printStep(msg: string)    { console.log(chalk.yellow(`  → ${msg}`)); }
function printWarning(msg: string) { console.log(chalk.yellow(`  ⚠ ${msg}`)); }

function detectPackageManager(): string {
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
    return 'pnpm';
  } catch {
    return 'npm';
  }
}

// ─── Loading: bundled (fs copy) ─────────────────────────────────────

function loadBundled(templateDir: string, targetDir: string): string[] {
  const src = path.join(BUNDLED_TEMPLATES_DIR, templateDir);
  if (!fs.existsSync(src)) {
    throw new Error(`Bundled template missing on disk: ${src}`);
  }
  const collected: string[] = [];
  copyDir(src, targetDir, collected);
  return collected;
}

// ─── Field-aware rewrites ───────────────────────────────────────────
//
// The object-name prefix walk moved to rewrite-identity.ts so it can be tested
// without importing this module (which calls program.parse() on import).

function rewriteProjectIdentity(
  targetDir: string,
  projectName: string,
  namespace: string,
) {
  const title = toTitleCase(projectName);

  // The template's *original* namespace, read before we overwrite it — this is
  // the prefix we swap in src/**/*.ts. It comes from objectstack.config.ts
  // first: a REMOTE template's objectstack.manifest.json is the template-
  // REGISTRY document and carries no `namespace` at all, so reading only the
  // manifest silently yielded undefined and skipped the whole rewrite below —
  // shipping every remote template with a rewritten manifest namespace next to
  // untouched object names (#4902). See rewrite-identity.ts for the account.
  const templateNamespace = readTemplateNamespace(targetDir);

  // package.json — set .name and pin @objectstack/* deps to this scaffolder's
  // own release line. All @objectstack packages (including create-objectstack)
  // version in lockstep, so `^<own version>` always resolves and always matches
  // the framework the docs describe. Without this, a template whose literal
  // ranges have gone stale scaffolds a project several majors behind the
  // published framework (the `^6.0.0`-era templates installed 6.x while the
  // registry was at 14.x).
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      pkg.name = projectName;
      syncObjectStackDeps(pkg, readCliVersion());
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    } catch {
      // leave the file alone if it isn't valid JSON
    }
  }

  // objectstack.manifest.json — set .name, .displayName, .namespace
  const manifestPath = path.join(targetDir, 'objectstack.manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      m.name = projectName;
      m.displayName = title;
      if ('namespace' in m) m.namespace = namespace;
      fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
    } catch {
      // ignore
    }
  }

  // objectstack.config.ts — rewrite manifest.id, manifest.name, manifest.namespace
  // string literals. Conservative: only touches the first occurrence of each key.
  const configPath = path.join(targetDir, 'objectstack.config.ts');
  if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, 'utf8');
    cfg = cfg.replace(/(\bid:\s*)(['"`])[^'"`]*\2/, `$1$2${projectName}$2`);
    cfg = cfg.replace(/(\bnamespace:\s*)(['"`])[^'"`]*\2/, `$1$2${namespace}$2`);
    cfg = cfg.replace(/(\bname:\s*)(['"`])[^'"`]*\2/, `$1$2${title}$2`);
    fs.writeFileSync(configPath, cfg);
  }

  // src/**/*.ts — swap the template's `${templateNamespace}_` object-name prefix
  // for the user's sanitized namespace so rendered objects satisfy the
  // `${namespace}_${shortName}` rule. No-op if the namespace already matches.
  //
  // Then VERIFY. A prefix rewrite that quietly does nothing looks exactly like
  // one that was not needed, and that ambiguity is what let five broken
  // templates ship (#4902). If any stale literal survives, the scaffold has
  // produced a project that cannot build — fail here, where the cause is still
  // legible, rather than in the user's first `objectstack build`.
  if (templateNamespace && namespace !== templateNamespace) {
    const srcDir = path.join(targetDir, 'src');
    rewriteObjectNamePrefix(srcDir, templateNamespace, namespace);
    const stale = findStaleNamespacePrefixes(srcDir, templateNamespace);
    if (stale.length > 0) {
      const shown = stale
        .slice(0, 5)
        .map((s) => `    src/${s.file}:${s.line}  ${s.text}`)
        .join('\n');
      const more = stale.length > 5 ? `\n    …and ${stale.length - 5} more` : '';
      throw new Error(
        `Scaffolding rewrote the namespace to '${namespace}' but ${stale.length} object ` +
          `name(s) still carry the template's '${templateNamespace}_' prefix:\n${shown}${more}\n` +
          `The generated project would fail 'objectstack build' on the ` +
          `\${namespace}_\${shortName} rule. This is a bug in the scaffolder, not in your input.`,
      );
    }
  }

  // README.md — rewrite first H1
  const readmePath = path.join(targetDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    let md = fs.readFileSync(readmePath, 'utf8');
    md = md.replace(/^#\s+.*$/m, `# ${title}`);
    fs.writeFileSync(readmePath, md);
  }

  writeAgentGuides(targetDir, title, projectName);
}

// Emit the cross-agent guidance file (AGENTS.md) and the GitHub Copilot variant
// (.github/copilot-instructions.md) from the shared template. This is what tells
// the coding agent to run `npm run validate` after editing metadata — the gate
// that catches bare-field predicates and dangling bindings that otherwise fail
// silently at runtime. Skip either file if the template already shipped its own,
// so a curated template can override the default.
function writeAgentGuides(targetDir: string, title: string, projectName: string) {
  const templatePath = path.join(BUNDLED_TEMPLATES_DIR, 'AGENTS.md');
  let template: string;
  try {
    template = fs.readFileSync(templatePath, 'utf8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return; // bundled template absent — nothing to emit
    throw err;
  }

  const rendered = template
    .replace(/\{\{PROJECT_TITLE\}\}/g, title)
    .replace(/\{\{PROJECT_NAME\}\}/g, projectName);

  // Atomic exclusive-create (the `wx` flag) instead of existsSync()+writeFileSync():
  // it fails with EEXIST if the file already exists, so a curated template that
  // ships its own guide is preserved — without the check-then-write TOCTOU race a
  // separate existence check introduces.
  writeIfAbsent(path.join(targetDir, 'AGENTS.md'), rendered);

  const copilotPath = path.join(targetDir, '.github', 'copilot-instructions.md');
  fs.mkdirSync(path.dirname(copilotPath), { recursive: true });
  writeIfAbsent(copilotPath, rendered);
}

// Create a file only if it does not already exist, atomically — no time-of-check
// to time-of-use gap between an existence test and the write.
function writeIfAbsent(filePath: string, contents: string) {
  try {
    fs.writeFileSync(filePath, contents, { flag: 'wx' });
  } catch (err: any) {
    if (err?.code !== 'EEXIST') throw err;
  }
}

// ─── CLI Program ────────────────────────────────────────────────────

const program = new Command()
  .name('create-objectstack')
  .description('Create a new ObjectStack environment')
  .version(readCliVersion())
  .argument('[name]', 'Environment name (defaults to current directory name)')
  .option(
    '-t, --template <template>',
    `Template: ${templateNames().join(', ')}`,
    'blank',
  )
  .option('--skip-install', 'Skip dependency installation')
  .option('--skip-skills', 'Skip installing ObjectStack AI skills')
  // Sync: nothing here awaits any more. The only asynchronous step was the
  // remote tarball fetch, and `program.parse()` never awaited the action — so a
  // rejection thrown outside the try/catch below would have been an unhandled
  // rejection rather than a diagnosed failure.
  .action((
    name: string | undefined,
    options: { template: string; skipInstall?: boolean; skipSkills?: boolean },
  ) => {
    console.log('');
    console.log(chalk.bold.cyan('  ╔═══════════════════════════════════╗'));
    console.log(chalk.bold.cyan('  ║') + chalk.bold('   ◆ Create ObjectStack ') + chalk.dim('v6.x') + chalk.bold.cyan('       ║'));
    console.log(chalk.bold.cyan('  ╚═══════════════════════════════════╝'));

    printHeader('New Environment');

    const lookup = lookupTemplate(options.template);
    if (lookup.kind !== 'found') {
      if (lookup.kind === 'retired') {
        // A returning user typed a name that used to work. Say what happened to
        // it — the generic "Unknown template" would read as a typo on their end.
        printError(`Template "${lookup.name}" has been retired and is no longer available.`);
        console.log(
          chalk.dim(
            '  It was delisted from the ObjectStack template marketplace and is no longer maintained.',
          ),
        );
      } else {
        printError(`Unknown template: ${lookup.name}`);
      }
      console.log(chalk.dim(`  Available: ${templateNames().join(', ')}`));
      process.exit(1);
    }
    const template = lookup.template;

    const cwd = process.cwd();
    const projectName = name || path.basename(cwd);
    const namespace = sanitizeNamespace(projectName);
    const targetDir = name ? path.resolve(cwd, name) : cwd;
    const isCurrentDir = targetDir === cwd;

    printKV('Environment', projectName);
    printKV('Namespace', namespace);
    printKV('Template', `${options.template} — ${template.description}`);
    printKV('Directory', targetDir);
    console.log('');

    if (!isCurrentDir && fs.existsSync(targetDir)) {
      const existing = fs.readdirSync(targetDir);
      if (existing.length > 0) {
        printError(`Directory already exists and is not empty: ${targetDir}`);
        process.exit(1);
      }
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      const createdFiles = loadBundled(template.source.dir, targetDir);

      rewriteProjectIdentity(targetDir, projectName, namespace);

      console.log(chalk.bold('  Created files:'));
      for (const f of createdFiles.slice(0, 20)) {
        console.log(chalk.green(`    + ${f}`));
      }
      if (createdFiles.length > 20) {
        console.log(chalk.dim(`    … and ${createdFiles.length - 20} more`));
      }
      console.log('');

      if (!options.skipInstall) {
        printStep('Installing dependencies...');
        let installed = false;
        try {
          const pm = detectPackageManager();
          execSync(`${pm} install`, { stdio: 'inherit', cwd: targetDir });
          installed = true;
          console.log('');
        } catch {
          printWarning('Dependency installation failed. Run `npm install` manually.');
          console.log('');
        }

        // Pin the Dockerfile's runtime image to the CLI that will build this
        // project's artifact — knowable only now, because the template pins a
        // caret RANGE and npm has just resolved it (#9017). Skipped without an
        // install: with no node_modules there is no resolved version, and the
        // template's own comment then correctly tells the user to pin by hand.
        if (installed) {
          const resolved = readResolvedCliVersion(targetDir);
          if (resolved) {
            const result = pinRuntimeImage(targetDir, resolved);
            if (result.pinned) {
              printSuccess(`Dockerfile runtime image pinned to ${result.tag}`);
            } else {
              // Not fatal: the project is complete, the tag is just less
              // precise than it could be. runtime-image.test.ts is the guard.
              printWarning(
                `Could not pin the Dockerfile runtime image (${result.reason}); ` +
                  `it still reads \`latest\` — pin it to ${resolved} before deploying.`,
              );
            }
            console.log('');
          }
        }
      }

      if (!options.skipInstall && !options.skipSkills) {
        printStep('Installing AI skills for your coding agent...');
        try {
          execSync('npx -y skills add objectstack-ai/objectstack/skills --all', {
            stdio: 'inherit',
            cwd: targetDir,
          });
          console.log('');
        } catch {
          printWarning(
            'Skills installation skipped. Run manually:\n' +
              '    npx skills add objectstack-ai/objectstack/skills',
          );
          console.log('');
        }
      }

      printSuccess('Environment created!');
      console.log('');

      console.log(chalk.bold('  Next steps:'));
      if (!isCurrentDir) {
        console.log(chalk.dim(`    cd ${name}`));
      }
      if (options.skipInstall) {
        console.log(chalk.dim('    npm install'));
      }
      console.log(chalk.dim('    npm run dev           # Start development server'));
      console.log(chalk.dim('    npm run validate      # Verify metadata: schema + predicates + bindings'));
      console.log(chalk.dim('                          # (run after every metadata edit — see AGENTS.md)'));
      if (options.skipInstall || options.skipSkills) {
        console.log('');
        console.log(chalk.bold('  AI Skills (recommended):'));
        console.log(chalk.dim('    npx skills add objectstack-ai/objectstack/skills'));
      }
      console.log('');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      printError(msg);
      process.exit(1);
    }
  });

program.parse();
