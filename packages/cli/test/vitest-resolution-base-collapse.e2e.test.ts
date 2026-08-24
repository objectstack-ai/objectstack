// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #11412 — under vitest, an in-process test CANNOT measure which package a bare
 * specifier resolves from, and the anti-vacuity control written beside such a
 * test is vacuous too. This file is the executable record of that platform fact.
 *
 * It is a PRECONDITION pin in the sense `packages/types/src/node.test.ts` uses
 * the word: it asserts what the runner does, not what this repo's code does, so
 * that the day vitest/Vite changes the behaviour the repo is told — instead of
 * the next author rediscovering it by ablation, which is the expensive path this
 * card was filed to close.
 *
 * ── TWO mechanisms, not one. They need different remedies ──────────────────
 *
 * **M1 — Vite inlines a linked workspace package and rewrites its `import()`.**
 * The inline/external decision is `server.deps.external`'s default,
 * `[/\/node_modules\//]`, evaluated against the module's REALPATH. Every
 * workspace package here is a pnpm link whose realpath is the package directory
 * (`packages/types/dist/node.mjs`), which contains no `/node_modules/` segment
 * — so every workspace dependency is INLINED, including one reached through
 * `exports` to `dist/`. Vite then rewrites the `import()` written inside it to
 * `__vite_ssr_dynamic_import__`, which resolves from the VITEST ROOT rather than
 * from the module that physically contains the call. Node ESM does the opposite:
 * it anchors a bare specifier at the containing module. So under vitest the
 * callee's base and the caller's base ARE THE SAME BASE.
 *
 * That is what makes the control vacuous. The control for a base claim is "build
 * it the old way and show it fails" — and the old way does not fail here, so the
 * control is written green and reports nothing. Measured on this card: removing
 * #11157's fix from `serve.ts` entirely left the in-process `chalk` assertion in
 * `src/commands/serve-config-plugin-host-resolution.test.ts` GREEN, while the
 * spawned-child pin of the same claim in `serve-host-fallback-base.e2e.test.ts`
 * went RED. Same tree, same ablation, opposite verdicts.
 *
 * **M2 — `NODE_PATH` reaches the spawned child, and CJS honours it.** This one
 * is NOT vitest rewriting anything, and it survives the obvious remedy. A vitest
 * worker runs with `NODE_PATH` pointing at pnpm's hoisted store
 * (`node_modules/.pnpm/node_modules`, which holds everything transitively
 * reachable in the workspace), and `test/helpers/serve-process.ts`'s `childEnv()`
 * strips only `TEST` / `VITEST*` — so `NODE_PATH` rides into every spawned child
 * this package starts.
 *
 * The split that decides whether that matters, measured here:
 *
 *     resolution API                  NODE_PATH honoured?   base preserved?
 *     ESM  `import()` / import.meta.resolve   NO                   YES
 *     CJS  createRequire().resolve()          YES                  NO
 *
 * and `NODE_PATH` is a FALLBACK, not an override — the `node_modules` walk wins
 * when it hits, so the store can only turn a MISS into a HIT. The dangerous
 * direction is therefore an ACCEPTANCE claim ("this base CAN reach X"): it goes
 * green because the store supplied X, not because the base did.
 *
 * ⚠️ Consequence for the remedy this repo standardised on: spawning a real Node
 * child escapes M1 but NOT M2. `serve-host-fallback-base.e2e.test.ts`'s CONTROL
 * is sound only because `createHostImporter`'s fallback leg is an ESM `import()`.
 * Had it been CJS — as `createHostRequire` is — the inherited `NODE_PATH` would
 * have kept it green through the very ablation it exists to fail. A spawned pin
 * whose claim routes through CJS must pass `childEnv({ NODE_PATH: undefined })`.
 *
 * ── Reading this file ──────────────────────────────────────────────────────
 *
 * Every zero is paired with a control that proves the probe could have been
 * non-zero, because a probe that can only say MISS would "confirm" all of the
 * above while measuring nothing. `chalk` is the discriminator throughout: it is
 * DECLARED by `packages/cli` and resolvable from it, and NOT resolvable from
 * `packages/types` (whose one dependency is `@objectstack/spec`).
 *
 * `@objectstack/types` is reached by SPECIFIER and every path below is DERIVED
 * from that resolution — never written as `resolve(HERE, '../../types/…')`. Both
 * spellings land on the same file; only one is honest about naming an installed
 * dependency rather than a repo source input no turbo glob covers. See
 * `pnpm check:cross-package-test-inputs` for the rule and its reason.
 */

