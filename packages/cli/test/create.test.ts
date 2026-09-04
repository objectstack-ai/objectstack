// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os create`'s emitted contract — the pin for #14824.
 *
 * ## The defect this file used to certify
 *
 * Until #14824 the only assertion here was
 * `expect(packageJson.dependencies['@objectstack/cli']).toBe('workspace:*')` —
 * a test that PASSED on the defect, and would have gone red on the fix. Every
 * project `os create` emitted declared its `@objectstack/*` dependencies with
 * pnpm's workspace protocol and extended a `tsconfig.json` two directories up,
 * so it resolved nothing outside this monorepo; the four public doc pages that
 * present `os create` as a user-facing command were therefore teaching a
 * command whose output cannot install. The maintainer ruled that a documented
 * developer-facing command must work for the developer who follows the docs,
 * so the default emission is now standalone and this file pins that shape.
 *
 * ## What is asserted here, and what is asserted elsewhere
 *
 * These are the STATIC properties of the emission — the ones a unit test can
 * decide from the rendered files alone. That an emitted project actually
 * installs and builds from a registry-shaped source is not one of them, and it
 * is not asserted here: `scripts/create-scaffold-smoke.sh` scaffolds every
 * template into a temp directory OUTSIDE this repository, installs it from
 * packed tarballs and runs its `build` and `typecheck`. A unit test that
 * claimed the stronger property would be the same shape of comfort the
 * `workspace:*` assertion above was.
 *
 * The sweep is DERIVED from the template map, never a list of `plugin` and
 * `example`: a third template must arrive already covered.
 */

import { describe, it, expect } from 'vitest';
import {
  templates,
  objectstackDependencySpec,
  rootTsconfigExtends,
  DEFAULT_PLACEMENT,
  type ScaffoldPlacement,
} from '../src/commands/create.js';
import { getCliVersion, SCAFFOLD_PNPM_RANGE } from '../src/commands/init.js';

const TEMPLATE_KEYS = Object.keys(templates);
const PROJECT = 'my-thing';

/** Render one template's whole emission for a placement, path → content. */
function render(key: string, placement: ScaffoldPlacement): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [filePath, fn] of Object.entries(templates[key].filesFor(placement))) {
    out[filePath] = fn(PROJECT);
  }
  return out;
}

/** The bytes that land on disk, which is where `workspace:` has to be absent. */
function serialize(content: unknown): string {
  return typeof content === 'string' ? content : JSON.stringify(content, null, 2);
}

function pkgJson(key: string, placement: ScaffoldPlacement): Record<string, any> {
  return render(key, placement)['package.json'] as Record<string, any>;
}

function tsconfig(key: string, placement: ScaffoldPlacement): Record<string, any> {
  return render(key, placement)['tsconfig.json'] as Record<string, any>;
}

/** Every `@objectstack/*` entry the template declares, both dep sections. */
function objectstackDeps(pkg: Record<string, any>): Record<string, string> {
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  return Object.fromEntries(
    Object.entries(all).filter(([name]) => name.startsWith('@objectstack/')),
  ) as Record<string, string>;
}

describe('os create: the sweep covers every shipped template', () => {
  it('derives its population from the template map', () => {
    expect(TEMPLATE_KEYS.length).toBeGreaterThan(0);
    // The two reported in #14824, named so a rename is loud rather than silent.
    expect(TEMPLATE_KEYS).toEqual(expect.arrayContaining(['plugin', 'example']));
  });

  it('defaults to the standalone placement', () => {
    expect(DEFAULT_PLACEMENT).toBe('standalone');
  });

  it('`files` is the default placement, so a caller that ignores placements gets it', () => {
    for (const key of TEMPLATE_KEYS) {
      expect(Object.keys(templates[key].files).sort()).toEqual(
        Object.keys(templates[key].filesFor(DEFAULT_PLACEMENT)).sort(),
      );
    }
  });
});

