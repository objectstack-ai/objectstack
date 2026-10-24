import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3663: nothing in this repo ever checked that the paths a package
 * PROMISES to ship in `package.json` `files` actually exist on disk.
 *
 * npm skips a missing `files` entry **silently** — no error, no warning, exit
 * code 0. `npm publish`, `npm pack` and CI are all green while the tarball
 * quietly lacks something the manifest says is in it. There is no output to
 * read, so the drift is not "hard to notice", it is *invisible*.
 *
 * objectui#3647 is that mechanism's specimen: `@object-ui/plugin-tree` listed
 * `"LICENSE"` in `files` while `packages/plugin-tree/LICENSE` did not exist.
 * Every published tarball shipped without the MIT text its own manifest
 * promised, for the package's entire life, and the only reason anyone found out
 * is that a human diffed all 39 packages' `files` fields by hand while chasing
 * an unrelated README problem (objectui#3622). PR #3662 restored the file; this
 * guard is what makes the next one impossible to miss.
 *
 * ## Why the check cannot simply be "the path exists"
 *
 * 40 of the 159 declared entries are BUILD OUTPUT (`dist`, `apps/console`'s
 * `plugin.js`/`plugin.d.ts`). In an unbuilt worktree — which is what CI has when
 * this test runs, and what a contributor has after a fresh clone — those are
 * legitimately absent. Demanding they exist would make the guard fail for
 * everyone always, and a guard that is always red gets deleted or `.skip`ped.
 *
 * So an absent entry is forgiven only when the repo has ALREADY DECLARED,
 * elsewhere and for its own reasons, that the path is generated:
 *
 *   1. it is git-ignored (`.gitignore` says the build writes here), AND
 *   2. it is not git-tracked (a force-added ignored file is a real file and
 *      must exist), AND
 *   3. its package has a `build` script (a package that builds nothing cannot
 *      be about to generate anything).
 *
 * That criterion is DERIVED, never hand-listed. The alternative — a whitelist of
 * blessed entry names in this file — would have to be edited to stay correct,
 * and the edit that silences a real defect looks exactly like the edit that
 * teaches the guard about a new build directory. Deriving it means the only way
 * to exempt a path is to state in `.gitignore` that a build produces it, which
 * is a reviewable claim that is wrong in an obvious way when it is wrong.
 *
 * ## What this guard deliberately does NOT prove
 *
 * That a build output is really produced. Proving that needs an actual build,
 * which is not a static check's job; `dist` is taken on the repo's word here.
 * The gap is narrow and named on purpose: the whole objectui#3647 family —
 * source files (LICENSE, README, CHANGELOG, `src`, `templates`) declared and
 * absent — is inside this guard, and that is where the drift has actually
 * happened.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/**
 * Entries that are declared, absent, and NOT excused by the derived criterion
 * above — i.e. real objectui#3663 defects that were already on `main` when this
 * guard landed.
 *
 * A RATCHET, not an allowlist, in the shape
 * `scripts/i18n-call-site-key-baseline.json` established: a NEW violation fails
 * the build, and an entry here whose defect is GONE fails it too, so this map
 * can only shrink. Fix one by deleting the stale `files` entry from the
 * package's `package.json` and deleting its line here.
 *
 * Currently empty, which is the intended resting state — the ratchet still
 * fails on any NEW violation. It landed carrying two entries measured on
 * main@dae1ac41e, `packages/cli/templates` and
 * `packages/create-plugin/templates`: vestigial declarations for directories
 * that never existed on disk, never existed anywhere in this repo's git
 * history, and that no build step or workflow creates. Both packages inline
 * their templates instead. objectui#3665 banked both by deleting the two
 * `files` entries, and deleting a declaration retires a baseline line exactly
 * as creating the file would.
 */
const KNOWN_MISSING: Record<string, { issue: string }> = {};

interface WorkspacePackage {
  name: string;
  dir: string;
  private: boolean;
  files: string[] | undefined;
  hasBuildScript: boolean;
  /** The `build` script verbatim — the objectui#4059 guard reads it for a CSS step. */
  buildScript: string | undefined;
  /** The `exports` field verbatim, or undefined when the manifest omits it. */
  exports: unknown;
  /** The `license` field verbatim, or undefined when the manifest omits it. */
  license: string | undefined;
}

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, read rather than hardcoded
 * so a new workspace root is covered the day it is added.
 *
 * Understands only the two shapes the file actually uses (`dir/*` and a bare
 * `dir`); anything else throws instead of being skipped. A guard that silently
 * stops looking at part of the workspace is worse than no guard, because it
 * goes on reporting success over a shrinking surface.
 */
function workspaceGlobs(): string[] {
  const yaml = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8');
  const lines = yaml.split('\n');
  const start = lines.findIndex((l) => /^packages:\s*$/.test(l));
  expect(start, '`pnpm-workspace.yaml` must still declare a top-level `packages:` key').toBeGreaterThan(-1);

  const globs: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    // A non-indented line ends the `packages:` block.
    if (!/^\s/.test(line)) break;
    const match = line.match(/^\s*-\s*['"]?([^'"#\s]+)['"]?\s*(#.*)?$/);
    if (!match) {
      throw new Error(
        `Unparsed entry in pnpm-workspace.yaml \`packages:\`: ${JSON.stringify(line)} — teach this guard the new syntax.`,
      );
    }
    globs.push(match[1]);
  }
  return globs;
}

function readWorkspacePackages(): WorkspacePackage[] {
  const found: WorkspacePackage[] = [];
  for (const glob of workspaceGlobs()) {
    let dirs: string[];
    if (glob.endsWith('/*')) {
      const parent = path.join(repoRoot, glob.slice(0, -2));
      dirs = fs.existsSync(parent)
        ? fs
            .readdirSync(parent)
            .map((d) => path.join(parent, d))
            .filter((d) => fs.statSync(d).isDirectory())
        : [];
    } else if (!glob.includes('*')) {
      dirs = [path.join(repoRoot, glob)];
    } else {
      throw new Error(`Unsupported workspace glob ${JSON.stringify(glob)} — teach this guard how to expand it.`);
    }

    for (const dir of dirs) {
      const pkgPath = path.join(dir, 'package.json');
      if (!fs.existsSync(pkgPath)) continue;
      const json = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (!json.name) continue;
      found.push({
        name: json.name,
        dir: path.relative(repoRoot, dir).split(path.sep).join('/'),
        private: Boolean(json.private),
        files: Array.isArray(json.files) ? json.files : undefined,
        hasBuildScript: Boolean(json.scripts?.build),
        buildScript: typeof json.scripts?.build === 'string' ? json.scripts.build : undefined,
        exports: json.exports,
        license: typeof json.license === 'string' ? json.license : undefined,
      });
    }
  }
  return found;
}

/**
 * Every path git has in its index, plus every ancestor directory of one, so a
 * DIRECTORY entry such as `src` can be asked the same question as a file entry.
 *
 * Fails loudly if git is not usable. Returning an empty set instead would make
 * every entry look untracked, which quietly WIDENS the exemption below — the
 * failure mode this whole file exists to prevent.
 */
function gitTrackedPaths(): Set<string> {
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 });
  if (result.status !== 0) {
    throw new Error(
      `\`git ls-files\` failed in ${repoRoot} (status ${result.status}): ${result.stderr}\n` +
        'This guard derives its build-output exemption from git, so it fails closed rather than passing over an unknown tree.',
    );
  }
  const tracked = new Set<string>();
  for (const file of result.stdout.split('\0')) {
    if (!file) continue;
    tracked.add(file);
    let dir = path.posix.dirname(file);
    while (dir && dir !== '.') {
      tracked.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  return tracked;
}

/**
 * Which of `candidates` `.gitignore` excludes, resolved in ONE `git
 * check-ignore` call. Same fail-closed contract as {@link gitTrackedPaths}:
 * exit 0 means "some were ignored", 1 means "none were", anything else is an
 * error rather than an empty answer.
 */
function gitIgnoredPaths(candidates: string[]): Set<string> {
  if (candidates.length === 0) return new Set();
  const result = spawnSync('git', ['check-ignore', '--stdin'], {
    cwd: repoRoot,
    input: candidates.join('\n'),
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `\`git check-ignore\` failed in ${repoRoot} (status ${result.status}): ${result.stderr}\n` +
        'This guard derives its build-output exemption from git, so it fails closed rather than passing over an unknown tree.',
    );
  }
  return new Set(result.stdout.split('\n').filter(Boolean));
}

interface DeclaredEntry {
  pkg: WorkspacePackage;
  entry: string;
  /** Repo-relative, forward-slashed — the key used by git and by KNOWN_MISSING. */
  relPath: string;
  onDisk: boolean;
}

const packages = readWorkspacePackages();
const packagesWithFiles = packages.filter((p) => p.files !== undefined);

const declared: DeclaredEntry[] = packagesWithFiles.flatMap((pkg) =>
  pkg.files!.map((entry) => {
    const relPath = path.posix.join(pkg.dir, entry);
    return { pkg, entry, relPath, onDisk: fs.existsSync(path.join(repoRoot, relPath)) };
  }),
);

const tracked = gitTrackedPaths();
const ignored = gitIgnoredPaths(declared.filter((d) => !d.onDisk).map((d) => d.relPath));

/** An absent entry the repo has already declared to be build output. */
function isDeclaredBuildOutput(d: DeclaredEntry): boolean {
  return ignored.has(d.relPath) && !tracked.has(d.relPath) && d.pkg.hasBuildScript;
}

const missing = declared.filter((d) => !d.onDisk && !isDeclaredBuildOutput(d));

describe('package.json `files` entries exist on disk (objectui#3663)', () => {
  it('discovers the workspace (guard cannot pass by finding nothing)', () => {
    // npm's silence is the whole hazard here, so a guard that inspects an empty
    // list would reproduce it exactly: green output, nothing checked. These
    // floors sit just under the measured values on main@dae1ac41e (40 packages
    // declaring `files`, 159 entries) so that losing a workspace root, a broken
    // glob parser or a moved directory is a failure and not a quiet pass.
    expect(packagesWithFiles.length).toBeGreaterThanOrEqual(38);
    expect(declared.length).toBeGreaterThanOrEqual(150);

    // The specimen package must be in scope by name: if plugin-tree ever drops
    // out of the scan, the guard has stopped watching the exact spot that
    // motivated it.
    const pluginTree = packagesWithFiles.find((p) => p.name === '@object-ui/plugin-tree');
    expect(pluginTree, '@object-ui/plugin-tree must still be scanned').toBeDefined();
    expect(pluginTree!.files).toContain('LICENSE');
  });

  it('declares no glob patterns (this guard resolves literal paths only)', () => {
    // npm's `files` accepts globs and `!` negations. None are used today, and
    // `fs.existsSync('dist/**')` is false for a perfectly healthy package — so
    // the first glob to land here would be reported as a missing file. Naming
    // that as its own failure means the next author gets "teach the guard" and
    // not a baffling false positive on a path they know is fine.
    const globbed = declared.filter((d) => /[*?[\]{}!]/.test(d.entry)).map((d) => `${d.pkg.name}: ${d.entry}`);

    expect(
      globbed,
      [
        'A `files` entry uses glob syntax, which this guard cannot resolve.',
        'Teach scripts/__tests__/package-files-exist.test.ts to expand globs before adding one.',
        '',
        ...globbed,
      ].join('\n'),
    ).toEqual([]);
  });

  it('every declared entry exists on disk, or is declared build output', () => {
    const violations = missing
      .filter((d) => !Object.hasOwn(KNOWN_MISSING, d.relPath))
      .map(
        (d) =>
          `${d.pkg.name}${d.pkg.private ? ' (private)' : ''} declares "${d.entry}" in package.json "files", ` +
          `but ${d.relPath} does not exist` +
          (d.pkg.hasBuildScript ? '' : ' (and the package has no `build` script that could create it)'),
      );

    expect(
      violations,
      [
        'A package promises to publish a path that is not there.',
        'npm skips a missing `files` entry SILENTLY — no error, no warning, exit code 0 — so',
        'the tarball ships without it and nothing downstream ever says so (objectui#3647/#3663).',
        '',
        'Fix it in whichever direction is true:',
        '  - the file should ship  -> create it (that was the fix in PR #3662)',
        '  - the file is obsolete  -> delete the entry from `files`',
        '  - it is build output    -> git-ignore the path and give the package a `build` script,',
        '                             which is how this guard recognises generated paths',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('the objectui#3647 baseline only shrinks', () => {
    // The other half of a ratchet. Without this, a fixed entry could sit here
    // forever and the next reader would take a stale line as a live defect —
    // and the file would slowly turn into the permanent allowlist it is not.
    const stillMissing = new Set(missing.map((d) => d.relPath));
    const stale = Object.keys(KNOWN_MISSING).filter((relPath) => !stillMissing.has(relPath));

    // WHY an entry stopped being a live defect, reported per entry instead of
    // assumed. An entry leaves `missing` by exactly the three routes the
    // assertion above sanctions as fixes, and only the first makes the path
    // resolve — so a message hardcoded to "the path now resolves" is wrong two
    // times in three, and sends the reader off to `ls` a path that is still
    // absent (objectui#3674, seen for real in objectui#3665). Derived from the
    // same `declared`/`missing` data the predicate reads, so it cannot drift
    // from the verdict it explains.
    const causeOf = (relPath: string): string => {
      const entry = declared.find((d) => d.relPath === relPath);
      if (!entry)
        return 'no `files` entry declares it: the declaration was deleted, its package left the workspace, or this baseline key never matched one';
      if (entry.onDisk) return 'the path now exists on disk';
      return 'still declared and still absent, but now excused as build output (git-ignored, untracked, package has a `build` script)';
    };

    expect(
      stale,
      [
        'A KNOWN_MISSING entry no longer describes a live defect.',
        'Delete its line from KNOWN_MISSING in this file to bank the progress — that is the',
        'right move under every cause below.',
        '',
        'The cause is reported per entry rather than assumed, because only one of the three',
        'routes out of the baseline makes the path resolve; do not read a stale line as',
        'proof that the file is now there.',
        '',
        ...stale.map((relPath) => `${relPath} (${KNOWN_MISSING[relPath].issue}) — ${causeOf(relPath)}`),
      ].join('\n'),
    ).toEqual([]);
  });

  it('pins the package fixed in objectui#3647', () => {
    // The general assertion above covers this too, but naming it means a revert
    // points straight at the issue that explains why the file has to be there.
    const licensePath = path.join(repoRoot, 'packages/plugin-tree/LICENSE');
    expect(
      fs.existsSync(licensePath),
      '@object-ui/plugin-tree lists "LICENSE" in `files`; PR #3662 added packages/plugin-tree/LICENSE ' +
        'because every published tarball had been shipping without it. npm will not complain if it goes missing again.',
    ).toBe(true);
  });
});

/**
 * objectui#3696: the guard above can only ask whether a path a package
 * PROMISED in `files` is real. A package that never made the promise is
 * invisible to it — and the license text is exactly the file nobody promises,
 * because npm ships it whether you list it or not.
 *
 * ## Why `files` is the wrong place to look for this one
 *
 * npm keeps a small set of paths it packs REGARDLESS of `files`:
 * `package.json`, `README*`, `LICENSE*`/`LICENCE*`, `COPYING*`, and the `main`
 * entry. Measured on `packages/sdui-parser` (which declares `files: ["dist"]`)
 * by renaming one file and re-running `npm pack --dry-run`:
 *
 *   LICENSE / License / LICENCE / LICENSE.md / LICENSE.txt -> packed
 *   copying                                                -> packed
 *   NOTICE / CHANGELOG.md / NOTALICENSE                     -> NOT packed
 *
 * So `files: ["dist"]` never excluded the license text, and adding `"LICENSE"`
 * to `files` would not have included it. `@object-ui/react-runtime` and
 * `@object-ui/sdui-parser` shipped every version of themselves declaring
 * `"license": "MIT"` with no MIT text and no copyright notice in the tarball,
 * for one reason only: the file was not on disk. That is what this guard reads.
 *
 * ## The predicate
 *
 * `!private && license` — the two conditions that together turn "MIT" from a
 * label into an obligation. A private package makes no distribution and owes no
 * text (`object-ui`, the vscode-extension, is exactly that case and is excluded
 * on purpose). A package declaring no license at all is a different defect that
 * this guard deliberately does not invent a verdict about.
 *
 * The population is DERIVED from the same workspace scan as the guard above, so
 * a 40th package is covered the day it is added rather than the day someone
 * repeats the by-hand census. objectui#3647 and objectui#3696 were both found
 * by a human diffing every package by hand; twice in one week is the argument
 * for a gate, not for more care.
 */

/**
 * Spellings that count as license text. The `licen[cs]e` family from npm's
 * always-packed set above, with an optional extension.
 *
 * `COPYING` is packed by npm too but is deliberately NOT accepted: every one of
 * this repo's 38 license files is spelled `LICENSE`, and a guard that silently
 * blesses a spelling the repo does not use would report success over a
 * convention drift. Landing a `COPYING` should turn this red and be widened
 * here on purpose.
 */
const LICENSE_TEXT_RE = /^licen[cs]e(\.[^.]+)?$/i;

/** Every license-text file in a package directory, by name. */
function licenseTextFiles(pkg: WorkspacePackage): string[] {
  const dir = path.join(repoRoot, pkg.dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => LICENSE_TEXT_RE.test(name))
    .sort();
}

/**
 * Whether a package owes license text. Split out from the filter below so the
 * truth table can be asserted directly: two of its four cases have no specimen
 * in the tree today (every non-private package declares a license), and a
 * predicate limb no test ever walks is one a later edit can invert with nothing
 * turning red.
 */
function owesLicenseText(pkg: Pick<WorkspacePackage, 'private' | 'license'>): boolean {
  return !pkg.private && pkg.license !== undefined && pkg.license.trim() !== '';
}

const owingPackages = packages.filter(owesLicenseText);
const withoutLicenseText = owingPackages.filter((p) => licenseTextFiles(p).length === 0);

/**
 * Packages that owed license text and did not have it when this guard landed,
 * measured on main@3e601773e.
 *
 * A RATCHET in the same shape as {@link KNOWN_MISSING}: a NEW offender fails
 * without consulting this map, and an entry here that is no longer offending
 * fails too, so it can only shrink.
 *
 * Currently empty, which is the intended resting state — the ratchet still
 * fails on any NEW offender. It was written carrying one entry,
 * `apps/console` (`@object-ui/console`): published for real
 * (`publishConfig.access: "public"`, versioned 17.3.0 with the rest, in the
 * `.changeset/config.json` `fixed` group) with the identical defect to the two
 * packages objectui#3696 fixed, but outside that issue's `packages/*` scope, so
 * it was booked to objectui#3702 instead of fixed silently. Triage folded
 * objectui#3702 into the same PR, the root LICENSE was copied to
 * `apps/console/LICENSE`, and the entry was banked — the ratchet reported it
 * stale first, naming the cause (`it now ships license text (LICENSE)`).
 */
const KNOWN_LICENSE_TEXT_MISSING: Record<string, { issue: string }> = {};

describe('published packages that declare a license ship its text (objectui#3696)', () => {
  it('discovers the packages that owe license text (guard cannot pass by finding nothing)', () => {
    // Same anti-vacuity floor as the guard above, sitting just under the 39
    // measured on main@3e601773e. A predicate that quietly matches nothing —
    // a renamed `license` field, a lost workspace root, a `private` default
    // flipped — would otherwise report success over an empty set.
    expect(owingPackages.length).toBeGreaterThanOrEqual(38);

    // The two packages objectui#3696 fixed must be in scope BY NAME. If either
    // drops out of the population, this guard has stopped watching the exact
    // spot that motivated it, and the pin below would pass on a package nobody
    // is checking any more.
    const names = owingPackages.map((p) => p.name);
    expect(names, '@object-ui/react-runtime must still be required to ship license text').toContain(
      '@object-ui/react-runtime',
    );
    expect(names, '@object-ui/sdui-parser must still be required to ship license text').toContain(
      '@object-ui/sdui-parser',
    );
  });

  it('every package that declares a license has the text on disk', () => {
    const violations = withoutLicenseText
      .filter((p) => !Object.hasOwn(KNOWN_LICENSE_TEXT_MISSING, p.dir))
      .map((p) => `${p.name} (${p.dir}) declares "license": "${p.license}" but has no LICENSE file`);

    expect(
      violations,
      [
        'A published package claims a license in package.json and ships no license text.',
        'The MIT terms require the licence and copyright notice to travel WITH the distribution,',
        'so the published tarball does not actually grant what its own manifest advertises',
        '(objectui#3647/#3696).',
        '',
        'npm packs LICENSE regardless of `files`, so the fix is the file itself, never a `files` entry:',
        '  cp LICENSE <package-dir>/LICENSE      # all 38 are byte-identical, blob cf2ca285',
        '',
        'If the package should NOT be published, mark it `"private": true` instead — that is the',
        'other true direction, and it is why `object-ui` (the vscode-extension) is not listed here.',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('the objectui#3696 license baseline only shrinks', () => {
    // The other half of the ratchet, kept separate from the objectui#3663 one
    // above so a stale entry names its own defect class.
    const stillMissing = new Set(withoutLicenseText.map((p) => p.dir));
    const stale = Object.keys(KNOWN_LICENSE_TEXT_MISSING).filter((dir) => !stillMissing.has(dir));

    // WHY an entry stopped being a live defect, reported per entry rather than
    // assumed — the convention objectui#3701 established for the baseline
    // above, and for the same reason. An entry leaves this baseline by four
    // routes and only the FIRST means someone added the licence: the other
    // three mean the package stopped owing one, which is a different fact with
    // a different reviewer response. Derived from the same data the predicate
    // reads, so it cannot drift from the verdict it explains.
    const causeOf = (dir: string): string => {
      const pkg = packages.find((p) => p.dir === dir);
      if (!pkg)
        return 'no package sits at that path any more: it was moved or removed from the workspace, or this baseline key never matched one';
      const texts = licenseTextFiles(pkg);
      if (texts.length > 0) return `it now ships license text (${texts.join(', ')})`;
      if (pkg.private) return 'it is now `private`, so it distributes nothing and owes no text';
      return 'it no longer declares a `license` field, so there is no claim left to honour';
    };

    expect(
      stale,
      [
        'A KNOWN_LICENSE_TEXT_MISSING entry no longer describes a live defect.',
        'Delete its line from KNOWN_LICENSE_TEXT_MISSING to bank the progress — that is the',
        'right move under every cause below.',
        '',
        'The cause is reported per entry rather than assumed, because only one of the four',
        'routes out of this baseline means the licence was actually added; do not read a stale',
        'line as proof that the package now ships its terms.',
        '',
        ...stale.map((dir) => `${dir} (${KNOWN_LICENSE_TEXT_MISSING[dir].issue}) — ${causeOf(dir)}`),
      ].join('\n'),
    ).toEqual([]);
  });

  it('pins the three packages fixed in objectui#3696 / objectui#3702', () => {
    // The general assertion covers these, but naming them means a revert points
    // straight at the issue that explains why the files have to be there —
    // and, unlike the general assertion, this cannot be satisfied by adding a
    // baseline line.
    const fixed: Record<string, string> = {
      'packages/react-runtime': 'objectui#3696',
      'packages/sdui-parser': 'objectui#3696',
      // Found by re-running objectui#3696's census over ALL FOUR workspace
      // roots instead of `packages/*` alone, which is how it was missed twice.
      'apps/console': 'objectui#3702',
    };

    for (const [dir, issue] of Object.entries(fixed)) {
      expect(
        fs.existsSync(path.join(repoRoot, dir, 'LICENSE')),
        `${dir}/LICENSE is required: the package declares "license": "MIT" and npm packs the file ` +
          'regardless of `files`, so deleting it silently resumes publishing MIT-labelled tarballs ' +
          `with no MIT text (${issue}).`,
      ).toBe(true);
    }
  });

  it('requires license text only from packages that publish AND declare a license', () => {
    // The predicate's truth table, asserted directly. Two of these four rows
    // have no specimen in the tree today — every non-private package declares a
    // license — so without this they would be untested logic that a later edit
    // could invert with nothing turning red.
    expect(owesLicenseText({ private: false, license: 'MIT' }), 'published + declared -> owes').toBe(true);
    expect(owesLicenseText({ private: true, license: 'MIT' }), 'private -> makes no distribution').toBe(false);
    expect(owesLicenseText({ private: false, license: undefined }), 'no claim -> nothing to honour').toBe(false);
    expect(owesLicenseText({ private: false, license: '  ' }), 'blank claim is not a claim').toBe(false);
  });

  it('excludes private packages, and that exclusion is not vacuous', () => {
    // The `private` limb only means something while some private package would
    // otherwise be reported. Asserting the specimen set is NON-EMPTY first is
    // what keeps this from becoming a test that passes because it examines
    // nothing — today it is `object-ui` (packages/vscode-extension), which
    // declares "MIT" and has no LICENSE file.
    const privateOwingIfPublished = packages.filter(
      (p) => p.private && p.license !== undefined && licenseTextFiles(p).length === 0,
    );

    expect(
      privateOwingIfPublished.map((p) => p.name),
      'No private package declares a license without shipping its text any more, so this boundary ' +
        'case now proves nothing. Either pick a live specimen or delete this test — do not leave it ' +
        'green over an empty set.',
    ).not.toEqual([]);

    const reported = new Set(withoutLicenseText.map((p) => p.name));
    for (const pkg of privateOwingIfPublished) {
      expect(reported.has(pkg.name), `${pkg.name} is private and must not be required to ship license text`).toBe(
        false,
      );
    }
  });
});

/**
 * objectui#4059: the two guards above ask whether a path a package promised in
 * `files` is real, and whether a package that claims a license ships its text.
 * Neither can see the OTHER promise a manifest makes — `exports`.
 *
 * ## The specimen
 *
 * `@object-ui/fields` declared
 *
 *   "exports": { "./style.css": "./dist/index.css" }
 *
 * while `scripts.build` was `tsc && vite build`, `src` held no `.css` file at
 * all, and nothing anywhere produced `dist/index.css`. Every published tarball
 * up to and including 17.3.0 contained ZERO `.css` files. A consumer writing the
 * `@import '@object-ui/fields/style.css'` that `content/docs/guide/quick-start.md`
 * taught did not get a badly-styled page — the specifier failed to resolve and
 * took their build down.
 *
 * Nothing in this repo noticed for the package's entire life, and the reason is
 * structural rather than careless: no in-repo consumer imports the subpath.
 * `apps/console`, `examples/console-starter` and `examples/byo-backend-console`
 * all reach fields' SOURCE through `@source '.../packages/fields/src/**'`, a
 * workspace-relative path no published consumer can write. So the repo's own
 * rendering proved nothing about the artifact, and the export was free to lie.
 *
 * ## Why the objectui#3663 guard above does not already cover this
 *
 * It would forgive this defect, correctly, under its own rules: `dist/index.css`
 * is git-ignored, untracked, and `@object-ui/fields` has a `build` script, so the
 * path is "declared build output" and taken on the repo's word. That guard says
 * so itself — *"What this guard deliberately does NOT prove: that a build output
 * is really produced."* This section closes exactly that gap for the one file
 * type where the question is decidable statically.
 *
 * ## The two questions asked here
 *
 *   1. **Packability.** Is the target inside something `files` ships? An export
 *      pointing outside the packed set can never resolve, whatever the build
 *      does. (`@object-ui/app-shell` is the live positive case: it exports
 *      `./styles.css` -> `./src/styles.css` and lists `src/styles.css` in `files`
 *      precisely so the subpath resolves.)
 *   2. **Producibility, for stylesheets.** A `.css` target that is not on disk
 *      has to be generated by something. Unlike `dist/index.js` — which any
 *      bundler build emits by construction — a stylesheet appears only if the
 *      package has a CSS source in its entry graph or an explicit CSS build
 *      step. Both are readable from the manifest and the tree, so this one does
 *      not need a build to answer.
 *
 * `.js`/`.d.ts` targets are deliberately NOT given a producibility test: there is
 * no honest static answer for them, and a guard that guessed would either be
 * noise or a false green. The gap is named rather than papered over — same
 * discipline as the objectui#3663 block above.
 */

/** A single `exports` target, flattened out of the condition tree. */
interface DeclaredExport {
  pkg: WorkspacePackage;
  /** The subpath key, e.g. `.` or `./style.css`. */
  subpath: string;
  /** The condition path that reached it, e.g. `import` or `types`; empty for a bare string. */
  condition: string;
  /** The target verbatim, e.g. `./dist/index.css`. */
  target: string;
  /** Repo-relative, forward-slashed. */
  relPath: string;
  /** `exports` may use `*` patterns (`@object-ui/i18n` does); those resolve to no single file. */
  hasWildcard: boolean;
  onDisk: boolean;
}

/**
 * Flattens `exports` into one entry per target string.
 *
 * Conditions nest arbitrarily (`{ ".": { "import": { "types": "..." } } }`), and
 * every leaf string is a path that has to resolve, so the walk recurses rather
 * than reading a fixed set of condition names. A leaf that is `null` is npm's
 * "explicitly not exported" and carries no path.
 */
function flattenExports(pkg: WorkspacePackage): DeclaredExport[] {
  const out: DeclaredExport[] = [];

  const walk = (node: unknown, subpath: string, condition: string): void => {
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
      const target = node;
      // Only relative targets name a file in this package; a bare specifier is a
      // re-export of a dependency and is that package's problem, not ours.
      if (!target.startsWith('./')) return;
      const relPath = path.posix.join(pkg.dir, target.slice(2));
      out.push({
        pkg,
        subpath,
        condition,
        target,
        relPath,
        hasWildcard: target.includes('*'),
        onDisk: !target.includes('*') && fs.existsSync(path.join(repoRoot, relPath)),
      });
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key.startsWith('.')) walk(value, key, condition);
      else walk(value, subpath, condition ? `${condition}.${key}` : key);
    }
  };

  // `exports` may be a bare string (sugar for `{ ".": "..." }`).
  walk(pkg.exports, '.', '');
  return out;
}

/**
 * Paths npm packs whether or not `files` lists them. Copied from the
 * objectui#3696 block above, which measured this set with `npm pack --dry-run`
 * rather than reading the docs.
 */
const ALWAYS_PACKED_RE = /^(package\.json|readme(\.[^.]+)?|licen[cs]e(\.[^.]+)?|copying(\.[^.]+)?)$/i;

/** Whether `files` (or npm's always-packed set) covers a target path. */
function isPackable(entry: DeclaredExport): boolean {
  // No `files` field at all means npm packs everything not otherwise ignored.
  if (entry.pkg.files === undefined) return true;

  const rel = entry.target.slice(2);
  if (ALWAYS_PACKED_RE.test(rel)) return true;

  return entry.pkg.files.some((declared) => {
    const normalised = declared.replace(/^\.\//, '').replace(/\/$/, '');
    return rel === normalised || rel.startsWith(`${normalised}/`);
  });
}

/**
 * Whether a package can produce a stylesheet at all.
 *
 * Derived from two independently sufficient facts, never a package-name list:
 *
 *   1. its `build` script runs a CSS step — both real ones are spelled
 *      `node scripts/build-css.mjs`, so the marker is the script name rather
 *      than any particular package; or
 *   2. it has a `.css` file under `src/`, which a bundler library build extracts
 *      into `dist` when it is in the entry graph.
 *
 * A name-keyed allowlist was the alternative and is worse in the specific way
 * this file keeps warning about: the edit that exempts a genuinely broken
 * package would be indistinguishable from the edit that teaches the guard about
 * a new build pipeline. Both facts here are claims about the package's own
 * plumbing, and both are wrong in an obvious way when they are wrong.
 */
function hasCssProducer(pkg: WorkspacePackage): boolean {
  if (pkg.buildScript !== undefined && /build-css/.test(pkg.buildScript)) return true;

  const srcDir = path.join(repoRoot, pkg.dir, 'src');
  if (!fs.existsSync(srcDir)) return false;

  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (dirent.name === 'node_modules') continue;
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) stack.push(full);
      else if (dirent.name.endsWith('.css')) return true;
    }
  }
  return false;
}

const packagesWithExports = packages.filter((p) => p.exports !== undefined);
const declaredExports = packagesWithExports.flatMap(flattenExports);

/** Export targets that must be GENERATED — absent, and not a wildcard pattern. */
const generatedExports = declaredExports.filter((e) => !e.hasWildcard && !e.onDisk);
const exportIgnored = gitIgnoredPaths(generatedExports.map((e) => e.relPath));

/**
 * Stylesheet targets that no committed file supplies, so something has to build
 * them.
 *
 * Keyed on git's index rather than on `onDisk`, and that difference is the whole
 * point: `onDisk` answers differently in a built tree than in a fresh clone, so
 * a producibility check built on it would quietly skip the package it is meant
 * to watch for anyone who had run a build. This was not theoretical — the
 * reverse verification for objectui#4059 first ran against a tree where
 * `packages/fields/dist/index.css` was already sitting there from a local build,
 * and the assertion below passed on the very state it exists to reject. Git's
 * index does not move when you run `pnpm build`, so this population is the same
 * in CI, in a fresh clone and on a machine mid-work.
 *
 * `@object-ui/app-shell` falls out of scope here for the right reason: its
 * `./styles.css` points at `src/styles.css`, which is tracked, so it is a source
 * file that ships rather than something a build owes.
 */
const generatedCssExports = declaredExports.filter(
  (e) => !e.hasWildcard && e.target.endsWith('.css') && !tracked.has(e.relPath),
);

/** The same derived build-output exemption the objectui#3663 guard uses. */
function isExportBuildOutput(entry: DeclaredExport): boolean {
  return exportIgnored.has(entry.relPath) && !tracked.has(entry.relPath) && entry.pkg.hasBuildScript;
}

/**
 * Live objectui#4059 defects that were on `main` when this guard landed.
 *
 * A RATCHET in the shape the two baselines above established: a NEW violation
 * fails without consulting this map, and an entry here whose defect is gone
 * fails too, so it can only shrink.
 *
 * Empty, and that is the resting state, not an oversight — the one defect it was
 * written for (`@object-ui/fields`' `./style.css`) is fixed in the same commit
 * that adds this guard, by giving the package a real CSS build rather than by
 * deleting the export. Landing the guard first would have put a red gate on
 * `main`; landing the fix without the guard would leave the class free to recur.
 */
const KNOWN_UNSHIPPABLE_EXPORTS: Record<string, { issue: string }> = {};

const exportKey = (e: DeclaredExport): string => `${e.pkg.name}${e.subpath === '.' ? '' : e.subpath.slice(1)} -> ${e.target}`;

describe('every declared `exports` subpath resolves to a file that ships (objectui#4059)', () => {
  it('discovers the exports surface (guard cannot pass by finding nothing)', () => {
    // Same anti-vacuity floor as the two guards above, sitting just under the
    // values measured on main@59df371f7 (38 packages declaring `exports`, 140
    // target strings). A broken flattener, a lost workspace root or a renamed
    // field would otherwise report success over an empty set — which is the
    // failure mode this whole file exists to prevent.
    expect(packagesWithExports.length).toBeGreaterThanOrEqual(36);
    expect(declaredExports.length).toBeGreaterThanOrEqual(130);

    // The specimen and its control must be in scope BY NAME and BY SUBPATH. Both
    // declare the identical `"./style.css": "./dist/index.css"`; the only
    // difference was ever that one of them built the file.
    for (const name of ['@object-ui/fields', '@object-ui/components']) {
      const styleExport = declaredExports.find((e) => e.pkg.name === name && e.subpath === './style.css');
      expect(styleExport, `${name} must still declare a ./style.css export for this guard to watch`).toBeDefined();
      expect(styleExport!.target).toBe('./dist/index.css');
    }

    // The producibility population specifically, since it is the one this issue
    // turns on and the one whose emptiness would be silent. Every `./style.css`
    // export must be in it whether or not the tree has been built.
    //
    // This list GREW from `['@object-ui/components', '@object-ui/fields']` to the
    // four below in objectui#4929, and the clause that moved it is the maintainer
    // ruling of 2026-08-17 on that card: "every `@object-ui/plugin-*` ships its own
    // stylesheet ... Scope today: `plugin-grid` + `plugin-kanban` (the two with
    // measured classes); the build step is the pattern any future plugin inherits."
    // So the set is expected to keep growing as further plugins adopt the step —
    // and each addition has to arrive the same way, with a package that really
    // declares `"./style.css"` and really builds it. Shrinking it, by contrast,
    // means a package stopped producing a sheet it still promises: that is
    // objectui#4059's defect returning, and the failure this line should raise.
    expect(generatedCssExports.map((e) => e.pkg.name).sort()).toEqual([
      '@object-ui/components',
      '@object-ui/fields',
      '@object-ui/plugin-grid',
      '@object-ui/plugin-kanban',
    ]);
  });

  it('every export target is inside something `files` ships', () => {
    const violations = declaredExports
      .filter((e) => !isPackable(e))
      .filter((e) => !Object.hasOwn(KNOWN_UNSHIPPABLE_EXPORTS, exportKey(e)))
      .map(
        (e) =>
          `${e.pkg.name} exports "${e.subpath}" -> "${e.target}", but "files" (${JSON.stringify(e.pkg.files)}) ` +
          'does not cover that path, so npm will not pack it',
      );

    expect(
      violations,
      [
        'An `exports` subpath points outside the published tarball.',
        'npm packs `files` and nothing else, so this specifier can never resolve for a consumer',
        'no matter what the build produces (objectui#4059).',
        '',
        'Fix it in whichever direction is true:',
        '  - the file should ship -> add its path to `files` (that is why @object-ui/app-shell',
        '                            lists "src/styles.css" alongside "dist")',
        '  - the export is wrong  -> point it at the built artifact, or delete the subpath',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('every export target exists on disk, or is declared build output', () => {
    const violations = generatedExports
      .filter((e) => !isExportBuildOutput(e))
      .filter((e) => !Object.hasOwn(KNOWN_UNSHIPPABLE_EXPORTS, exportKey(e)))
      .map(
        (e) =>
          `${e.pkg.name} exports "${e.subpath}" -> "${e.target}", but ${e.relPath} does not exist` +
          (e.pkg.hasBuildScript ? '' : ' (and the package has no `build` script that could create it)'),
      );

    expect(
      violations,
      [
        'An `exports` subpath names a path that is neither on disk nor recognisable as build output.',
        'Same derived exemption as the `files` guard above: git-ignored + untracked + the package',
        'has a `build` script (objectui#4059).',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('a stylesheet export is backed by something that can actually build a stylesheet', () => {
    // THE objectui#4059 ASSERTION. Everything above would have passed on the
    // broken `@object-ui/fields`: `dist` is in `files`, `dist/index.css` is
    // git-ignored and untracked, and the package has a `build` script. What was
    // missing was any way to produce a stylesheet, and that is decidable here.
    const violations = generatedCssExports
      .filter((e) => !hasCssProducer(e.pkg))
      .filter((e) => !Object.hasOwn(KNOWN_UNSHIPPABLE_EXPORTS, exportKey(e)))
      .map(
        (e) =>
          `${e.pkg.name} exports "${e.subpath}" -> "${e.target}", but the package has no CSS source ` +
          `under src/ and its build script does not run a CSS step (build: ${JSON.stringify(e.pkg.buildScript)})`,
      );

    expect(
      violations,
      [
        'A package exports a stylesheet it cannot build.',
        '',
        'This is the objectui#4059 defect verbatim: @object-ui/fields declared',
        '"./style.css": "./dist/index.css" with `build: "tsc && vite build"` and not one .css file',
        'in the package. Every tarball through 17.3.0 shipped without it, and a consumer\'s',
        '`@import "@object-ui/fields/style.css"` failed to resolve and broke their build.',
        '',
        'A bundler emits a stylesheet only when one is in the entry graph, so unlike dist/index.js',
        'this cannot be assumed. Fix it in whichever direction is true:',
        '  - the package should ship CSS -> give it a CSS entry and a build step',
        '                                   (packages/fields/scripts/build-css.mjs is the model)',
        '  - it should not              -> delete the subpath from `exports`',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('the objectui#4059 baseline only shrinks', () => {
    // The other half of the ratchet, in the shape objectui#3701 established:
    // report WHY an entry stopped being a live defect rather than assuming, so a
    // stale line is never read as proof that the file now builds.
    const live = new Set(
      [
        ...declaredExports.filter((e) => !isPackable(e)),
        ...generatedExports.filter((e) => !isExportBuildOutput(e)),
        ...generatedCssExports.filter((e) => !hasCssProducer(e.pkg)),
      ].map(exportKey),
    );
    const stale = Object.keys(KNOWN_UNSHIPPABLE_EXPORTS).filter((key) => !live.has(key));

    const causeOf = (key: string): string => {
      const entry = declaredExports.find((e) => exportKey(e) === key);
      if (!entry) return 'no export declares it any more: the subpath was deleted, or its package left the workspace';
      if (entry.onDisk) return 'the target now exists on disk';
      if (entry.target.endsWith('.css') && hasCssProducer(entry.pkg))
        return 'its package can now build a stylesheet (CSS source under src/, or a CSS build step)';
      return 'still declared and still absent, but now excused as build output';
    };

    expect(
      stale,
      [
        'A KNOWN_UNSHIPPABLE_EXPORTS entry no longer describes a live defect.',
        'Delete its line to bank the progress — that is the right move under every cause below.',
        '',
        ...stale.map((key) => `${key} (${KNOWN_UNSHIPPABLE_EXPORTS[key].issue}) — ${causeOf(key)}`),
      ].join('\n'),
    ).toEqual([]);
  });

  it('pins the CSS build added in objectui#4059', () => {
    // The general assertion above covers this, but naming it means a revert
    // points straight at the issue that explains why the build step has to be
    // there — and, unlike the general assertion, this cannot be satisfied by
    // adding a baseline line.
    const script = path.join(repoRoot, 'packages/fields/scripts/build-css.mjs');
    expect(
      fs.existsSync(script),
      'packages/fields/scripts/build-css.mjs is what makes @object-ui/fields\' "./style.css" export ' +
        'true. Without it the package publishes a subpath that resolves to nothing, which is what ' +
        'every release through 17.3.0 did (objectui#4059).',
    ).toBe(true);

    const fields = packages.find((p) => p.name === '@object-ui/fields');
    expect(fields?.buildScript, '@object-ui/fields must still RUN its CSS build, not merely contain it').toMatch(
      /build-css/,
    );
  });

  it('the producer predicate answers each of its cases', () => {
    // The predicate's limbs, asserted directly against live specimens. Two of
    // them have exactly one specimen each in the tree, so without this they
    // would be logic a later edit could invert with nothing turning red.
    const byName = (name: string) => packages.find((p) => p.name === name)!;

    // Limb 1: an explicit CSS build step.
    expect(hasCssProducer(byName('@object-ui/components')), 'components runs scripts/build-css.mjs').toBe(true);
    expect(hasCssProducer(byName('@object-ui/fields')), 'fields runs scripts/build-css.mjs (objectui#4059)').toBe(true);

    // Limb 2: a CSS source in the package, with no build-css step.
    const appShell = byName('@object-ui/app-shell');
    expect(appShell.buildScript ?? '').not.toMatch(/build-css/);
    expect(hasCssProducer(appShell), 'app-shell has src/styles.css').toBe(true);

    // Neither limb: the shape the guard has to reject. @object-ui/types is a
    // pure-TypeScript package — it has a build, and no CSS anywhere.
    expect(hasCssProducer(byName('@object-ui/types')), 'types has no CSS at all').toBe(false);
  });
});