import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { createHostImporter } from '@objectstack/types/node';
import { childEnv } from './helpers/serve-process.js';

const execFileAsync = promisify(execFile);

/** Declared by `packages/cli`, NOT resolvable from `packages/types`. */
const CLI_DECLARED = 'chalk';
/** `packages/types`' one declared dependency — resolvable from BOTH bases. */
const TYPES_DECLARED = '@objectstack/spec';
/** Satisfiable by nothing anywhere, so no result can be an accident. */
const NOWHERE = '@os-fixture/vitest-base-collapse-probe';

/**
 * The helper's own entry, by specifier. `dirname()` of it is the directory the
 * `import()` inside `dist/node.mjs` is physically written in — i.e. the base
 * Node would anchor that call at, and the one vitest replaces.
 */
const TYPES_ENTRY = createRequire(import.meta.url).resolve('@objectstack/types/node');
const TYPES_BASE = dirname(TYPES_ENTRY);

/**
 * One child, run at the types package's own base. Reports what REAL Node says
 * for each API, so the in-process readings have something to diverge from.
 */
const CHILD = `
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const attempt = (fn) => { try { return 'RESOLVED:' + String(fn()); } catch (e) { return 'MISS:' + String(e.code ?? e.message); } };
// The FULL message: \`createHostImporter\` composes the origin Node reports onto
// a later line, and a first-line-only reading loses exactly the half that says
// WHICH base failed — the sentence this file exists to assert.
const attemptAsync = async (fn) => { try { await fn(); return 'RESOLVED'; } catch (e) { return String(e.message); } };

// Wired by env, never by argv position: \`node -e\` shifts argv (there is no
// script path), and a shifted argv reads as a resolution failure rather than as
// a wiring bug.
const req = createRequire(join(process.cwd(), 'probe.cjs'));
const { createHostImporter } = await import(pathToFileURL(process.env.PROBE_TYPES_ENTRY).href);
const appRoot = process.env.PROBE_APP_ROOT;

console.log(JSON.stringify({
  // PROOF OF ANCHOR: the referrer this child's ESM leg actually resolves against.
  esmReferrer: import.meta.url,
  nodePathSeen: process.env.NODE_PATH ?? '(unset)',
  esmCliDeclared: attempt(() => import.meta.resolve(${JSON.stringify(CLI_DECLARED)})),
  esmTypesDeclared: attempt(() => import.meta.resolve(${JSON.stringify(TYPES_DECLARED)})),
  esmNowhere: attempt(() => import.meta.resolve(${JSON.stringify(NOWHERE)})),
  cjsCliDeclared: attempt(() => req.resolve(${JSON.stringify(CLI_DECLARED)})),
  cjsNowhere: attempt(() => req.resolve(${JSON.stringify(NOWHERE)})),
  noBaseImporter: await attemptAsync(() => createHostImporter(appRoot)(${JSON.stringify(CLI_DECLARED)})),
}));
`;

let appRoot: string;
/** Real Node, `NODE_PATH` stripped — the uncontaminated baseline. */
let clean: Record<string, string>;
/** Real Node, `NODE_PATH` exactly as `childEnv()` hands it over. */
let inherited: Record<string, string>;

async function runChild(env: Record<string, string | undefined>): Promise<Record<string, string>> {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--input-type=module', '-e', CHILD],
    {
      cwd: TYPES_BASE,
      env: { ...env, PROBE_TYPES_ENTRY: TYPES_ENTRY, PROBE_APP_ROOT: appRoot } as NodeJS.ProcessEnv,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout.trim()) as Record<string, string>;
}