describe.each(TEMPLATE_KEYS)('os create %s — the standalone (default) emission', (key) => {
  it('declares every @objectstack dependency as a published range pinned to this CLI', () => {
    const deps = objectstackDeps(pkgJson(key, 'standalone'));
    expect(Object.keys(deps).length).toBeGreaterThan(0);
    for (const [name, spec] of Object.entries(deps)) {
      expect(spec, `${key}: ${name}`).toBe(`^${getCliVersion()}`);
      // A published range, spelled the way npm/pnpm/yarn/bun all resolve it.
      expect(spec, `${key}: ${name}`).toMatch(/^\^\d+\.\d+\.\d+/);
    }
  });

  it('emits no `workspace:` dependency protocol in ANY file it writes', () => {
    // A dependency SPEC, not the word: `pnpm-workspace.yaml` explains itself in
    // prose that says "workspace" repeatedly, and a substring rule would red on
    // the file whose presence is part of the fix. A spec is always quoted —
    // `"@objectstack/spec": "workspace:*"` in JSON, `'workspace:*'` in a
    // TypeScript template — so the quote is what separates the two.
    for (const [filePath, content] of Object.entries(render(key, 'standalone'))) {
      expect(serialize(content), `${key}: ${filePath}`).not.toMatch(/["']workspace:/);
    }
  });

  it('emits a self-contained tsconfig.json — nothing to extend outside the project', () => {
    const cfg = tsconfig(key, 'standalone');
    expect(cfg.extends, `${key}: tsconfig.json still extends something`).toBeUndefined();
    // Self-contained means the options are actually THERE, not merely unextended.
    expect(cfg.compilerOptions.target).toBeDefined();
    expect(cfg.compilerOptions.module).toBeDefined();
    expect(cfg.compilerOptions.strict).toBe(true);
    // The `exports` subpaths the templates import (`@objectstack/spec/kernel`,
    // `/contracts`) resolve only under a subpath-aware resolution mode.
    expect(['bundler', 'node16', 'nodenext', 'NodeNext', 'Node16']).toContain(
      cfg.compilerOptions.moduleResolution,
    );
  });

  it('carries the pnpm build approvals a fresh install needs', () => {
    const files = render(key, 'standalone');
    const yaml = files['pnpm-workspace.yaml'];
    expect(yaml, `${key}: no pnpm-workspace.yaml`).toBeDefined();
    // Without an approval key a fresh `pnpm install` exits 1 on pnpm 11
    // (ERR_PNPM_IGNORED_BUILDS) — the scaffold would not install at all.
    expect(String(yaml)).toMatch(/^\s*(allowBuilds|onlyBuiltDependencies)\s*:/m);
    expect((pkgJson(key, 'standalone') as any).engines?.pnpm).toBe(SCAFFOLD_PNPM_RANGE);
  });

  it('names a build script, the second command its own output tells the user to run', () => {
    expect(pkgJson(key, 'standalone').scripts?.build).toBeTruthy();
    expect(pkgJson(key, 'standalone').scripts?.typecheck).toBeTruthy();
  });

  it('emits no monorepo-relative path into the project it hands the developer', () => {
    for (const [filePath, content] of Object.entries(render(key, 'standalone'))) {
      // `../../content/docs` and friends: links that resolve only from inside
      // this checkout. Relative paths that stay INSIDE the project (`./src`)
      // are fine, so only the ascending form is refused.
      expect(serialize(content), `${key}: ${filePath}`).not.toMatch(/\.\.\/\.\.\//);
    }
  });
});

describe.each(TEMPLATE_KEYS)('os create %s --in-repo — the platform-work emission', (key) => {
  it('keeps the workspace protocol, which is what that placement is for', () => {
    const deps = objectstackDeps(pkgJson(key, 'in-repo'));
    expect(Object.keys(deps).length).toBeGreaterThan(0);
    for (const [name, spec] of Object.entries(deps)) {
      expect(spec, `${key}: ${name}`).toBe('workspace:*');
    }
    expect(objectstackDependencySpec('in-repo')).toBe('workspace:*');
  });

  it('extends a tsconfig that resolves to the monorepo ROOT from where it lands', () => {
    const t = templates[key];
    const cfg = tsconfig(key, 'in-repo');
    expect(cfg.extends, `${key}: --in-repo tsconfig extends nothing`).toBeTruthy();
    // The defect this replaces: `packages/plugins/plugin-x/../../tsconfig.json`
    // is `packages/tsconfig.json`, which does not exist — the `plugin`
    // template's `extends` did not resolve even inside this monorepo. Resolved
    // arithmetic, not a transcription: a template that moves takes its own
    // `extends` with it.
    const landedIn = `${t.inRepoDir}/${t.dirName(PROJECT)}`;
    expect(normalizeJoin(landedIn, cfg.extends)).toBe('tsconfig.json');
  });

  it('emits no pnpm-workspace.yaml, which would sever the workspace it joins', () => {
    expect(Object.keys(templates[key].filesFor('in-repo'))).not.toContain('pnpm-workspace.yaml');
  });
});

describe('rootTsconfigExtends derives the ascent from where a template lands', () => {
  it('counts the project directory itself', () => {
    expect(rootTsconfigExtends('packages/plugins', 'plugin-x')).toBe('../../../tsconfig.json');
    expect(rootTsconfigExtends('examples', 'my-app')).toBe('../../tsconfig.json');
  });
});

/** posix `a/b` + `../../x` → `x`, with no filesystem access. */
function normalizeJoin(dir: string, rel: string): string {
  const parts = `${dir}/${rel}`.split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') out.pop();
    else out.push(p);
  }
  return out.join('/');
}
