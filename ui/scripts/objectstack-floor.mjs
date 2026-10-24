#!/usr/bin/env node
/**
 * objectstack-floor -- at publish, every `@objectstack/*` floor objectui ships is
 * computed from `.objectstack-sha` (ruling B on objectui#12955, executed by objectui#12958).
 *
 *   node scripts/objectstack-floor.mjs            # first step of `pnpm changeset:publish`
 *   node scripts/objectstack-floor.mjs --dry-run  # compute and report, write nothing
 *
 * THE FLOOR is the earliest `@objectstack/spec` version npm carries whose objectstack
 * release tag `@objectstack/spec@<version>` contains the pin (`git merge-base
 * --is-ancestor`); a tag npm does not carry is not a release. Prereleases count -- an
 * unshipped major exists on npm only as `X.0.0-next.N` -- ordered by semver precedence.
 * objectstack versions its packages as one fixed group, so that version floors every
 * `@objectstack/*` range, and npm is asked for each moved name at that version.
 * Tags and history: a treeless fetch (commits only, full depth, so a non-ancestor
 * answer is real) of objectstack's public repository into a temporary directory -- no
 * secret, the access `scripts/objectstack-pin.mjs` already uses (`OBJECTSTACK_REPO_URL`).
 *
 * THE RANGES, in every dependency field of every published manifest: one below the
 * floor becomes `^<floor>`, with a `### Dependency floors` entry under the package's
 * `## <version>` CHANGELOG.md section -- the tarball's CHANGELOG and the GitHub Release
 * body (`scripts/release-github-releases.mjs`) carry it. One at or above the floor stays
 * as written: it already admits no release older than the pin. The writes are the
 * runner's; the tagged commit keeps `main`'s ranges. `check-spec-range-floors.mjs` runs
 * after this step, because a release that contains the pin can still have removed a
 * symbol the artifact uses.
 *
 * EXIT 0 computed (and written, unless --dry-run) · 1 refused (an unreadable range, a
 * fetch or npm failure, a moved name npm lacks at the floor) · 2 no published release
 * contains the pin, so publishing waits for objectstack's next release. Nothing is
 * written unless the answer is 0.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ALL_FIELDS } from './check-phantom-dependencies.mjs';
import { discoverPublishedPackages } from './check-published-dist-tooling.mjs';
import { isEntrypoint } from './invoked-as.mjs';
import { DEFAULT_REPO_URL, REPO_ROOT, readPin } from './objectstack-pin.mjs';

export const SPEC = '@objectstack/spec';
export const TAG_PREFIX = `${SPEC}@`;
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;
const RANGE = /^(?:\^|~|>=|=)?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;
// pnpm's workspace protocol (objectstack ruling D1: inside the objectstack monorepo the
// `@objectstack/*` ranges are `workspace:^`). `workspace:*` / `^` / `~` / bare publish as
// `^<the workspace package's own version>`, so that version is the range's floor; a range
// tail (`workspace:^1.2.3`) is read as the range.
const WORKSPACE = /^workspace:(.*)$/;
const WORKSPACE_OWN_VERSION = new Set(['', '*', '^', '~']);

/**
 * The version of `name` the workspace resolves: the nearest `node_modules/<name>/package.json`
 * walking up from `root` -- the pinned build standalone, the workspace link in the monorepo.
 * `null` when nothing is installed, which a `workspace:` range then reports as unreadable.
 */