beforeAll(async () => {
  appRoot = mkdtempSync(join(tmpdir(), 'os-11412-app-'));
  writeFileSync(
    join(appRoot, 'package.json'),
    JSON.stringify({ name: 'fixture-app', version: '1.0.0', type: 'module' }),
  );
  clean = await runChild(childEnv({ NO_COLOR: '1', NODE_PATH: undefined }));
  inherited = await runChild(childEnv({ NO_COLOR: '1' }));
}, 120_000);

afterAll(() => {
  if (appRoot) rmSync(appRoot, { recursive: true, force: true });
});

describe('#11412 CONTROLS — the probe can return every answer it is asked to distinguish', () => {
  it('the child really is anchored at the types package, not at the test', () => {
    // Without this the whole file could be measuring `packages/cli` twice. The
    // referrer is `file://<cwd>/[eval1]`, which is what `--input-type=module`
    // anchors a bare specifier at.
    expect(clean.esmReferrer).toContain(pathToFileURL(TYPES_BASE).href);
  });

  it('CAN say HIT: the types package resolves its own declared dependency', () => {
    expect(clean.esmTypesDeclared).toMatch(/^RESOLVED:/);
  });

  it('CAN say MISS: a specifier nothing satisfies misses on both legs, both envs', () => {
    for (const probe of [clean, inherited]) {
      expect(probe.esmNowhere).toMatch(/^MISS:/);
      expect(probe.cjsNowhere).toMatch(/^MISS:/);
    }
  });
});

describe('#11412 M1 — vitest flattens the resolution base an in-process test would measure', () => {
  it('REAL NODE: the no-base importer cannot reach a CLI-declared package, and names its base', async () => {
    expect(clean.noBaseImporter).not.toBe('RESOLVED');
    expect(clean.noBaseImporter).toContain(`Cannot find package '${CLI_DECLARED}'`);
    // Named, not merely failed — this is the sentence the whole card is about.
    expect(clean.noBaseImporter).toMatch(/imported from .*[/\\]packages[/\\]types[/\\]/);
  });

  it('UNDER VITEST: the identical call RESOLVES — so no in-process pin over it can fail', async () => {
    await expect(createHostImporter(appRoot)(CLI_DECLARED)).resolves.toBeDefined();
    // …and the same importer still refuses a specifier nothing satisfies, so the
    // line above is the base collapsing, not "everything resolves in here".
    await expect(createHostImporter(appRoot)(NOWHERE)).rejects.toThrow(
      `Cannot find package '${NOWHERE}'`,
    );
  });

  it('the mechanism is Vite rewriting the inlined package’s dynamic import', () => {
    // If this ever reads false, M1 is gone and the two cases above should be
    // re-measured before anything is written on top of them.
    expect(String(createHostImporter)).toContain('__vite_ssr_dynamic_import__');
  });
});

describe('#11412 M2 — spawning escapes Vite, but NODE_PATH rides along and CJS honours it', () => {
  it('childEnv() hands NODE_PATH to the child (it strips only TEST / VITEST*)', () => {
    expect(inherited.nodePathSeen).not.toBe('(unset)');
    // The stripped-env leg is what proves the line above is about `childEnv()`'s
    // policy and not about this box always having NODE_PATH set.
    expect(clean.nodePathSeen).toBe('(unset)');
  });

  it('ESM ignores NODE_PATH: the base survives into the child', () => {
    expect(clean.esmCliDeclared).toMatch(/^MISS:/);
    expect(inherited.esmCliDeclared).toMatch(/^MISS:/);
  });

  it('CJS honours NODE_PATH: the same base, the same specifier, the opposite answer', () => {
    expect(clean.cjsCliDeclared).toMatch(/^MISS:/);
    expect(inherited.cjsCliDeclared).toMatch(/^RESOLVED:/);
  });
});
