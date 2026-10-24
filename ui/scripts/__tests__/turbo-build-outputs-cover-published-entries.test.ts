import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { globToRegExp, rel, repoRoot, workspacePackageDirs } from './helpers/turbo-inputs';

/**
 * objectui#7855 — turbo's `build` task must declare every file the build EMITS
 * that the package then PUBLISHES, or a cache hit restores an incomplete
 * package.
 *
 * `turbo.json`'s `build.outputs` was `["dist/**", ".next/**", "build/**",
 * "**\/*.tsbuildinfo", "!**\/node_modules/**"]`, and `@object-ui/console`
 * publishes its entry from the PACKAGE ROOT:
 *
 *     "main":    "./plugin.js",
 *     "types":   "./plugin.d.ts",
 *     "exports": { ".": { "import": "./plugin.js", … } }
 *
 * Those two files are emitted by `build:plugin` (`tsc -p tsconfig.plugin.json`)
 * and gitignored (`apps/console/.gitignore`), so they matched no `outputs` glob
 * and were neither hashed as inputs nor STORED as outputs. Measured on
 * `bce5971`, one worktree, one fresh `--cache-dir`, cold build then wipe then
 * replay:
 *
 *     @object-ui/console:build: cache hit, replaying logs a218494ab23eb6f3
 *      Tasks: 35 successful, 35 total   Cached: 35 cached, 35 total
 *      Time:  248ms >>> FULL TURBO
 *     apps/console/dist/        restored, 12 entries
 *     apps/console/plugin.js    ABSENT
 *
 *     node scripts/check-node-esm-load.mjs --no-build   → exit 1
 *     ✗ @object-ui/console: no-build-output — ./plugin.js does not exist after the build
 *
 * The tell is the worst kind: a red naming a package the author never touched.
 *
 * ## What this guard asserts
 *
 * One rule over every published entry target of every workspace package: it is
 * either TRACKED SOURCE (shipped as authored) or a BUILD OUTPUT the `build`
 * task declares. An entry that is neither is a file the cache will not restore
 * — which is the defect above, stated so it holds for packages that do not
 * exist yet.
 *
 * ## Why the effective outputs are a UNION spelled out by hand
 *
 * A package-level configuration OVERRIDES the root's key rather than appending
 * to it. turbo 2.10.9's own bundled `schema.json` says so for `extends`
 * (quoted verbatim; it is the version this repo pins):
 *
 *   > This key is only available in Workspace Configs and cannot be used in
 *   > your root `turbo.json`. Tells turbo to extend your root `turbo.json` and
 *   > overrides with the keys provided in your Workspace Configs. Currently,
 *   > only the `["//"]` value is allowed.
 *
 * Measured with `turbo run build --filter=@object-ui/console --dry=json`: a
 * package config declaring `outputs: ["plugin.js", "plugin.d.ts"]` resolves to
 * `outputs ["plugin.d.ts","plugin.js"]` and `excludedOutputs null` — `dist/**`
 * is GONE. So `apps/console/turbo.json` restates the root's globs alongside its
 * two additions, and the second assertion below keeps it that way: a package
 * config that drops a root glob silently stops caching whatever that glob
 * covered, and nothing else in the repository would notice.
 */

/** The turbo task this guard is about. */
const TASK = 'build';

/** Manifest keys that name a published entry file, besides `exports`/`bin`. */
const ENTRY_KEYS = ['main', 'module', 'types', 'typings', 'browser'] as const;

interface EntryTarget {
  /** Where in the manifest it was declared, for the failure message. */
  readonly from: string;
  /** Verbatim, as the manifest spells it. */
  readonly target: string;
  /** Package-relative, `./` stripped. May still contain a `*`. */
  readonly relative: string;
  /** Package-relative, `*` replaced by a probe segment, for output matching. */
  readonly probe: string;
}

interface PackageEntries {
  readonly name: string;
  /** Repo-relative package directory. */
  readonly dir: string;
  readonly hasBuildScript: boolean;
  readonly entries: readonly EntryTarget[];
  /** Effective `outputs` for this package: root task, overridden by its own config. */
  readonly outputs: readonly string[];
}

/**
 * A wildcard subpath export (`"./locales/*": "./dist/locales/*.js"`) is never
 * expanded against the tree on disk. Expanding would make the sweep depend on
 * the tree having been BUILT, and a guard that quietly shrinks to nothing when
 * `dist/` is absent is the failure mode this family exists to prevent. Both
 * questions are answered without it: the git index is searched with the target
 * as a PATTERN, and the output globs are matched against the target with one
 * synthetic segment standing in for the star.
 *
 * Node's `exports` star is NOT a glob star: it matches across `/`, so
 * `"./schemas/*": "./src/schemas/*"` resolves `examples/schema-catalog`'s 431
 * tracked files, which live two directories down. The index search therefore
 * translates it as `.*` rather than reusing the turbo-glob translation, whose
 * `*` stops at a separator — that mismatch flagged a package publishing plain
 * source as if it published an undeclared build output.
 *
 * The one narrowing left is on the coverage side: a single probe segment stands
 * where a star could span directories. It costs nothing here, because every
 * output glob such a target is matched against is a `**` prefix or a literal.
 */
