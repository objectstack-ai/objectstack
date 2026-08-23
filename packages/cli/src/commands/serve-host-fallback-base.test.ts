// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `serve` hands `createHostImporter` its OWN resolution base (#11157) — the
 * half of that card an in-process test can honestly measure.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `createHostImporter`'s UNDECLARED leg falls back to "the importing package's
 * own resolution", and which package that is depends on where the `import()` is
 * physically WRITTEN: Node ESM resolves a bare specifier against the module
 * containing the call. #10943 made it an explicit parameter,
 * `options.fallbackImport`. `@objectstack/verify` and the `packages/qa/dogfood`
 * probe pass theirs; `serve`'s `importFromHost` did not, so its fallback
 * resolved from `@objectstack/types` — which under a pnpm-isolated layout sees
 * only `@objectstack/spec`.
 *
 * ── ⛔ DO NOT ASSERT RESOLUTION IN THIS FILE — it cannot fail here ──────────
 *
 * `@objectstack/types` is a LINKED workspace package, so Vite processes it as
 * source instead of externalising it and rewrites the `import()` inside
 * `packages/types/dist/node.mjs` to its own resolver — which resolves from the
 * vitest root, `packages/cli`. MEASURED in this checkout: an in-process
 * `createHostImporter(appRoot)('chalk')`, with NO caller base at all, RESOLVES
 * under vitest and THROWS `Cannot find package 'chalk'` under Node.
 *
 * Under vitest the two bases ARE the same base. A "before/after" written here
 * is green both ways, and — worse — so is the anti-vacuity control beside it,
 * so nothing reports that the pin stopped measuring anything. The resolution
 * pins therefore live in `test/serve-host-fallback-base.e2e.test.ts`, which
 * spawns a real Node process. This is also why the `chalk` assertion in
 * `serve-config-plugin-host-resolution.test.ts` is a behaviour statement and
 * not the measurement of this card.
 *
 * ── What DOES fail here, and why it is not a proxy ─────────────────────────
 *
 * `undeclaredMessage` (`@objectstack/types/node`) composes two different texts
 * depending on `fallbackImport !== undefined`. That branch is pure logic: no
 * resolver touches it, so vitest cannot flatten it. Before this card `serve` got
 * the text that tells the reader the caller withheld its base — a sentence this
 * card makes false. Moving the branch is part of the fix, not evidence about it.
 *
 * This file reads only `serve.ts` and `package.json` from its own package.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import Serve from './serve.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** `packages/cli/package.json` — this package's OWN declared surface. */
const CLI_MANIFEST = JSON.parse(
  readFileSync(resolve(HERE, '..', '..', 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> };

/** Declared by `packages/cli`, resolvable from it, NOT from `@objectstack/types`. */
const CLI_DECLARED = 'chalk';

/** A name no package anywhere can satisfy, so no result can be an accident. */
const NOWHERE = '@os-fixture/host-fallback-base-probe';

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A served app that declares nothing. */
function makeApp(): string {
  const root = mkdtempSync(join(tmpdir(), 'os-fallback-base-'));
  roots.push(root);
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '1.0.0', type: 'module' }),
  );
  return root;
}

describe('os serve → the undeclared diagnostic takes the caller-supplied-base branch', () => {
  it('names the APP (#11185) and no longer says the caller withheld its base (#11157)', async () => {
    const root = makeApp();

    const err = (await Serve.importConfigPlugin(NOWHERE, root).catch((e: unknown) => e)) as Error;

    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain(`Failed to import plugin '${NOWHERE}':`);
    expect(err.message).toContain(`Cannot find package '${NOWHERE}'`);
    // #11185's text: the app being served, never the process CWD.
    expect(err.message).toContain(`host app: ${root}`);
    expect(err.message).not.toContain(`host app: ${process.cwd()}`);
    // #11157: the other branch of the same message. `serve` supplies its base
    // now, so the note that exists to report the gap must not be printed.
    expect(err.message).not.toContain('the caller did not pass `fallbackImport`');
    // The #4719 remedy the helper owns is unchanged — this card moved a base,
    // not the declaration contract.
    expect(err.message).toMatch(/Declare it in that app's package\.json/);
    expect(err.message).toMatch(/merely REACHABLE is not enough/);
  });
});

describe('os serve → the base is wired at the single importer construction', () => {
  const SERVE_SOURCE = readFileSync(resolve(HERE, 'serve.ts'), 'utf8');

  it('the specifier the e2e pin uses is one packages/cli DECLARES', () => {
    // Guards the e2e against the manifest changing under it: if `chalk` stopped
    // being a declared dependency, that pin could still pass by workspace
    // hoisting and would no longer measure the accept-set this card widens.
    expect(Object.keys(CLI_MANIFEST.dependencies ?? {})).toContain(CLI_DECLARED);
  });

  it('passes fallbackImport where the importer is built', () => {
    // `serve-cluster-host-resolution.test.ts` pins that there is exactly ONE
    // `createHostImporter(` in this file. This pins that the one carries a base.
    expect(SERVE_SOURCE).toMatch(/createHostImporter\(hostRoot,\s*\{/);
    expect(SERVE_SOURCE).toMatch(
      /fallbackImport: \(fallbackSpecifier\) => import\(\/\* webpackIgnore: true \*\/ fallbackSpecifier\)/,
    );
    // A URL/string base would compile and silently ignore the parent argument —
    // measured on Node v22 and recorded in `@objectstack/types/node`. It is not
    // a spelling variant of the line above; it is the phantom fix of this card.
    expect(SERVE_SOURCE).not.toMatch(/fallbackImport:\s*(?:import\.meta\.url|['"`])/);
  });

  it('the config-plugin path no longer re-implements the declaration read', () => {
    // Collapsed in #11157: the undeclared branch's local `import()` and the
    // re-entry branch became the same call once the base was threaded, so the
    // declaration is read once, by `readHostDeclaration` inside the helper.
    const helper = SERVE_SOURCE.slice(SERVE_SOURCE.indexOf('static async importConfigPlugin'));
    const body = helper.slice(0, helper.indexOf('\n  }\n'));
    expect(body).toContain('importFromHost(pluginSpecifier, root)');
    expect(body).not.toContain('isDeclaredByHost');
  });
});
