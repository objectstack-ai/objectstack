import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#3207: `turbo run type-check --filter=@object-ui/plugin-detail` failed
 * on a clean worktree with six `TS2307: Cannot find module '@object-ui/permissions'`
 * errors, plus the `TS7006 implicitly has an 'any' type` cascade that follows a
 * failed import. `@object-ui/plugin-list` had the identical break.
 *
 * The cause is a build-graph hole, not a missing install. Both packages listed
 * `@object-ui/permissions` in `peerDependencies` only. pnpm still symlinks such a
 * peer into `node_modules` (the lockfile recorded it under the importer's
 * `dependencies`), so the package *path* resolved fine — but turbo reads
 * `package.json`, not the lockfile, and the `type-check` task's `dependsOn:
 * ["^build"]` walks `dependencies`/`devDependencies` only. `permissions/dist`
 * therefore never got built, and `tsc` found a directory with no type
 * declarations in it.
 *
 * Why that is worth a guard rather than just a one-line fix: the full-repo
 * `pnpm type-check` was GREEN the whole time, because some other package's build
 * dragged `@object-ui/permissions` up as a side effect. CI could not see this.
 * The only command that could was a scoped, per-package typecheck — precisely the
 * command someone should run after touching one package — and it answered with a
 * screenful of red that had nothing to do with their change. That is the worst
 * possible failure mode: it trains people to ignore the output of the one check
 * that would have caught their real mistake.
 *
 * So the invariant is enforced structurally instead of being restored by hand:
 * a peer that lives in this workspace must also carry a `dependencies` or
 * `devDependencies` edge, so turbo's `^` traversal can actually reach it. At the
 * time of writing every one of the workspace's packages satisfies this, which is
 * why there is no exemption list here and should not become one — an exemption
 * would be indistinguishable from the bug this pins down.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

interface WorkspacePackage {
  name: string;
  dir: string;
  json: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}

/**
 * The `packages:` globs from `pnpm-workspace.yaml`, read rather than hardcoded so
 * a new workspace root is covered the day it is added.
 *
 * The parser deliberately understands only the two shapes the file actually uses
 * (`dir/*` and a bare `dir`). Anything else throws instead of being skipped: a
 * guard that silently stops looking at part of the workspace is worse than no
 * guard, because it keeps reporting success over a shrinking surface.
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
    if (!match) throw new Error(`Unparsed entry in pnpm-workspace.yaml \`packages:\`: ${JSON.stringify(line)} — teach this guard the new syntax.`);
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
        ? fs.readdirSync(parent).map((d) => path.join(parent, d)).filter((d) => fs.statSync(d).isDirectory())
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
      found.push({ name: json.name, dir: path.relative(repoRoot, dir), json });
    }
  }
  return found;
}

const packages = readWorkspacePackages();
const workspaceNames = new Set(packages.map((p) => p.name));

describe('workspace peer dependencies are reachable by turbo `^build`', () => {
  it('discovers the workspace (guard cannot pass by finding nothing)', () => {
    // Without this, a broken parser or a moved directory would turn every
    // assertion below into a vacuous pass over an empty list.
    expect(packages.length).toBeGreaterThan(30);
    expect(workspaceNames.has('@object-ui/plugin-detail')).toBe(true);
    expect(workspaceNames.has('@object-ui/permissions')).toBe(true);
  });

  it('every workspace package that is a peer is also a dependency or devDependency', () => {
    const violations: string[] = [];

    for (const pkg of packages) {
      const peers = Object.keys(pkg.json.peerDependencies ?? {});
      const edges = new Set([
        ...Object.keys(pkg.json.dependencies ?? {}),
        ...Object.keys(pkg.json.devDependencies ?? {}),
      ]);

      for (const peer of peers) {
        // Only workspace packages matter: turbo builds those, and only those
        // need an edge for `^build` to reach them. An external peer such as
        // `react` or `@objectstack/spec` comes from the registry already built.
        if (!workspaceNames.has(peer)) continue;
        if (edges.has(peer)) continue;
        violations.push(`${pkg.name} (${pkg.dir}/package.json) declares "${peer}" in peerDependencies but has no dependencies/devDependencies edge for it`);
      }
    }

    expect(
      violations,
      [
        'A workspace peer without a dependencies/devDependencies edge is invisible to turbo.',
        "The `type-check` task's `dependsOn: [\"^build\"]` walks dependencies/devDependencies only,",
        'so that peer never gets built and a scoped `turbo run type-check --filter=<pkg>` fails with',
        "TS2307 \"Cannot find module\" errors that have nothing to do with the change being tested.",
        '',
        'Fix: add the peer to devDependencies as "workspace:*" (see objectui#3207), then `pnpm install`.',
        '',
        ...violations,
      ].join('\n'),
    ).toEqual([]);
  });

  it('pins the two packages fixed in objectui#3207', () => {
    // The general assertion above would catch a regression here too, but these
    // two are named so a revert points straight at the issue that explains why.
    for (const name of ['@object-ui/plugin-detail', '@object-ui/plugin-list']) {
      const pkg = packages.find((p) => p.name === name);
      expect(pkg, `${name} must exist in the workspace`).toBeDefined();
      expect(
        pkg!.json.devDependencies?.['@object-ui/permissions'],
        `${name} imports @object-ui/permissions in its sources, so it needs the devDependencies edge that lets turbo build it`,
      ).toBe('workspace:*');
    }
  });
});