const WILDCARD_PROBE = 'ENTRY';

function entryTargetsOf(manifest: Record<string, unknown>): EntryTarget[] {
  const out: EntryTarget[] = [];
  const push = (from: string, target: unknown): void => {
    if (typeof target !== 'string' || !target.startsWith('.')) return;
    const relative = target.replace(/^\.\//, '');
    out.push({ from, target, relative, probe: relative.split('*').join(WILDCARD_PROBE) });
  };
  for (const key of ENTRY_KEYS) push(key, manifest[key]);
  const walkExports = (node: unknown, trail: string): void => {
    if (typeof node === 'string') return push(`exports${trail}`, node);
    if (node && typeof node === 'object')
      for (const [key, value] of Object.entries(node)) walkExports(value, `${trail}[${key}]`);
  };
  if (manifest.exports !== undefined) walkExports(manifest.exports, '');
  const bin = manifest.bin;
  if (typeof bin === 'string') push('bin', bin);
  else if (bin && typeof bin === 'object')
    for (const [key, value] of Object.entries(bin)) push(`bin[${key}]`, value);
  return out;
}

/** `tasks.<TASK>.outputs` of a turbo config file, or undefined if it declares none. */
function declaredOutputs(configPath: string): string[] | undefined {
  if (!fs.existsSync(configPath)) return undefined;
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as {
    tasks?: Record<string, { outputs?: string[] }>;
  };
  return config.tasks?.[TASK]?.outputs;
}

const ROOT_OUTPUTS = declaredOutputs(path.join(repoRoot, 'turbo.json'));
if (!ROOT_OUTPUTS || ROOT_OUTPUTS.length === 0) {
  throw new Error(`turbo.json must declare \`${TASK}\` outputs`);
}

/** Split turbo's `outputs` into inclusion and `!` exclusion matchers. */
function matchers(outputs: readonly string[]): {
  include: RegExp[];
  exclude: RegExp[];
} {
  const include: RegExp[] = [];
  const exclude: RegExp[] = [];
  for (const glob of outputs) {
    if (glob.startsWith('!')) exclude.push(globToRegExp(glob.slice(1)));
    else include.push(globToRegExp(glob));
  }
  return { include, exclude };
}

function isCovered(probe: string, outputs: readonly string[]): boolean {
  const { include, exclude } = matchers(outputs);
  if (exclude.some((re) => re.test(probe))) return false;
  return include.some((re) => re.test(probe));
}

// ── The sweep, computed once ────────────────────────────────────────────────

const PACKAGES: PackageEntries[] = workspacePackageDirs().map((dir) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const scripts = (manifest.scripts ?? {}) as Record<string, string>;
  return {
    name: (manifest.name as string) ?? rel(dir),
    dir: rel(dir),
    hasBuildScript: Boolean(scripts[TASK]),
    entries: entryTargetsOf(manifest),
    outputs: declaredOutputs(path.join(dir, 'turbo.json')) ?? ROOT_OUTPUTS,
  };
});

/**
 * Files git tracks. An entry inside this set is authored source the package
 * ships as-is; the build task neither produces it nor needs to declare it.
 */
