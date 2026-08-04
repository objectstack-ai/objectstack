// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The kernel boot-path contract for `@objectstack/lint/runtime` (#4463).
//
// `lazy-deps.test.ts` next door pins that IMPORTING the package loads none of
// `typescript` (~9 MB), `sucrase` or `ajv`. That was enough while the only consumer
// was the CLI, which may load anything. #4463 gave the package a consumer on
// the kernel boot path — `@objectstack/metadata-protocol`, reached by every
// runtime metadata write — and that consumer needs the stronger claim:
//
//   RUNNING the gate, on a real body of a really-gated type, loads neither.
//
// Import-time laziness alone would not have said this. The registry statically
// names the react/jsx rules (one table, by design — see `authoring-rules.ts`),
// so the module graph is present; what must never happen is a runtime write
// TRIGGERING one. The rules #4463 wired to `runtime-publish` — flow, approval,
// expression, reference — read structured metadata and parse no authored
// source, so they cannot. This file is what keeps that true when the next rule
// is wired to the surface: widen `runtimeTypes` to a type whose snapshot
// carries a hook body or a react page and this goes red, which is the moment to
// stop and think, not a moment to relax the assertion.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(srcDir, '..', 'dist');

// `ajv` joined the list in #4762: the rule-compilability gate needs a real
// JSON-Schema compiler to judge a `json_schema` validation rule, and that rule
// is CLI-only (`surfaceReason: RUNTIME_OBJECT_WRITES_P2`). So the boot path must
// not pay for it — not at import, and not while gating. Should that rule ever be
// widened to `runtime-publish`, this assertion is what says so out loud.
// `ajv-formats` joined in #5029 for the same gate and the same trigger: the gate
// compiles in the runtime's ajv ENVIRONMENT, and that environment now registers
// the formats plugin. It carries ajv in with it, so listing it here is not
// belt-and-braces — it is the second door onto the same load.
const LAZY_DEPS = ['typescript', 'sucrase', 'ajv', 'ajv-formats'];

const depLoaded = (cache: Record<string, unknown> | undefined, dep: string) =>
  Object.keys(cache ?? {}).some((p) => p.split(/[/\\]/).join('/').includes(`/node_modules/${dep}/`));

/** The #4463 worked example: the body a Studio tenant could publish before the gate existed. */
const GATED_FLOW = {
  name: 'leave_approval',
  nodes: [
    { id: 'start', type: 'start' },
    {
      id: 'approve',
      type: 'approval',
      config: { approvers: [{ type: 'expression', value: 'record.owner ==' }] },
    },
  ],
};
const OBJECTS = [{ name: 'leave_request', fields: { owner: { type: 'text' } } }];

// Same shape as lazy-deps.test.ts: a spawned child is the only place a native
// require-cache probe means anything, because vitest inlines static imports
// through its transform and they never reach that cache.
const childBody = `
  const probe = require('node:module').createRequire(process.cwd() + '/probe.js');
  const loaded = (dep) => Object.keys(probe.cache ?? {}).some((p) => p.split(/[/\\\\]/).join('/').includes('/node_modules/' + dep + '/'));
  const fail = (msg) => { console.error(msg); process.exit(1); };
  const check = (mod) => {
    for (const dep of ${JSON.stringify(LAZY_DEPS)}) {
      if (loaded(dep)) fail(dep + ' was loaded merely by importing @objectstack/lint/runtime');
    }
    const result = mod.runRuntimeAuthoringRules({
      type: 'flow',
      item: ${JSON.stringify(GATED_FLOW)},
      context: { objects: ${JSON.stringify(OBJECTS)} },
    });
    if (!result.errors.some((f) => f.rule === 'approval-expression-invalid')) {
      fail('the gate produced no finding — the probe below would then be vacuously true');
    }
    for (const dep of ${JSON.stringify(LAZY_DEPS)}) {
      if (loaded(dep)) fail(dep + ' was loaded by RUNNING the runtime publish gate');
    }
    console.log('OK');
  };
`;

// Cold-loading a dist entry in a spawned node on a busy runner takes seconds.
const COLD_LOAD_TIMEOUT_MS = 30_000;

describe('@objectstack/lint/runtime (kernel boot-path contract, #4463)', () => {
  it.skipIf(!existsSync(join(distDir, 'runtime.cjs')))(
    'built CJS runtime entry loads no heavy dep, at import OR while gating',
    () => {
      const out = execFileSync(
        process.execPath,
        ['-e', `${childBody}; check(require(${JSON.stringify(join(distDir, 'runtime.cjs'))}));`],
        { encoding: 'utf8' },
      );
      expect(out).toContain('OK');
    },
    COLD_LOAD_TIMEOUT_MS,
  );

  it.skipIf(!existsSync(join(distDir, 'runtime.js')))(
    'built ESM runtime entry loads no heavy dep, at import OR while gating',
    () => {
      const out = execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { createRequire } from 'node:module';
           const require = createRequire(process.cwd() + '/probe.js');
           ${childBody};
           check(await import(${JSON.stringify(pathToFileURL(join(distDir, 'runtime.js')).href)}));`,
        ],
        { encoding: 'utf8' },
      );
      expect(out).toContain('OK');
    },
    COLD_LOAD_TIMEOUT_MS,
  );

  it('gating a flow in-process loads neither dep, and still finds the defect', async () => {
    const req = createRequire(import.meta.url);
    const { runRuntimeAuthoringRules } = await import('./runtime.js');

    const result = runRuntimeAuthoringRules({
      type: 'flow',
      item: GATED_FLOW,
      context: { objects: OBJECTS },
    });
    // Non-vacuity first: a probe over a gate that found nothing proves nothing.
    expect(result.errors.map((f) => f.rule)).toContain('approval-expression-invalid');

    for (const dep of LAZY_DEPS) {
      expect(
        depLoaded(req.cache, dep),
        `${dep} loaded while gating a flow — the metadata write path is on the kernel boot path and ` +
          `may not pay for a source parser to publish a flow`,
      ).toBe(false);
    }
  });

  it('the runtime entry re-exports the gate and nothing that carries a parser', async () => {
    const mod = await import('./runtime.js');
    expect(typeof mod.runRuntimeAuthoringRules).toBe('function');
    expect(typeof mod.runtimeAuthoringRulesFor).toBe('function');
    expect(typeof mod.runtimeGatedTypes).toBe('function');
    // The source-parsing rules must not be reachable through this entry by
    // name: a consumer that can call them can pay for them by accident.
    for (const forbidden of ['validateReactPages', 'validateReactPageProps', 'validateJsxPages']) {
      expect(
        forbidden in mod,
        `${forbidden} must not be exported from the kernel-safe entry`,
      ).toBe(false);
    }
  });
});
