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
// is wired to the surface: widen `runtimeTypes` onto a type whose snapshot
// carries a hook body, a react page or a `json_schema` validation and this goes
// red, which is the moment to stop and think, not a moment to relax the
// assertion.
//
// ## Why the probe runs a flow AND an object (#4716)
//
// The prose above was, until #4716, wider than the assertion under it: every
// gate-running probe in this file wrote a `type: 'flow'` body and nothing else.
// Measured on the #4716 cost round, and re-measured on this branch: the heavy
// dep that actually threatens the boot path is `ajv` (+ `ajv-formats`), and
// **the written TYPE is what reaches it, not the rule set.** A `json_schema`
// validation is authored on an OBJECT (`objects[].validations[]`), so a flow
// write can never make `validateRuleCompilability` compile anything, while an
// object write hands it a schema on a plate. Widen that CLI-only rule onto
// `object` — precisely what #4716's first bullet proposes — and a flow-only
// probe stays green while the kernel starts paying for a JSON-Schema compiler
// on every Studio field edit.
//
// So the object leg below is not a second copy of the flow leg. It is the leg
// that can actually fail, and it lands BEFORE any widening deliberately: a
// guard authored after the event it was meant to catch cannot be shown to work
// (the #8824 tripwire logic). The `ajv loads on demand` test at the bottom is
// what shows this one can — see its own note.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect } from 'vitest';

const srcDir = dirname(fileURLToPath(import.meta.url));
const distDir = join(srcDir, '..', 'dist');
const runtimeCjs = join(distDir, 'runtime.cjs');
const runtimeEsm = join(distDir, 'runtime.js');
const indexCjs = join(distDir, 'index.cjs');

// `ajv` joined the list in #4762: the rule-compilability gate needs a real
// JSON-Schema compiler to judge a `json_schema` validation rule, and that rule
// is CLI-only (`surfaceReason: RUNTIME_OBJECT_WRITES_P2`). So the boot path must
// not pay for it — not at import, and not while gating. Should that rule ever be
// widened to `runtime-publish`, this assertion is what says so out loud — which
// it can only do over a body carrying such a rule, hence `GATED_OBJECT` (#4716).
// `ajv-formats` joined in #5029 for the same gate and the same trigger: the gate
// compiles in the runtime's ajv ENVIRONMENT, and that environment now registers
// the formats plugin. It carries ajv in with it, so listing it here is not
// belt-and-braces — it is the second door onto the same load.
const LAZY_DEPS = ['typescript', 'sucrase', 'ajv', 'ajv-formats'];

/** The two deps only an OBJECT write can reach today — the #4716 leg's subject. */
const SCHEMA_DEPS = ['ajv', 'ajv-formats'];

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

/**
 * The #4716 worked example: an OBJECT write that carries the exact artifact the
 * heavy dep exists to judge — a `json_schema` validation whose `schema` ajv
 * refuses to compile (`type` is not a JSON-Schema type, `required` is not an
 * array).
 *
 * Two properties this body must keep, or the leg below stops meaning anything:
 *
 * 1. **It must trip a rule that gates `object` today**, so the dep probe is not
 *    vacuously true over a gate that judged nothing. The `relatedListFilter`
 *    compares a datetime against the bare date-range preset `last_30_days` in
 *    an ORDERING position, which `validatePresetComparands` (gated on
 *    `dashboard`/`view`/`object`/`page`/`flow`) refuses as
 *    `filter-preset-comparand`. Everything else here is deliberately clean —
 *    `sharingModel` is authored so `validateSecurityPosture`, the other rule
 *    gating `object`, contributes nothing and the expected finding set stays
 *    exactly the one this fixture is authored to produce.
 * 2. **Its `schema` must stay one ajv rejects**, so the positive control at the
 *    bottom keeps proving the require-cache probe can SEE the load. That test
 *    fails loudly if this stops being true, rather than letting the negative
 *    leg quietly degrade into "a body with nothing in it loads nothing".
 */
