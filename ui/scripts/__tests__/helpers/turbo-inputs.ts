/**
 * Shared plumbing for the `turbo.json` `inputs` guards.
 *
 * There are two of them now, and they guard the same structural defect on two
 * different tasks:
 *
 *  - `turbo-type-check-inputs.test.ts` (objectui#3514) derives each package's
 *    **tsc program** and asserts `type-check`'s inputs cover it.
 *  - `turbo-test-inputs.test.ts` (objectui#4178) derives each package's
 *    **Vitest configuration program** and asserts `test`'s inputs cover it.
 *
 * The derivations are different in kind and deliberately live apart. What is
 * NOT different is everything around them: which directories are workspace
 * packages, how a `$TURBO_ROOT$` entry is read out of `turbo.json`, and how a
 * turbo input glob is matched against a path. Those three are subtle enough
 * that a second hand-written copy would drift from the first — and a guard that
 * drifts toward *matching more* silently waves through the very files it exists
 * to require. One implementation, used by both.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repo root: this file sits at `scripts/__tests__/helpers/`. */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const turboConfigPath = path.join(repoRoot, 'turbo.json');
const workspaceConfigPath = path.join(repoRoot, 'pnpm-workspace.yaml');

/** POSIX-separated, repo-relative. The one path spelling these guards compare in. */
export function rel(absolute: string): string {
  return path.relative(repoRoot, absolute).split(path.sep).join('/');
}

/**
 * Package directories, derived from `pnpm-workspace.yaml` rather than a
 * hardcoded group list.
 *
 * Only the two entry shapes the file actually uses are understood (`dir/*` and
 * a bare `dir`); anything else throws. A workspace layout a guard silently
 * failed to walk would quietly shrink its own coverage back to nothing, which
 * is the failure mode both guards exist to prevent.
 */
export function workspacePackageDirs(): string[] {
  const yaml = fs.readFileSync(workspaceConfigPath, 'utf8');
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of yaml.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = line.match(/^\s+-\s*['"]?([^'"#]+?)['"]?\s*$/);
      if (item) {
        patterns.push(item[1]);
        continue;
      }
      if (line.trim() !== '') break;
    }
  }
  if (patterns.length === 0) {
    throw new Error('pnpm-workspace.yaml must declare at least one package pattern');
  }

  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith('/*')) {
      const group = path.join(repoRoot, pattern.slice(0, -2));
      if (!fs.existsSync(group)) continue;
      for (const entry of fs.readdirSync(group, { withFileTypes: true })) {
        const dir = path.join(group, entry.name);
        if (entry.isDirectory() && fs.existsSync(path.join(dir, 'package.json'))) dirs.push(dir);
      }
      continue;
    }
    if (!pattern.includes('*')) {
      const dir = path.join(repoRoot, pattern);
      if (fs.existsSync(path.join(dir, 'package.json'))) dirs.push(dir);
      continue;
    }
    throw new Error(
      `pnpm-workspace.yaml pattern ${JSON.stringify(pattern)} is a glob shape this guard does ` +
        `not understand. Teach workspacePackageDirs() about it — do not let the sweep skip it.`,
    );
  }
  return dirs.sort();
}

/** A workspace package that declares the named script, i.e. one turbo's task runs for. */
export interface WorkspacePackage {
  readonly name: string;
  readonly dir: string;
  readonly script: string;
}

/** Every workspace package whose `package.json` declares the given script. */
export function packagesWithScript(script: string): WorkspacePackage[] {
  const out: WorkspacePackage[] = [];
  for (const dir of workspacePackageDirs()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const declared = manifest.scripts?.[script];
    if (declared) out.push({ name: manifest.name ?? rel(dir), dir, script: declared });
  }
  return out;
}

/**
 * The declared `inputs` of a task, verbatim.
 *
 * A task with no `inputs` at all is not "unconfigured" — it is running on
 * turbo's default, which is the defect all four guards exist to close, so the
 * absence throws rather than reading as an empty list.
 */
export function taskInputs(task: string): string[] {
  const turbo = JSON.parse(fs.readFileSync(turboConfigPath, 'utf8')) as {
    tasks?: Record<string, { inputs?: string[] }>;
  };
  const definition = turbo.tasks?.[task];
  if (!definition) throw new Error(`turbo.json must define a \`${task}\` task`);
  const inputs = definition.inputs ?? [];
  if (inputs.length === 0) throw new Error(`turbo.json \`${task}\` must declare \`inputs\``);
  return inputs;
}

/**
 * The `$TURBO_ROOT$`-anchored `inputs` of a task, as repo-relative globs.
 *
 * Everything else in the list is package-relative and therefore cannot reach
 * outside the package directory — turbo has no `..` escape, which is why
 * `$TURBO_ROOT$` exists at all.
 */
export function rootAnchoredInputs(task: string): string[] {
  return taskInputs(task)
    .filter((entry) => entry.startsWith('$TURBO_ROOT$/'))
    .map((entry) => entry.slice('$TURBO_ROOT$/'.length));
}

/**
 * A turbo input glob as a regular expression.
 *
 * Deliberately narrow — `**`, `*` and `?` only. Any richer syntax (brace
 * alternation, character classes, `!` negation) throws instead of being
 * approximated, because an approximated match that comes out TRUE is a file
 * the guards would wave through while turbo does not hash it. Wrong-and-red is
 * recoverable; wrong-and-green is the bug.
 */
export function globToRegExp(glob: string): RegExp {
  if (/[!{}[\]()+@]/.test(glob)) {
    throw new Error(
      `turbo input ${JSON.stringify(glob)} uses glob syntax this guard does not implement. ` +
        `Teach globToRegExp() about it rather than letting it guess.`,
    );
  }
  let pattern = '';
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        // `**/` spans zero or more directories; a trailing `**` spans the rest.
        if (glob[i + 2] === '/') {
          pattern += '(?:[^/]+/)*';
          i += 2;
        } else {
          pattern += '.*';
          i += 1;
        }
      } else {
        pattern += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      pattern += '[^/]';
      continue;
    }
    pattern += char.replace(/[.^$|\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * Every tracked-ish file in the repo, repo-relative — dotted directories and
 * `node_modules` skipped. Used by the phantom-input assertion both guards
 * carry: a `$TURBO_ROOT$` entry matching nothing on disk reads as coverage
 * while hashing nothing.
 */
export function repoFilesOnDisk(): Set<string> {
  const files = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else files.add(rel(abs));
    }
  };
  walk(repoRoot);
  return files;
}
