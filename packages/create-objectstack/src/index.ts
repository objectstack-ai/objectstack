// Copyright (c) 2026 ObjectStack contributors. Apache-2.0 license.

/**
 * create-objectstack — scaffold a new ObjectStack environment.
 *
 * Two template sources:
 *
 *   1. Bundled `blank` template
 *      Lives at `dist/templates/blank/` (copied from `src/templates/blank/`
 *      by tsup `onSuccess`). Cloned via recursive fs copy. Always available
 *      offline.
 *
 *   2. Remote content templates (`todo`, `compliance`, `content`,
 *      `contracts`, `procurement`)
 *      Fetched as a single tarball from the sibling repo
 *      `objectstack-ai/templates` on GitHub, then the `packages/<name>/`
 *      subtree is extracted. Requires network.
 *
 * After the files land in `targetDir`, four files are rewritten with the
 * user-supplied project name:
 *   - package.json              .name
 *   - objectstack.manifest.json .name + .displayName
 *   - objectstack.config.ts     manifest.id and manifest.name string literals
 *   - README.md                 first H1
 *
 * Finally we run `<pm> install` and (best-effort) install the ObjectStack
 * skills bundle via `npx skills add objectstack-ai/framework --all`.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
// eslint-disable-next-line import/no-unresolved
import * as tar from 'tar';

import { syncObjectStackDeps } from './pkg-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_TEMPLATES_DIR = path.resolve(__dirname, 'templates');

const REMOTE_REPO = 'objectstack-ai/templates';
const REMOTE_BRANCH = 'main';
const REMOTE_TARBALL_URL = `https://codeload.github.com/${REMOTE_REPO}/tar.gz/refs/heads/${REMOTE_BRANCH}`;

// ─── Template Registry ──────────────────────────────────────────────

type TemplateSource =
  | { kind: 'bundled'; dir: string }
  | { kind: 'remote'; pkg: string };

interface TemplateInfo {
  description: string;
  source: TemplateSource;
}

const TEMPLATES: Record<string, TemplateInfo> = {
  blank: {
    description: 'Minimal starter — one object, REST API, ready to extend',
    source: { kind: 'bundled', dir: 'blank' },
  },
  todo: {
    description: 'Universal task & project management starter',
    source: { kind: 'remote', pkg: 'todo' },
  },
  compliance: {
    description: 'Compliance posture & evidence management (SOC2 / ISO27001)',
    source: { kind: 'remote', pkg: 'compliance' },
  },
  content: {
    description: 'Content marketing pipeline — editorial calendar & channel ROI',
    source: { kind: 'remote', pkg: 'content' },
  },
  contracts: {
    description: 'Post-signature CLM — approvals, obligations, renewals',
    source: { kind: 'remote', pkg: 'contracts' },
  },
  procurement: {
    description: 'Source-to-pay — vendors, POs, receipts, invoice matching',
    source: { kind: 'remote', pkg: 'procurement' },
  },
};

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

function copyDir(src: string, dest: string, collected: string[], rel = '') {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath, collected, relPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
      collected.push(relPath);
    }
  }
}

function loadBundled(templateDir: string, targetDir: string): string[] {
  const src = path.join(BUNDLED_TEMPLATES_DIR, templateDir);
  if (!fs.existsSync(src)) {
    throw new Error(`Bundled template missing on disk: ${src}`);
  }
  const collected: string[] = [];
  copyDir(src, targetDir, collected);
  return collected;
}

// ─── Loading: remote (GitHub tarball) ───────────────────────────────

async function downloadTarball(url: string, destFile: string): Promise<void> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${url} (${res.status})`);
  }
  const out = createWriteStream(destFile);
  // node 18+: res.body is a web ReadableStream — pipe via async iterator
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for await (const chunk of res.body as any) {
    out.write(chunk);
  }
  await new Promise<void>((resolve, reject) => {
    out.end((err: unknown) => (err ? reject(err as Error) : resolve()));
  });
}

async function loadRemote(pkgName: string, targetDir: string): Promise<string[]> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'create-objectstack-'));
  try {
    const tarball = path.join(tmp, 'templates.tar.gz');
    printStep(`Fetching template "${pkgName}" from ${REMOTE_REPO}@${REMOTE_BRANCH}…`);
    await downloadTarball(REMOTE_TARBALL_URL, tarball);

    // GitHub tarballs nest everything under `<repo>-<branch>/`. The package we
    // want lives at `<repo>-<branch>/packages/<pkgName>/...`. We extract only
    // that subtree, stripping the leading 3 path components so the contents
    // of `packages/<pkgName>/` land directly in `targetDir`.
    fs.mkdirSync(targetDir, { recursive: true });
    const collected: string[] = [];
    await pipeline(
      createReadStream(tarball),
      createGunzip(),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tar.extract({
        cwd: targetDir,
        strip: 3,
        filter: (p: string) => {
          // p looks like: "templates-main/packages/<pkg>/..."
          const parts = p.split('/');
          return parts[1] === 'packages' && parts[2] === pkgName && parts.length > 3;
        },
        onentry: (entry: { path: string; type: string }) => {
          if (entry.type === 'File') {
            // entry.path is the original archive path; strip the 3 leading
            // components ("templates-main/packages/<pkg>/") so the reported
            // file matches what actually lands on disk.
            const parts = entry.path.split('/').slice(3);
            if (parts.length > 0) collected.push(parts.join('/'));
          }
        },
      } as any),
    );
    if (collected.length === 0) {
      throw new Error(
        `Template "${pkgName}" not found in ${REMOTE_REPO}@${REMOTE_BRANCH} ` +
          `(expected packages/${pkgName}/).`,
      );
    }
    return collected;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ─── Field-aware rewrites ───────────────────────────────────────────

/**
 * Walk every `*.ts` file under `dir` and apply `fn` to its contents.
 * Used to swap the bundled template's literal `blank_` object-name prefix
 * for the user-supplied namespace so the rendered objects satisfy the
 * `${namespace}_${shortName}` rule enforced by `objectstack validate`.
 */