const GATED_OBJECT = {
  name: 'leave_request',
  label: 'Leave Request',
  sharingModel: 'private',
  fields: {
    owner: { type: 'text' },
    created_at: { type: 'datetime' },
    approvals: {
      type: 'lookup',
      reference_to: 'leave_approval',
      relatedList: true,
      relatedListFilter: { created_at: { $gte: 'last_30_days' } },
    },
  },
  validations: [
    { name: 'payload_shape', type: 'json_schema', schema: { type: 'not_a_real_type', required: 'owner' } },
  ],
};

/**
 * The stored row this write updates. Same name, so the gate's replace-not-erase
 * snapshot exercises the real update path (`buildRuntimeWriteSnapshots`) rather
 * than an insert into an empty tenant, and clean, so nothing in the BASELINE
 * pass can be mistaken for something this write added.
 */
const OBJECT_CONTEXT = [
  { name: 'leave_request', sharingModel: 'private', fields: { owner: { type: 'text' } } },
];

// Same shape as lazy-deps.test.ts: a spawned child is the only place a native
// require-cache probe means anything, because vitest inlines static imports
// through its transform and they never reach that cache.
//
// `loaded` / `fail` are split out of `check` (#4716) because the positive
// control at the bottom of this file needs the same probe over a DIFFERENT
// question — "did it load?" rather than "did it stay clean?" — and a second
// copy of the cache walk would be a second opinion about what "loaded" means.
const probeHelpers = `
  const probe = require('node:module').createRequire(process.cwd() + '/probe.js');
  const loaded = (dep) => Object.keys(probe.cache ?? {}).some((p) => p.split(/[/\\\\]/).join('/').includes('/node_modules/' + dep + '/'));
  const fail = (msg) => { console.error(msg); process.exit(1); };
`;

const childBody = `
  ${probeHelpers}
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

    // #4716: the same claim over an OBJECT write carrying a \`json_schema\`
    // validation — the only written type that can reach ajv today.
    const objectResult = mod.runRuntimeAuthoringRules({
      type: 'object',
      item: ${JSON.stringify(GATED_OBJECT)},
      context: { objects: ${JSON.stringify(OBJECT_CONTEXT)} },
    });
    if (objectResult.rulesRun.length === 0) {
      fail('no rule gates an object write — the object leg would then assert nothing');
    }
    if (!objectResult.errors.some((f) => f.rule === 'filter-preset-comparand')) {
      fail('the gate produced no finding on the object write — the probe below would be vacuously true');
    }
    for (const dep of ${JSON.stringify(LAZY_DEPS)}) {
      if (loaded(dep)) {
        fail(dep + ' was loaded by RUNNING the runtime publish gate on an OBJECT write carrying a json_schema validation');
      }
    }
    console.log('OK');
  };
`;

// Cold-loading a dist entry in a spawned node on a busy runner takes seconds.
const COLD_LOAD_TIMEOUT_MS = 30_000;

