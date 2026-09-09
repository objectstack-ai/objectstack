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
 * The sweep is DERIVED from the template map, never a written-down roster: a
 * template added later must arrive already covered.
 *
 * ## `example` is not in that map any more
 *
 * `os create example` was retired in #16483 under the #15531 ruling — it
 * emitted a subset of what `os init` writes plus one README. Its absence from
 * the map is asserted below beside its presence in `RETIRED_TEMPLATES`, so
 * deleting a template WITHOUT leaving the signpost behind reddens here. What
 * the surviving refusal actually prints, driven through the real CLI, is pinned
 * in `create-example-retired.e2e.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  RETIRED_TEMPLATES,
  templates,
  emittedPackageName,
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
    // Named so a rename is loud rather than silent. `plugin` is the survivor of
    // the two #14824 reported; `example` was retired in #16483.
    expect(TEMPLATE_KEYS).toEqual(expect.arrayContaining(['plugin']));
  });

  it('has retired `example`, and left a signpost where the template was', () => {
    // Both halves, because the ruling is not satisfied by either alone: the
    // template is gone from the roster AND the command still answers for the
    // word. A deletion that dropped the entry below would leave
    // `os create example` failing generically, which is what #16483 forbids.
    expect(TEMPLATE_KEYS).not.toContain('example');
    expect(Object.keys(RETIRED_TEMPLATES)).toContain('example');
    // The signpost names the replacement — the property, not the wording. The
    // message a user actually sees is driven and asserted in
    // `create-example-retired.e2e.test.ts`.
    expect(RETIRED_TEMPLATES.example.detail.join('\n')).toContain('os init');
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

/**
 * PIN (#15530) — the emitted package NAME follows the placement, and the
 * standalone half carries the flag that enforces it.
 *
 * ## The defect
 *
 * #14824 pointed the default emission at a developer outside this monorepo and
 * the name did not move with the audience: `os create plugin my-thing` kept
 * writing `"name": "@objectstack/plugin-my-thing"` — a scope its new owner
 * cannot publish to — and no `private` flag. ⚠️ Nothing here could see it. The
 * name is never resolved from a registry inside the emitted project, so the
 * unit pins above, the type-check and `scripts/create-scaffold-smoke.sh` are
 * all green on the defect; the cost lands at `npm publish`, in the terminal of
 * whoever ran the scaffolder. The ruling (#15530, decision batch #106 item 1)
 * is option A: unscoped `plugin-<name>` plus `"private": true` for standalone,
 * `@objectstack/plugin-<name>` unchanged for `--in-repo`.
 *
 * ## Why both arms are read in ONE test, and why `not.toBe` is here as well
 *
 * This is a DISCRIMINATION, not two independent facts, and the failure mode a
 * one-armed pin has is that it passes on a scaffolder that has stopped
 * discriminating — or stopped emitting. So each `it` renders both placements
 * in the same run and closes with the inequality: a mutation that makes the
 * two arms identical **in either direction** (scoping the standalone name
 * back, unscoping the in-repo one, marking both `private`, marking neither)
 * reddens here even if every equality above it were somehow satisfied.
 *
 * The expected strings are LITERALS, deliberately — ⛔ never `pluginPackageName`,
 * which is the function under test: reading it would move both sides of every
 * comparison together and pin nothing at all. The one derived expectation
 * (`dirName`) is derived from the OTHER surface the ruling names — "matching
 * the directory the scaffolder prints".
 */
describe('os create plugin: the emitted package name follows the placement (#15530)', () => {
  /** One rendered file, or a loud failure — ⛔ never `undefined` read as a pass. */
  function emit(file: string, placement: ScaffoldPlacement): unknown {
    const render = templates.plugin.filesFor(placement)[file];
    if (!render) throw new Error(`the plugin template emits no ${file} for ${placement}`);
    return render(PROJECT);
  }

  it('emits an unscoped, private standalone manifest and a scoped, publishable --in-repo one', () => {
    const standalone = emit('package.json', 'standalone') as Record<string, unknown>;
    const inRepo = emit('package.json', 'in-repo') as Record<string, unknown>;

    // Read the same way the COMMAND reads it before it writes anything, so a
    // manifest that stopped carrying a string `name` fails here rather than
    // being judged as absent-and-therefore-fine.
    expect(emittedPackageName(templates.plugin, 'standalone', PROJECT))
      .toBe(`plugin-${PROJECT}`);
    expect(emittedPackageName(templates.plugin, 'in-repo', PROJECT))
      .toBe(`@objectstack/plugin-${PROJECT}`);

    // (1) standalone — unscoped, and the same string as the directory the
    // scaffolder prints, which is the ruling's own wording for it.
    expect(standalone.name).toBe(`plugin-${PROJECT}`);
    expect(standalone.name).toBe(templates.plugin.dirName(PROJECT));
    expect(String(standalone.name).startsWith('@')).toBe(false);

    // ⭐ The load-bearing half. The name is readability; THIS is what makes an
    // accidental `npm publish` fail loudly whichever name won.
    expect(standalone.private).toBe(true);

    // (3) --in-repo — scoped and unchanged: it lands under packages/plugins/,
    // where every sibling really carries that scope and really is published.
    expect(inRepo.name).toBe(`@objectstack/plugin-${PROJECT}`);
    expect(inRepo.private).toBeUndefined();

    // NON-DEGENERACY: the two arms differ, in this run, in both fields.
    expect(standalone.name).not.toBe(inRepo.name);
    expect(standalone.private).not.toBe(inRepo.private);
  });

  it('carries the name into the README, install instruction included', () => {
    const standalone = String(emit('README.md', 'standalone'));
    const inRepo = String(emit('README.md', 'in-repo'));

    // The README is the SECOND copy of the name — title, install line, import
    // specifier. A rename that reaches only the manifest leaves this file
    // telling a developer to install a package that exists under no name.
    expect(standalone).not.toContain('@objectstack/plugin-');
    expect(standalone).toContain(`# plugin-${PROJECT}`);
    expect(standalone).toContain(`from 'plugin-${PROJECT}'`);

    // (2) A local reference, because that is what a reader standing in a
    // freshly scaffolded directory can actually run: the package is `private`
    // and unscoped, so nothing on a registry answers to that name. Asserted
    // from BOTH sides — the registry verb is gone, and the local one is
    // present and names this package — so neither a deleted section nor a
    // reinstated `pnpm add` can satisfy it.
    expect(standalone).not.toContain('pnpm add');
    expect(standalone).toContain(`pnpm link --global plugin-${PROJECT}`);

    // ⛔ And not spelled as a path. The scaffolder knows nothing about where
    // the reader's app is, so `link:../<dir>` would be a guess about a layout
    // it never created — refused, on that ground, by
    // `init-template-comments-self-contained.test.ts`.
    expect(standalone).not.toMatch(/\.\.\//);

    // --in-repo unchanged: a real workspace sibling under a scope this repo
    // publishes, so its registry install line is still the correct one.
    expect(inRepo).toContain(`pnpm add @objectstack/plugin-${PROJECT}`);
    expect(inRepo).toContain(`from '@objectstack/plugin-${PROJECT}'`);

    // NON-DEGENERACY, same shape as above: one README for both placements is
    // the regression this test exists to catch.
    expect(standalone).not.toBe(inRepo);
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