const TRACKED: ReadonlySet<string> = new Set(
  execFileSync('git', ['ls-files'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .filter(Boolean),
);

/**
 * Whether git tracks the entry — i.e. it is authored source the package ships
 * as-is, not something the build task has to declare. A wildcard target is
 * tracked when the index holds any file it matches.
 */
function isTrackedSource(
  pkg: PackageEntries,
  entry: EntryTarget,
  tracked: ReadonlySet<string>,
): boolean {
  const spelled = `${pkg.dir}/${entry.relative}`;
  if (!entry.relative.includes('*')) return tracked.has(spelled);
  const re = subpathPatternToRegExp(spelled);
  for (const file of tracked) if (re.test(file)) return true;
  return false;
}

/**
 * An `exports` subpath pattern as a regular expression, by Node's rule: the
 * single `*` is replaced by the remainder of the subpath, separators included.
 */
function subpathPatternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.split('\\*').join('.*')}$`);
}

/**
 * The predicate, as a pure function of one package's data — so the positive
 * control below can run the REAL rule against a planted entry rather than a
 * paraphrase of it.
 */
function uncoveredEntries(pkg: PackageEntries, tracked: ReadonlySet<string>): EntryTarget[] {
  return pkg.entries.filter(
    (entry) => !isTrackedSource(pkg, entry, tracked) && !isCovered(entry.probe, pkg.outputs),
  );
}

describe('turbo `build` outputs cover every published entry (objectui#7855)', () => {
  /**
   * Liveness. Every assertion below is vacuously true over an empty sweep, and
   * a sweep that silently degrades to nothing is exactly what a guard against
   * "the cache restored less than the package needs" must never become.
   */
  it('sweeps the whole workspace and finds built entries to judge', () => {
    expect(PACKAGES.length).toBeGreaterThan(20);
    const built = PACKAGES.flatMap((pkg) =>
      pkg.entries.filter((entry) => !isTrackedSource(pkg, entry, TRACKED)),
    );
    expect(
      built.length,
      'no workspace package declares an entry that git does not track — either every published ' +
        'entry is now authored source (delete this guard with the defect) or the sweep has ' +
        'stopped finding manifests',
    ).toBeGreaterThan(0);
  });

  it.each(PACKAGES.map((pkg) => [pkg.name, pkg] as const))('%s', (_name, pkg) => {
    const uncovered = uncoveredEntries(pkg, TRACKED);
    expect(
      uncovered.map((entry) => `${entry.from} → ${entry.target}`),
      `${pkg.name} publishes ${uncovered.map((entry) => entry.target).join(', ')} from ` +
        `${pkg.dir}, git does not track ${uncovered.length === 1 ? 'it' : 'them'}, and turbo's ` +
        `\`${TASK}\` outputs for this package are ${JSON.stringify(pkg.outputs)} — which match ` +
        `${uncovered.length === 1 ? 'it' : 'them'} not at all. turbo will not STORE ` +
        `${uncovered.length === 1 ? 'that file' : 'those files'}, so a cache hit restores this ` +
        `package with its declared entry missing and the failure surfaces against whoever ` +
        `builds next. ${
          pkg.hasBuildScript
            ? `Add ${uncovered
                .map((entry) => JSON.stringify(entry.probe))
                .join(', ')} to the outputs — for one package, through a package configuration ` +
              `(\`${pkg.dir}/turbo.json\` with "extends": ["//"]), which must RESTATE the root ` +
              `globs because it overrides rather than appends.`
            : `${pkg.name} declares no \`${TASK}\` script at all, so nothing in the build graph ` +
              `produces this entry: commit it as source, or give the package a build.`
        }`,
    ).toEqual([]);
  });

  /**
   * The trap that comes WITH the fix. A package configuration replaces the
   * root's `outputs` array wholesale (measured above), so trimming one to "just
   * the two files this package adds" silently drops `dist/**` from what turbo
   * stores — and the tree still builds, still passes, and caches half a
   * package. Deliberately conditional on such a config existing: the sweep
   * above is what makes this file non-vacuous.
   */
  it('no package configuration narrows the root `outputs`', () => {
    for (const pkg of PACKAGES) {
      const own = declaredOutputs(path.join(repoRoot, pkg.dir, 'turbo.json'));
      if (!own) continue;
      const missing = ROOT_OUTPUTS.filter((glob) => !own.includes(glob));
      expect(
        missing,
        `${pkg.dir}/turbo.json declares \`${TASK}\` outputs ${JSON.stringify(own)}, which drops ` +
          `${JSON.stringify(missing)} from the root task. A package configuration OVERRIDES the ` +
          `key it declares — it does not append to it — so turbo would stop storing everything ` +
          `those globs cover for this package. Restate the root globs alongside the additions.`,
      ).toEqual([]);
    }
  });

  /**
   * Positive control, run on every invocation. `uncoveredEntries` returning an
   * empty array is the shape of a pass, and it is also the shape of a predicate
   * that has quietly stopped looking at anything. Plant the exact defect
   * objectui#7855 recorded and require the real predicate to name it — then
   * move the same entry under `dist/` and require it to fall silent, so the
   * control cannot pass by flagging everything.
   */
  it('the predicate names a planted root-published entry, and only that one', () => {
    const planted: PackageEntries = {
      name: '@object-ui/fixture-root-published',
      dir: 'packages/fixture-root-published',
      hasBuildScript: true,
      entries: [
        { from: 'main', target: './plugin.js', relative: 'plugin.js', probe: 'plugin.js' },
        {
          from: 'exports[.][import]',
          target: './dist/index.js',
          relative: 'dist/index.js',
          probe: 'dist/index.js',
        },
      ],
      outputs: ROOT_OUTPUTS,
    };
    expect(
      uncoveredEntries(planted, new Set()).map((entry) => entry.target),
      'the predicate did not flag a gitignored entry published from the package root — the ' +
        'defect objectui#7855 recorded would now pass this guard',
    ).toEqual(['./plugin.js']);

    expect(
      uncoveredEntries({ ...planted, outputs: [...ROOT_OUTPUTS, 'plugin.js'] }, new Set()),
      'declaring the entry in `outputs` did not clear it — the predicate flags regardless of ' +
        'what the task declares, so its empty result proves nothing',
    ).toEqual([]);
  });
});