describe('@objectstack/lint/runtime (kernel boot-path contract, #4463)', () => {
  it.skipIf(!existsSync(runtimeCjs))(
    'built CJS runtime entry loads no heavy dep, at import OR while gating',
    () => {
      const out = execFileSync(
        process.execPath,
        ['-e', `${childBody}; check(require(${JSON.stringify(runtimeCjs)}));`],
        { encoding: 'utf8' },
      );
      expect(out).toContain('OK');
    },
    COLD_LOAD_TIMEOUT_MS,
  );

  it.skipIf(!existsSync(runtimeEsm))(
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
           check(await import(${JSON.stringify(pathToFileURL(runtimeEsm).href)}));`,
        ],
        { encoding: 'utf8' },
      );
      expect(out).toContain('OK');
    },
    COLD_LOAD_TIMEOUT_MS,
  );

  // Same cold load as the two above, just in-process: the first `import()` of
  // `./runtime.js` in this file pulls the whole gate graph through the transform.
  // So it gets the same budget — the claim being pinned (the boot path loads no
  // source parser) is proved by the assertions below, never by the wall clock,
  // and a 5 s default only turns a busy runner into a false red on the gate.
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
  }, COLD_LOAD_TIMEOUT_MS);

  // #4716. The leg that can actually fail: `json_schema` validations are
  // authored on objects, so this is the only written type whose snapshot can
  // hand `validateRuleCompilability` a schema to compile. Runs in-process for
  // the same reason the flow leg does, and BEFORE the positive control below
  // (which is spawned precisely so it can never poison this cache).
  it('gating an object that carries a json_schema validation loads no compiler, and still finds the defect', async () => {
    const req = createRequire(import.meta.url);
    const { runRuntimeAuthoringRules } = await import('./runtime.js');

    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: GATED_OBJECT,
      context: { objects: OBJECT_CONTEXT },
    });
    // Two non-vacuity claims, because an object write can be empty in two ways:
    // no rule gating the type at all, or a body no gating rule objects to.
    expect(
      result.rulesRun.length,
      'no registry rule gates an object write — this leg would then prove nothing about the boot path',
    ).toBeGreaterThan(0);
    expect(result.errors.map((f) => f.rule)).toContain('filter-preset-comparand');

    for (const dep of LAZY_DEPS) {
      expect(
        depLoaded(req.cache, dep),
        `${dep} loaded while gating an OBJECT write carrying a json_schema validation. The metadata ` +
          `write path is on the kernel boot path: Studio's designer reaches it on every field edit, and ` +
          `it may not start paying for a JSON-Schema compiler. If a rule was just widened onto 'object', ` +
          `this is the moment to stop and think (#4716) — not to relax the assertion`,
      ).toBe(false);
    }
  }, COLD_LOAD_TIMEOUT_MS);

  // #4716 — the probe's own non-vacuity, and the reason to trust the leg above.
  //
  // A require-cache walk that reports "clean" proves nothing until it has been
  // shown to report "dirty" for the load it exists to catch. So: hand the SAME
  // object body to `validateRuleCompilability` — the CLI-only rule that would
  // run at the gate if #4716's first bullet widened it onto `object` — and
  // demand that ajv and ajv-formats DO appear in the cache. Measured on this
  // branch: 63 ajv modules + 3 ajv-formats modules, cold ~56 ms vs warm ~11 ms.
  //
  // Spawned, never in-process: this test deliberately loads the deps every
  // other test here forbids, and the native require cache it writes into is the
  // very one the in-process leg reads.
  it.skipIf(!existsSync(indexCjs) || !existsSync(runtimeCjs))(
    'the same object body DOES load ajv when the compilability rule judges it (probe is not vacuous)',
    () => {
      const out = execFileSync(
        process.execPath,
        [
          '-e',
          `${probeHelpers}
           const rt = require(${JSON.stringify(runtimeCjs)});
           const full = require(${JSON.stringify(indexCjs)});
           for (const dep of ${JSON.stringify(SCHEMA_DEPS)}) {
             if (loaded(dep)) fail(dep + ' was loaded merely by importing the full @objectstack/lint barrel');
           }
           const snapshots = rt.buildRuntimeWriteSnapshots({
             type: 'object',
             item: ${JSON.stringify(GATED_OBJECT)},
             context: { objects: ${JSON.stringify(OBJECT_CONTEXT)} },
           });
           if (!snapshots) fail('the gate builds no snapshot for an object write — the leg above is then untested');
           const findings = full.validateRuleCompilability(snapshots.candidate);
           if (!findings.some((f) => f.rule === 'validation-rule-json-schema-uncompilable')) {
             fail('GATED_OBJECT no longer carries a schema ajv refuses to compile, so the negative leg ' +
                  'above has degraded into "a body with nothing in it loads nothing". Restore a schema ' +
                  'ajv rejects rather than deleting this test.');
           }
           for (const dep of ${JSON.stringify(SCHEMA_DEPS)}) {
             if (!loaded(dep)) {
               fail(dep + ' did NOT load even though the compilability rule just compiled this body. The ' +
                    'require-cache probe cannot see the load it exists to catch, so every clean result in ' +
                    'this file is vacuous — fix the probe, do not trust the greens.');
             }
           }
           console.log('OK');`,
        ],
        { encoding: 'utf8' },
      );
      expect(out).toContain('OK');
    },
    COLD_LOAD_TIMEOUT_MS,
  );

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
