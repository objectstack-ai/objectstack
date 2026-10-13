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
 * The template's own `manifest.description` is DROPPED from both
 * objectstack.manifest.json and objectstack.config.ts rather than carried
 * over unrewritten (#9263): it describes the bundled template ("Minimal
 * ObjectStack environment — a clean slate for building."), not the project
 * being scaffolded, and there is nothing but the project name to derive a
 * replacement from — which would only restate `name`/`displayName`. `os
 * validate` already omits the description line entirely when the field is
 * absent, so this is a clean landing rather than a placeholder.
 *
 * Then we run `<pm> install` — and only afterwards can the Dockerfile's runtime
 * image tag be pinned, because the template carries a caret range and the tag
 * has to name the @objectstack/cli version npm actually resolved (#9017). With
 * `--skip-install` there is no resolved version, so the template keeps `latest`
 * and its comment keeps telling the reader to pin by hand — true in that path.
 *
 * Finally we (best-effort) install the ObjectStack skills catalog, for ONE
 * agent runtime, from the `@objectstack/skills` package the install just put in
 * `node_modules` — the catalog at the project's own `@objectstack/spec`
 * version, never the repository's `main` branch (`skills-install.ts` carries
 * the command and the measurements behind it: why the package, why `--copy`,
 * why one agent). With no install there is no package to read, so
 * `--skip-install` installs no skills and the summary says how to get them.
 *
 * Only THEN is the "Created files" summary printed, and it is a walk of the
 * finished project directory rather than a list accumulated during the copy
 * (created-summary.ts carries the measurement). Two of the three write phases
 * belong to other processes — the package manager and the `skills` CLI — so a
 * list assembled by this file before they run cannot name what they wrote, and
 * the version that did so omitted AGENTS.md, both lockfiles and ~1.9 MB of
 * agent instructions while the same run told the reader to review the skills.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { detectPackageManager } from './detect-package-manager.js';
import { fileURLToPath } from 'node:url';

import { syncObjectStackDeps } from './pkg-utils.js';
import { copyDir } from './template-copy.js';
import {
  deriveManifestId,
  readTemplateNamespace,
  rewriteObjectNamePrefix,
  findStaleNamespacePrefixes,
} from './rewrite-identity.js';
import { lookupTemplate, templateNames } from './template-registry.js';
import { readResolvedCliVersion, pinRuntimeImage } from './runtime-image.js';
import { summarizeTree, describeEntry } from './created-summary.js';
import {
  DEFAULT_SKILLS_AGENT,
  DEFAULT_SKILLS_DIR,
  EXAMPLE_OTHER_AGENT,
  SKILLS_INSTALL_COMMAND,
  SKILLS_PACKAGE,
  SKILLS_PACKAGE_CATALOG_DIR,
  installedSkillsVersion,
  listSkills,
  skillsInstallHint,
  skillsPackageDir,
  skillsSyncedFromPackage,
} from './skills-install.js';
import { renderVersionBanner } from './banner.js';

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

  // objectstack.manifest.json — set .name, .displayName, .namespace, and DROP
  // .description (#9263). The template ships a generic line describing
  // ITSELF ("Minimal ObjectStack environment — a clean slate for building."),
  // not the project being scaffolded, and there is nothing but the project
  // name to derive a replacement from — a name-derived sentence would be a
  // bare restatement of `name`/`displayName` (e.g. "Support Desk — an
  // ObjectStack environment.") and add no information the manifest doesn't
  // already show. Measured against `os validate`'s printer
  // (packages/cli/src/commands/validate.ts), which already skips the
  // description line entirely when the field is absent — so dropping the key
  // here is a clean, already-supported landing rather than a placeholder.
  const manifestPath = path.join(targetDir, 'objectstack.manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      m.name = projectName;
      m.displayName = title;
      if ('namespace' in m) m.namespace = namespace;
      delete m.description;
      fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2) + '\n');
    } catch {
      // ignore
    }
  }

  // objectstack.config.ts — rewrite manifest.id, manifest.name, manifest.namespace
  // string literals, and DROP the manifest.description line for the same
  // reason as above (#9263). Conservative: only touches the first occurrence
  // of each key, and the description removal is anchored to the start of its
  // own line so it cannot bleed into an unrelated `description:` elsewhere in
  // the file. Checked against the shipped template (the only one this
  // scaffolder bundles): `objectstack.config.ts` carries exactly one
  // `description:`, inside `manifest` — the same single-occurrence property
  // the pre-existing `name:`/`namespace:`/`id:` regexes above already rely on.
  const configPath = path.join(targetDir, 'objectstack.config.ts');
  if (fs.existsSync(configPath)) {
    let cfg = fs.readFileSync(configPath, 'utf8');
    // `manifest.id` is a reverse-domain identifier, not a bare word — see
    // deriveManifestId() for why the namespace cannot be reused for it.
    cfg = cfg.replace(/(\bid:\s*)(['"`])[^'"`]*\2/, `$1$2${deriveManifestId(projectName)}$2`);
    cfg = cfg.replace(/(\bnamespace:\s*)(['"`])[^'"`]*\2/, `$1$2${namespace}$2`);
    cfg = cfg.replace(/(\bname:\s*)(['"`])[^'"`]*\2/, `$1$2${title}$2`);
    cfg = cfg.replace(/^[ \t]*description:\s*(['"`])[^'"`]*\1,?\r?\n/m, '');
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
    const stale = findStaleNamespacePrefixes(srcDir, templateNamespace, namespace);
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

// Top-level entry names in `dir`, or an empty set if it does not exist yet.
// Two snapshots of this are taken during a run: one before anything is
// written (does the summary get to say "Created files", or did the user
// scaffold into a directory that already had contents?) and one on either
// side of the skills step, whose difference is the set of paths the skills
// installer chose — which is how the security note below points at real paths
// without this file hard-coding a destination list that belongs to a
// dependency's release cycle, not to ours.
function topLevelNames(dir: string): Set<string> {
  try {
    return new Set(fs.readdirSync(dir));
  } catch {
    return new Set();
  }
}

// Print the closing summary of what is now on disk. Derived from a walk of the
// project directory, so it names what the run ACTUALLY wrote — including the
// files written by `<pm> install` and by the `skills` installer, neither of
// which this package can enumerate in advance. See created-summary.ts for the
// measurement that made a hand-accumulated list untenable.
function printCreatedSummary(
  targetDir: string,
  opts: { wasEmpty: boolean; skillPaths: Set<string> },
) {
  const entries = summarizeTree(targetDir);
  if (entries.length === 0) return;

  console.log(
    chalk.bold(opts.wasEmpty ? '  Created files:' : '  Project contents:'),
  );
  if (!opts.wasEmpty) {
    console.log(
      chalk.dim('    (the directory already had contents; this lists all of it)'),
    );
  }

  const isSkillPath = (p: string) => opts.skillPaths.has(p.split('/')[0]);
  const width = Math.min(
    44,
    Math.max(...entries.map((e) => e.path.length)) + 2,
  );

  let flagged = false;
  for (const entry of entries) {
    const note = describeEntry(entry);
    const flag = isSkillPath(entry.path);
    if (flag) flagged = true;
    const pad = note || flag ? entry.path.padEnd(width) : entry.path;
    const line = `    + ${pad}${note ? chalk.dim(note) : ''}`;
    console.log(chalk.green(line) + (flag ? chalk.yellow('  ⚠ skills') : ''));
  }

  if (flagged) {
    // The `skills` CLI closes with "Review skills before use; they run with
    // full agent permissions." That advice was previously unactionable: it
    // named no path, and neither did we. Now the paths are on screen directly
    // above it, and this line ties the warning to them.
    console.log('');
    console.log(
      chalk.yellow("  ⚠ Skill files run with your coding agent's full permissions."),
    );
    console.log(
      chalk.dim('    Review the paths marked ⚠ above before letting an agent use them.'),
    );
  }
  console.log('');
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

// Install the skills catalog from the `@objectstack/skills` package that
// `<pm> install` put in node_modules, for one agent. Returns the package
// version installed, or `null` after a warning naming the remedy.
//
// The sync's exit code is not the verdict: with no package to read it prints
// "Nothing to sync." and exits 0, and it exits 0 having skipped a skill it did
// not install (`skills-install.ts`). So both sides are read here — a catalog
// in the package before the call, and every one of its skills in the agent's
// directory, recorded in the lock as synced from the package, after it — and
// a gap on either is said out loud rather than summarised as "Installed".
function installSkillsFromPackage(
  targetDir: string,
  installed: boolean,
  pm: string,
): string | null {
  const hint = `    ${skillsInstallHint(DEFAULT_SKILLS_AGENT)}`;
  if (!installed) {
    printWarning(
      `Skills not installed: they are read from ${SKILLS_PACKAGE} in node_modules, ` +
        `and \`${pm} install\` did not complete. Once it does, run:\n${hint}`,
    );
    console.log('');
    return null;
  }

  const version = installedSkillsVersion(targetDir);
  const catalog = listSkills(path.join(skillsPackageDir(targetDir), SKILLS_PACKAGE_CATALOG_DIR));
  if (!version || catalog.length === 0) {
    printWarning(
      `Skills not installed: node_modules holds no ${SKILLS_PACKAGE} catalog ` +
        `(${SKILLS_PACKAGE_CATALOG_DIR}/<skill>/SKILL.md) to read. Depend on ${SKILLS_PACKAGE} ` +
        `at your @objectstack/spec version, run \`${pm} install\`, then:\n${hint}`,
    );
    console.log('');
    return null;
  }

  printStep(`Installing AI skills for your coding agent from ${SKILLS_PACKAGE}@${version}...`);
  try {
    execSync(SKILLS_INSTALL_COMMAND, { stdio: 'inherit', cwd: targetDir });
  } catch {
    printWarning(`Skills installation failed. Run manually:\n${hint}`);
    console.log('');
    return null;
  }

  // Both the files and the lock entry: the sync leaves an existing directory
  // it did not write (one from `skills add`) in place and still exits 0.
  const landed = new Set(listSkills(path.join(targetDir, DEFAULT_SKILLS_DIR)));
  const synced = skillsSyncedFromPackage(targetDir);
  const missing = catalog.filter((skill) => !landed.has(skill) || !synced.has(skill));
  if (missing.length > 0) {
    printWarning(
      `Skills installation incomplete: ${missing.length} of ${catalog.length} skill(s) in ` +
        `${SKILLS_PACKAGE}@${version} are not in ${DEFAULT_SKILLS_DIR} as files synced from it ` +
        `(${missing.join(', ')}). The sync leaves a skill installed earlier with \`skills add\` ` +
        `in place: remove it (\`npx skills remove <name> -y\`), then run:\n${hint}`,
    );
    console.log('');
    return null;
  }
  console.log('');
  return version;
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
    for (const line of renderVersionBanner(readCliVersion())) console.log(line);

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

    // Detected once, up front, and reused for every command this run prints or
    // runs — the install line, the failure remedy and the closing "Next
    // steps" all name the SAME package manager. Detecting it here (rather than
    // only inside the install branch) means `--skip-install` still gets an
    // accurate "Next steps" instead of a guess: the probe is a read-only
    // `<pm> --version` check, so running it costs nothing even when there is
    // no install to drive. Previously "Next steps" hardcoded `npm` regardless
    // of which package manager actually ran (fixed by commit 8d21f7a76) — a newcomer who just
    // watched `pnpm install` run was then told `npm run dev`.
    //
    // The probe reports WHY as well as WHAT. `npm` used to mean two different
    // things that nothing downstream could tell apart: "this machine has no
    // pnpm" and "the pnpm probe threw". The second is not a choice, it is a
    // fallback under uncertainty — `pnpm --version` resolves through Corepack
    // and so can fail on a slow or offline network even though pnpm is
    // installed — and a run that stays silent about it tells the reader to
    // type npm without ever admitting it never found out.
    const detected = detectPackageManager();
    const pm = detected.pm;
    if (detected.probe === 'failed') {
      printWarning(
        `pnpm is installed but \`pnpm --version\` failed (${detected.detail}); ` +
          'using npm as a fallback. The commands below name npm because the ' +
          'probe did not answer, not because this project prefers it.',
      );
      console.log('');
    }

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

    // Read BEFORE the first write. Scaffolding into the current directory is
    // the one path that can land in a directory that already had contents
    // (the emptiness refusal above is `!isCurrentDir`-gated), and the closing
    // summary is a walk of the directory — so it must know whether it is
    // entitled to call what it finds "Created files".
    const targetWasEmpty = topLevelNames(targetDir).size === 0;

    try {
      fs.mkdirSync(targetDir, { recursive: true });

      const createdFiles = loadBundled(template.source.dir, targetDir);

      rewriteProjectIdentity(targetDir, projectName, namespace);

      // Progress, not an inventory. The authoritative list is printed at the
      // end, once `<pm> install` and the skills installer have also written —
      // a list printed here cannot name anything either of them creates,
      // which is precisely how the previous summary came to omit AGENTS.md,
      // both lockfiles and ~1.9 MB of agent instructions.
      printSuccess(`Template files written (${createdFiles.length})`);
      console.log('');

      // Hoisted: the skills step below reads its catalog out of what this
      // install put in node_modules, so it needs to know whether it ran.
      let installed = false;
      if (!options.skipInstall) {
        printStep('Installing dependencies...');
        try {
          execSync(`${pm} install`, { stdio: 'inherit', cwd: targetDir });
          installed = true;
          console.log('');
        } catch {
          printWarning(`Dependency installation failed. Run \`${pm} install\` manually.`);
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

      // Which top-level paths belong to the skills install is measured, not
      // assumed. Naming one agent makes the destination set small and
      // knowable (`skills-install.ts`), but it is still THEIR path to choose,
      // and it moves with that package's releases — so the ⚠ marks come from
      // diffing the directory across the call rather than from a list this
      // file would have to keep current.
      const beforeSkills = topLevelNames(targetDir);
      // `--skip-install` implies no skills: the catalog is read out of
      // node_modules, and that run leaves none.
      const skillsVersion =
        !options.skipInstall && !options.skipSkills
          ? installSkillsFromPackage(targetDir, installed, pm)
          : null;
      const skillPaths = new Set(
        [...topLevelNames(targetDir)].filter((p) => !beforeSkills.has(p)),
      );

      printCreatedSummary(targetDir, { wasEmpty: targetWasEmpty, skillPaths });

      printSuccess('Environment created!');
      console.log('');

      console.log(chalk.bold('  Next steps:'));
      if (!isCurrentDir) {
        console.log(chalk.dim(`    cd ${name}`));
      }
      if (options.skipInstall) {
        console.log(chalk.dim(`    ${pm} install`));
      }
      // Same `${pm} run …` shape for both commands, padded to the longer of
      // the two labels so the trailing comments still line up — for either
      // package manager name, not just the `npm`-length one the literal
      // strings above were hand-kerned for.
      const devLabel = `${pm} run dev`;
      const validateLabel = `${pm} run validate`;
      const labelWidth = Math.max(devLabel.length, validateLabel.length) + 3;
      console.log(chalk.dim(`    ${devLabel.padEnd(labelWidth)}# Start development server`));
      console.log(chalk.dim(`    ${validateLabel.padEnd(labelWidth)}# Verify metadata: schema + predicates + bindings`));
      console.log(chalk.dim(`    ${' '.repeat(labelWidth)}# (run after every metadata edit — see AGENTS.md)`));
      // The skills block is printed on EVERY path, not only the skipped one.
      // The install now targets a single agent runtime, so a run that
      // succeeded still leaves every other runtime uninstalled — and a
      // capability that is absent has to say so, with the remedy, rather than
      // leave the reader to discover the gap. The command printed here is the
      // one this scaffolder ran, with a different agent name — and, because
      // the catalog follows the installed package, the same command is also
      // the re-install after an upgrade of the @objectstack/* set.
      console.log('');
      if (skillsVersion) {
        console.log(chalk.bold('  AI Skills:'));
        console.log(
          chalk.dim(
            `    Installed for ${DEFAULT_SKILLS_AGENT} → ${DEFAULT_SKILLS_DIR} from ` +
              `${SKILLS_PACKAGE}@${skillsVersion} — commit it with your project.`,
          ),
        );
        console.log(chalk.dim('    After upgrading the @objectstack/* packages, re-install them at the new version:'));
        console.log(chalk.dim(`      ${skillsInstallHint(DEFAULT_SKILLS_AGENT)}`));
        console.log(chalk.dim('    Using a different agent? Add it one runtime at a time:'));
        console.log(chalk.dim(`      ${skillsInstallHint(EXAMPLE_OTHER_AGENT)}`));
        console.log(chalk.dim('      (an unknown agent name makes the skills CLI list every valid one)'));
      } else {
        console.log(chalk.bold('  AI Skills (recommended):'));
        console.log(
          chalk.dim(
            options.skipInstall
              ? `    Not installed yet — they are read from ${SKILLS_PACKAGE} in node_modules. After \`${pm} install\`:`
              : `    Read from ${SKILLS_PACKAGE} in node_modules, at your @objectstack/spec version:`,
          ),
        );
        console.log(chalk.dim(`    ${skillsInstallHint(DEFAULT_SKILLS_AGENT)}`));
        console.log(
          chalk.dim(`    Replace \`${DEFAULT_SKILLS_AGENT}\` with your own agent runtime if it differs.`),
        );
      }
      console.log('');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      printError(msg);
      process.exit(1);
    }
  });

program.parse();