export function installedVersion(root, name) {
  let dir = root;
  for (;;) {
    const manifest = path.join(dir, 'node_modules', name, 'package.json');
    if (fs.existsSync(manifest)) {
      try {
        const version = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
        return typeof version === 'string' ? version : null;
      } catch {
        return null;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The lowest version `from` admits, or `null` when this step cannot read it. */
export function floorOfRange(from, name, workspaceVersionOf) {
  const text = String(from).trim();
  const workspace = WORKSPACE.exec(text);
  if (!workspace) return RANGE.exec(text)?.[1] ?? null;
  const tail = workspace[1].trim();
  if (!WORKSPACE_OWN_VERSION.has(tail)) return RANGE.exec(tail)?.[1] ?? null;
  const own = workspaceVersionOf(name);
  return typeof own === 'string' && VERSION.test(own) ? own : null;
}

/** Semver precedence of two `X.Y.Z[-prerelease]` versions: negative, 0 or positive. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((v) => {
    const m = VERSION.exec(v);
    if (!m) throw new Error(`"${v}" is not an X.Y.Z[-prerelease] version`);
    return { core: m.slice(1, 4).map(Number), pre: m[4] ? m[4].split('.') : [] };
  });
  for (let i = 0; i < 3; i += 1) if (x.core[i] !== y.core[i]) return x.core[i] - y.core[i];
  if (!x.pre.length || !y.pre.length) return y.pre.length - x.pre.length; // a release outranks its prereleases
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i += 1) {
    const [p, q] = [x.pre[i], y.pre[i]];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    if (p === q) continue;
    const [np, nq] = [/^\d+$/.test(p), /^\d+$/.test(q)];
    if (np && nq) return Number(p) - Number(q);
    return np !== nq ? (np ? -1 : 1) : p < q ? -1 : 1;
  }
  return 0;
}

/** The earliest published version whose release tag contains the pin, and the newest published one. */
export function computeFloor({ published, tagged, contains }) {
  const releases = published.filter((v) => VERSION.test(v)).sort(compareVersions);
  return { floor: releases.find((v) => tagged.has(v) && contains(v)) ?? null, newest: releases.at(-1) ?? null };
}

/** Fetch every spec release tag with its history (commits only) and answer containment of the pin. */
export function releaseTags(dir, url, pin) {
  const git = (args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  fs.mkdirSync(dir, { recursive: true });
  // The commit-graph is what makes one `--is-ancestor` per tag cheap: without it each
  // call walks the whole history (measured on objectui#12958: 89 s against 0.5 s).
  const fetch = ['fetch', '-q', '--filter=tree:0', '--no-tags', url, `+refs/tags/${TAG_PREFIX}*:refs/tags/${TAG_PREFIX}*`];
  const steps = [['init', '-q', '--bare'], fetch, ['commit-graph', 'write', '--reachable']];
  for (const args of steps) {
    const r = git(args);
    if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || String(r.error)).trim()}`);
  }
  const refs = git(['for-each-ref', '--format=%(refname:lstrip=2)', `refs/tags/${TAG_PREFIX}*`]).stdout;
  const tagged = new Set(refs.split('\n').filter(Boolean).map((t) => t.slice(TAG_PREFIX.length)));
  const present = git(['cat-file', '-e', `${pin}^{commit}`]).status === 0;
  const contains = (version) => {
    if (!present) return false;
    const r = git(['merge-base', '--is-ancestor', pin, `refs/tags/${TAG_PREFIX}${version}`]);
    if (r.status !== 0 && r.status !== 1) throw new Error(`git merge-base --is-ancestor ${pin} ${TAG_PREFIX}${version}: ${r.stderr.trim()}`);
    return r.status === 0;
  };
  return { tagged, contains };
}

/**
 * Every `@objectstack/*` range of every published manifest, judged against the floor.
 *
 * @param {{ name: string, dir: string, manifest: object }[]} packages
 * @param {string} floor
 * @param {{ workspaceVersionOf?: (name: string) => string | null }} [options]
 *   what a `workspace:` range of `name` reads as its floor (default: nothing is a workspace)
 */
export function planRanges(packages, floor, { workspaceVersionOf = () => null } = {}) {
  const rows = [];
  for (const pkg of packages) {
    for (const field of ALL_FIELDS) {
      for (const [name, from] of Object.entries(pkg.manifest[field] ?? {})) {
        if (!name.startsWith('@objectstack/')) continue;
        const min = floorOfRange(from, name, workspaceVersionOf);
        const action = !min ? 'unreadable' : compareVersions(min, floor) < 0 ? 'moved' : 'kept';
        rows.push({ pkg, field, name, from, to: action === 'moved' ? `^${floor}` : from, action });
      }
    }
  }
  return rows;
}

/** CHANGELOG.md with a `### Dependency floors` entry under `## <version>` (added when absent). */
export function withFloorEntry(text, version, moved, floor, pin) {
  const entry =
    `### Dependency floors\n\nComputed from \`.objectstack-sha\` \`${pin.slice(0, 12)}\`: the earliest published ` +
    `\`${SPEC}\` that contains it is \`${floor}\`.\n\n` +
    moved.map((r) => `- \`${r.name}\` (\`${r.field}\`): \`${r.from}\` → \`${r.to}\`\n`).join('');
  const heading = `\n## ${version}\n`;
  const at = text.indexOf(heading);
  if (at === -1) {
    const cut = text.indexOf('\n') + 1;
    return `${text.slice(0, cut)}\n## ${version}\n\n${entry}${text.slice(cut)}`;
  }
  let cut = at + heading.length;
  if (text[cut] === '\n') cut += 1;
  return `${text.slice(0, cut)}${entry}\n${text.slice(cut)}`;
}

function npmJson(args) {
  const r = spawnSync('npm', [...args, '--json'], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`npm ${args.join(' ')} failed: ${(r.stderr || r.stdout || String(r.error)).trim().slice(0, 400)}`);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}

export function main({ root = REPO_ROOT, argv = process.argv.slice(2), env = process.env, npm = npmJson } = {}) {
  const dryRun = argv.includes('--dry-run');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'objectstack-floor-'));
  try {
    const pin = readPin(root);
    const published = [].concat(npm(['view', SPEC, 'versions']) ?? []);
    const tags = releaseTags(path.join(scratch, 'objectstack.git'), env.OBJECTSTACK_REPO_URL || DEFAULT_REPO_URL, pin);
    const { floor, newest } = computeFloor({ published, ...tags });
    if (!floor) {
      console.error(
        `✗ No published ${SPEC} release contains the pin ${pin} (.objectstack-sha); the newest published ` +
          `release is ${newest}. Nothing is published until objectstack releases a commit that contains the pin.`,
      );
      return 2;
    }
    console.log(`Floor ${floor}: the earliest published ${SPEC} whose tag ${TAG_PREFIX}${floor} contains the pin ${pin}.`);
    const rows = planRanges(discoverPublishedPackages(root), floor, { workspaceVersionOf: (name) => installedVersion(root, name) });
    for (const r of rows) console.log(`  ${r.action.padEnd(10)} ${r.pkg.name}  ${r.field}  ${r.name}  ${r.from}${r.action === 'moved' ? ` → ${r.to}` : ''}`);
    const unreadable = rows.filter((r) => r.action === 'unreadable');
    if (unreadable.length) throw new Error(`${unreadable.length} range(s) above name no minimum this step can read; nothing was written.`);
    const moved = rows.filter((r) => r.action === 'moved');
    for (const name of new Set(moved.map((r) => r.name))) {
      if (npm(['view', `${name}@${floor}`, 'version']) !== floor) throw new Error(`npm does not carry ${name}@${floor}; nothing was written.`);
    }
    if (!dryRun) {
      for (const pkg of new Set(moved.map((r) => r.pkg))) {
        const mine = moved.filter((r) => r.pkg === pkg);
        for (const r of mine) pkg.manifest[r.field][r.name] = r.to;
        fs.writeFileSync(path.join(root, pkg.dir, 'package.json'), `${JSON.stringify(pkg.manifest, null, 2)}\n`);
        const changelog = path.join(root, pkg.dir, 'CHANGELOG.md');
        if (fs.existsSync(changelog)) fs.writeFileSync(changelog, withFloorEntry(fs.readFileSync(changelog, 'utf8'), pkg.manifest.version, mine, floor, pin));
      }
    }
    console.log(`${moved.length} range(s) moved to ^${floor}, ${rows.length - moved.length} left at or above it${dryRun ? ' (--dry-run: nothing written)' : ''}.`);
    return 0;
  } catch (error) {
    console.error(`✗ objectstack-floor: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (isEntrypoint(import.meta.url)) process.exitCode = main();