function walkAndRewriteTs(dir: string, fn: (src: string) => string) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkAndRewriteTs(full, fn);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      const before = fs.readFileSync(full, 'utf8');
      const after = fn(before);
      if (after !== before) fs.writeFileSync(full, after);
    }
  }
}

function rewriteProjectIdentity(
  targetDir: string,
  projectName: string,
  namespace: string,
) {
  const title = toTitleCase(projectName);

  // Read the template's *original* namespace from the manifest before we
  // overwrite it — we use this as the prefix to swap in src/**/*.ts files.
  let templateNamespace: string | undefined;
  const manifestPathPre = path.join(targetDir, 'objectstack.manifest.json');
  if (fs.existsSync(manifestPathPre)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPathPre, 'utf8'));
      if (typeof m.namespace === 'string') templateNamespace = m.namespace;
    } catch {
      // ignore
    }
  }

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

  // src/**/*.ts — swap the bundled template's `${templateNamespace}_` object-name
  // prefix for the user's sanitized namespace so rendered objects satisfy
  // the `${namespace}_${shortName}` rule. No-op if namespace already matches.
  if (namespace !== templateNamespace && templateNamespace) {
    const prefixRe = new RegExp(
      `(\\bname:\\s*)(['"\`])${templateNamespace}_([a-z0-9_]+)\\2`,
      'g',
    );
    walkAndRewriteTs(path.join(targetDir, 'src'), (src) =>
      src.replace(prefixRe, (_m, prefix: string, q: string, rest: string) =>
        `${prefix}${q}${namespace}_${rest}${q}`,
      ),
    );
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
    `Template: ${Object.keys(TEMPLATES).join(', ')}`,
    'blank',
  )
  .option('--skip-install', 'Skip dependency installation')
  .option('--skip-skills', 'Skip installing ObjectStack AI skills')
  .action(async (
    name: string | undefined,
    options: { template: string; skipInstall?: boolean; skipSkills?: boolean },
  ) => {
    console.log('');
    console.log(chalk.bold.cyan('  ╔═══════════════════════════════════╗'));
    console.log(chalk.bold.cyan('  ║') + chalk.bold('   ◆ Create ObjectStack ') + chalk.dim('v6.x') + chalk.bold.cyan('       ║'));
    console.log(chalk.bold.cyan('  ╚═══════════════════════════════════╝'));

    printHeader('New Environment');

    const template = TEMPLATES[options.template];
    if (!template) {
      printError(`Unknown template: ${options.template}`);
      console.log(chalk.dim(`  Available: ${Object.keys(TEMPLATES).join(', ')}`));
      process.exit(1);
    }

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

      let createdFiles: string[];
      if (template.source.kind === 'bundled') {
        createdFiles = loadBundled(template.source.dir, targetDir);
      } else {
        createdFiles = await loadRemote(template.source.pkg, targetDir);
      }

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
        try {
          const pm = detectPackageManager();
          execSync(`${pm} install`, { stdio: 'inherit', cwd: targetDir });
          console.log('');
        } catch {
          printWarning('Dependency installation failed. Run `npm install` manually.');
          console.log('');
        }
      }

      if (!options.skipInstall && !options.skipSkills) {
        printStep('Installing AI skills for your coding agent...');
        try {
          execSync('npx -y skills add objectstack-ai/framework --all', {
            stdio: 'inherit',
            cwd: targetDir,
          });
          console.log('');
        } catch {
          printWarning(
            'Skills installation skipped. Run manually:\n' +
              '    npx skills add objectstack-ai/framework',
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
        console.log(chalk.dim('    npx skills add objectstack-ai/framework'));
      }
      console.log('');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      printError(msg);
      process.exit(1);
    }
  });

program.parse();
