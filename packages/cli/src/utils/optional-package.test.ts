// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `loadOptionalPackage()` tells "not installed" from "installed and broken"
 * (#5644).
 *
 * Every case below drives the REAL mechanism — a real `import()` and a real
 * `import.meta.resolve()` against real files on disk. Nothing is mocked,
 * because the whole subject of this module is what the runtime actually
 * answers, and a mocked resolver would pin the assumption rather than the
 * behaviour. `os doctor`'s three-state report is built on top of this, and its
 * own file mocks THIS module in turn; the split is deliberate — the
 * classification is proven here against the runtime, the rendering is proven
 * there against doctor.
 *
 * The state each case stands for, in the world the caller cares about:
 *
 *   - absent                → the optional package was never installed.
 *   - broken / throwing     → an artefact that blows up while it evaluates.
 *   - broken / entry gone   → an unbuilt or pruned `dist/`. THE case a
 *                             `catch`-only classifier gets wrong: it fails with
 *                             `ERR_MODULE_NOT_FOUND`, exactly like a package
 *                             that is not installed at all.
 *   - broken / dep missing  → the package is fine, something under it is not.
 *   - loaded                → nothing to report.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadOptionalPackage } from './optional-package.js';

/** A specifier nothing in this workspace resolves — genuinely not installed. */
const NEVER_INSTALLED = '@objectstack/not-a-real-package-5644';

let tmp: string;
/** Absolute `file:` URL, so resolution is anchored on the file, not on a base. */
const fixtureUrl = (name: string) => pathToFileURL(path.join(tmp, name)).href;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'os-5644-optional-pkg-'));
  fs.writeFileSync(path.join(tmp, 'healthy.mjs'), 'export const marker = "loaded";\n');
  fs.writeFileSync(path.join(tmp, 'throws.mjs'), 'throw new Error("boom while evaluating");\n');
  fs.writeFileSync(
    path.join(tmp, 'missing-dep.mjs'),
    'import "@objectstack/not-a-real-dependency-5644";\nexport const marker = "unreachable";\n',
  );
});

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadOptionalPackage — the two facts one `catch` used to merge', () => {
  it('reports a specifier that does not resolve as absent, and carries no cause', async () => {
    const load = await loadOptionalPackage(NEVER_INSTALLED);

    // Silence downstream depends on this: `os doctor` must run to completion
    // in a checkout that never had the optional package.
    expect(load.state).toBe('absent');
    // An absent package has nothing to say, so there is nothing to report.
    expect(load).not.toHaveProperty('cause');
  });

  it('reports a module that throws while evaluating as broken, with what it threw', async () => {
    const load = await loadOptionalPackage(fixtureUrl('throws.mjs'));

    expect(load.state).toBe('broken');
    expect((load as { cause: Error }).cause).toBeInstanceOf(Error);
    // Quoted, not paraphrased — the row doctor prints repeats this verbatim.
    expect((load as { cause: Error }).cause.message).toContain('boom while evaluating');
  });

  it('reports a RESOLVABLE module whose file is not there as broken, not absent', async () => {
    // The unbuilt / pruned `dist/` state, and the reason this module exists.
    // Node answers it with `ERR_MODULE_NOT_FOUND` — the same code a package
    // that was never installed produces — so classifying by the error alone
    // returns "absent" here and the caller goes silent over a package that IS
    // installed. Resolution is what separates them: it succeeds, because the
    // specifier is resolvable even though the file it names is missing.
    const load = await loadOptionalPackage(fixtureUrl('not-built-yet.mjs'));

    expect(load.state).toBe('broken');
    expect(String((load as { cause: Error }).cause.message)).toContain('not-built-yet.mjs');
  });

  it('reports a package whose own dependency is missing as broken, not absent', async () => {
    // The same trap one level down: the failure is `ERR_MODULE_NOT_FOUND` and
    // it is NOT about this package, which is present and resolvable.
    const load = await loadOptionalPackage(fixtureUrl('missing-dep.mjs'));

    expect(load.state).toBe('broken');
    expect(String((load as { cause: Error }).cause.message)).toContain(
      '@objectstack/not-a-real-dependency-5644',
    );
  });

  it('hands back the namespace when the package loads', async () => {
    const load = await loadOptionalPackage(fixtureUrl('healthy.mjs'));

    expect(load.state).toBe('loaded');
    expect((load as { module: { marker: string } }).module.marker).toBe('loaded');
  });

  it('resolves a real workspace package rather than mistaking it for absent', async () => {
    // The end-to-end control: the package `os doctor` actually loads. If this
    // ever came back `absent` in a built worktree, every ledger check in this
    // repo would be silently skipped and nothing else would notice.
    const load = await loadOptionalPackage('@objectstack/cloud-connection');

    expect(load.state).toBe('loaded');
  });
});
