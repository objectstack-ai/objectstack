// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ⭐ The mechanical half of ADR-0132's entitlement boundary.
//
// This package and the commercial multi-org runtime share one package name,
// `@objectstack/organizations`, and that is the design: the commercial one is a
// private workspace package whose class `extends` this one and calls its licence
// gate in its own constructor. Which class a deployment mounts is decided by the
// manifest that DECLARES the name — `workspace:*` in every commercial host
// (pnpm's `workspace:` protocol resolves only to the local package and cannot
// fall through to the registry), the npm copy for an open install, and in both
// cases through `objectstack serve`'s host-anchored importer, which refuses a
// package the served app has not declared (#4719).
//
// ## What can break that, and what this file refuses
//
// Exactly one thing: a FRAMEWORK package taking `@objectstack/organizations` as
// its own dependency. The commercial repo consumes the framework by `link:`, so
// such a dependency would install THIS package — the ungated one — inside the
// framework tree a commercial app links against, reachable from framework code
// by a bare `import()` that never consults the app's manifest. The entitlement
// would then be bypassed not by a defect in the gate but by resolution picking
// the other class with the same name, which is the worst outcome this whole
// move has available and the one least likely to be noticed in review.
//
// ⛔ So: no workspace package may declare `@objectstack/organizations`, in any
// of the four dependency fields, ever. Apps declare it; packages do not. Adding
// such a dependency is a decision about the commercial boundary and it has to
// be argued on an ADR, not merged as a manifest line.
//
// The prohibition is asymmetric on purpose and this file does NOT say the
// converse: this package may depend on framework packages freely (it depends on
// four), because that direction puts nothing ungated anywhere new.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The repo root — the directory carrying `pnpm-workspace.yaml`. */
function findUp(predicate: (dir: string) => boolean): string {
  let dir = HERE;
  for (;;) {
    if (predicate(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('reached the filesystem root without a match');
    dir = parent;
  }
}

const REPO = findUp((dir) => existsSync(join(dir, 'pnpm-workspace.yaml')));

const SELF = '@objectstack/organizations';

/** The fields whose KEYS count as a declaration — `HOST_DECLARATION_FIELDS`. */
const DEP_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

/**
 * The workspace globs that hold PACKAGES, i.e. the publishable/library tier.
 *
 * `apps/*` and `examples/*` are deliberately excluded: those ARE hosts, and a
 * host declaring the runtime it wants to mount is the supported wiring — the
 * very act `serve`'s host-anchored importer is built around. Narrowing the
 * population to `packages/**` is what keeps this pin about the hazard rather
 * than about all uses of the name.
 */
const PACKAGE_ROOTS = [
  'packages',
  'packages/apps',
  'packages/drivers',
  'packages/plugins',
  'packages/qa',
  'packages/triggers',
  'packages/services',
  'packages/adapters',
  'packages/connectors',
];

function workspacePackageManifests(): { dir: string; name: string; manifest: Record<string, unknown> }[] {
  const out: { dir: string; name: string; manifest: Record<string, unknown> }[] = [];
  for (const root of PACKAGE_ROOTS) {
    const abs = join(REPO, root);
    if (!existsSync(abs)) continue;
    for (const entry of readdirSync(abs)) {
      const dir = join(abs, entry);
      if (!statSync(dir).isDirectory()) continue;
      const manifestPath = join(dir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
      out.push({ dir: relative(REPO, dir), name: String(manifest.name ?? entry), manifest });
    }
  }
  return out;
}

describe('ADR-0132 boundary: no framework package depends on @objectstack/organizations', () => {
  // ── The anti-vacuity control, first. A walk that found nothing would pass
  // the pin below while proving nothing at all, and "the glob stopped
  // matching" is the silent way this file dies. So assert the population is
  // real and that it contains this package itself.
  it('walks a real population that includes this package', () => {
    const manifests = workspacePackageManifests();
    expect(manifests.length).toBeGreaterThan(40);
    expect(manifests.map((m) => m.name)).toContain(SELF);
  });

  it('no workspace package declares it in any dependency field', () => {
    const offenders: string[] = [];
    for (const { dir, name, manifest } of workspacePackageManifests()) {
      if (name === SELF) continue; // itself — nothing to declare
      for (const field of DEP_FIELDS) {
        const deps = manifest[field] as Record<string, string> | undefined;
        if (deps && Object.prototype.hasOwnProperty.call(deps, SELF)) {
          offenders.push(`${dir} (${name}) → ${field}["${SELF}"] = ${deps[SELF]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // The control for the check above: the detector must actually find a
  // declaration when one is present. Without this, an offenders list that is
  // empty because the field lookup is broken reads exactly like compliance.
  it('the detector finds a declaration when one exists', () => {
    const planted = { dependencies: { [SELF]: 'workspace:*' } } as Record<string, unknown>;
    const found = DEP_FIELDS.filter((field) => {
      const deps = planted[field] as Record<string, string> | undefined;
      return !!deps && Object.prototype.hasOwnProperty.call(deps, SELF);
    });
    expect(found).toEqual(['dependencies']);
  });

  it('this package declares no licence-gate dependency of its own', () => {
    const self = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8')) as Record<
      string,
      Record<string, string> | undefined
    >;
    const all = DEP_FIELDS.flatMap((f) => Object.keys(self[f] ?? {}));
    // The two commercial packages the closed runtime coupled to, named
    // explicitly rather than by a substring guess: `security-enterprise` was
    // the licence gate's import and the multi-node gate carrier, and the
    // package must never re-acquire either.
    expect(all).not.toContain('@objectstack/security-enterprise');
    expect(all.filter((d) => d.includes('license') || d.includes('entitle'))).toEqual([]);
  });
});
