// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The kernel boot-path contract for `@objectstack/lint/runtime` (#4463).
//
// `lazy-deps.test.ts` next door pins that IMPORTING the package loads none of
// `typescript` (~9 MB), `sucrase` or `ajv`. That was enough while the only consumer
// was the CLI, which may load anything. #4463 gave the package a consumer on
// the kernel boot path — `@objectstack/metadata-protocol`, reached by every
// runtime metadata write — and that consumer needs the stronger claim about
// what RUNNING the gate may load.
//
// Import-time laziness alone would not say this. The registry statically
// names the react/jsx rules (one table, by design — see `authoring-rules.ts`),
// so the module graph is present; what matters is what a runtime write
// TRIGGERS. Since #4716 widened the five gating object rules onto the object
// write door — two of which judge `json_schema` validations through ajv — the
// contract this file pins is THREE-TIER, not a flat "loads nothing":
//
//  1. `typescript` / `sucrase` (the ~9 MB source parsers) load NEVER — not at
//     import, not gating any type, with or without any authored artifact. The
//     two rules that need them stay CLI-only (`RUNTIME_HEAVY_SOURCE_PARSE`);
//     Studio compiles page source on its own path.
//  2. `ajv` / `ajv-formats` load NEVER at import, NEVER gating a flow, and
//     NEVER gating an object write whose snapshot carries no `json_schema`
//     validation — the hot path: an ordinary Studio field edit still pays for
//     no compiler at all. Both rules load ajv lazily, on first contact with
//     an actual schema (`validate-rule-compilability.ts`'s loadAjv note).
//  3. `ajv` / `ajv-formats` DO load — and the gate DOES refuse — when an
//     object write carries a `json_schema` validation ajv rejects. That is
//     the adjudicated price of #4716 (measured: ~64 ms cold once, ~15 ms warm
//     per schema-carrying publish), taken deliberately, and the leg below that
//     demands the load is what keeps tier 2's clean reads falsifiable.
//
// ## The tripwire fired before it was re-pinned (#4716)
//
// This file's object leg landed in PR #9295, BEFORE the widening, precisely so
// the guard could be shown to work (the #8824 tripwire logic: a guard authored
// after the event it was meant to catch cannot be). It did: on the #4716
// branch, the widening alone turned 3 of 6 legs red — spawned CJS, spawned
// ESM, and the in-process object leg — each naming ajv loaded while gating the
// schema-carrying object write. The re-pin you are reading is the "stop and
// think" that red demanded: the parsers stay banned outright (tier 1), the
// schema-free hot path stays compiler-free (tier 2), and the one load the
// adjudication accepted is now REQUIRED rather than forbidden (tier 3), so it
// can neither regress into an eager import nor quietly stop meaning anything.

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

// `ajv` joined the list in #4762, when `validateRuleCompilability` was
// CLI-only and the boot path was to pay for it never. #4716 widened that rule
// (and `validateRuleSchemaFormats`) onto the object write door, so ajv moved
// from tier 1 (never) to tiers 2/3 of the header contract: still never at
// import and never without a `json_schema` validation in the judged snapshot,
// but REQUIRED to load — lazily, on demand — when one is present.
// `ajv-formats` joined in #5029 for the same gate and the same trigger: the gate
// compiles in the runtime's ajv ENVIRONMENT, and that environment now registers
// the formats plugin. It carries ajv in with it, so listing it here is not
// belt-and-braces — it is the second door onto the same load.
const LAZY_DEPS = ['typescript', 'sucrase', 'ajv', 'ajv-formats'];

/** The two parsers the gate may load under NO circumstance (tier 1). */
const PARSER_DEPS = ['typescript', 'sucrase'];

/** The two deps only a schema-carrying OBJECT write may (and must) reach. */
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
 * The tier-2 subject: an OBJECT write with NO `json_schema` validation
 * anywhere in its snapshot — the ordinary Studio field edit, the hottest
 * write in the product. All five #4716 rules run on it (including the two
 * ajv-carrying ones, which meet no schema and must therefore load nothing).
 *
 * It must keep tripping a rule that gates `object`, so the dep probe is not
 * vacuously true over a gate that judged nothing: the `relatedListFilter`
 * compares a datetime against the bare date-range preset `last_30_days` in
 * an ORDERING position, which `validatePresetComparands` refuses as
 * `filter-preset-comparand`. Everything else is deliberately clean —
 * `sharingModel` is authored so `validateSecurityPosture` contributes
 * nothing, and no field/validation shape draws the #4716 rules — so the
 * expected finding set stays exactly the one this fixture is authored to
 * produce.
 */
const PLAIN_OBJECT = {
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
};

/**
 * The tier-3 subject: the same object CARRYING the exact artifact the heavy
 * dep exists to judge — a `json_schema` validation whose `schema` ajv refuses
 * to compile (`type` is not a JSON-Schema type, `required` is not an array).
 *
 * Its `schema` must stay one ajv rejects, for both directions of the pin: the
 * tier-3 leg demands the gate REFUSE it (`validation-rule-json-schema-
 * uncompilable`) while loading ajv, and the positive control at the bottom
 * uses the same body to prove the require-cache probe can SEE the load. Both
 * fail loudly if this stops being true, rather than letting the tier-2 leg
 * quietly degrade into "a body with nothing in it loads nothing".
 */
const SCHEMA_OBJECT = {
  ...PLAIN_OBJECT,
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

    // Tier 2 (#4716): an OBJECT write with no json_schema validation runs all
    // five widened rules — including the two ajv-carrying ones — and still
    // loads nothing: the ordinary Studio field edit stays compiler-free.
    const objectResult = mod.runRuntimeAuthoringRules({
      type: 'object',
      item: ${JSON.stringify(PLAIN_OBJECT)},
      context: { objects: ${JSON.stringify(OBJECT_CONTEXT)} },
    });
    if (objectResult.rulesRun.length === 0) {
      fail('no rule gates an object write — the object leg would then assert nothing');
    }
    if (!objectResult.rulesRun.includes('validateRuleCompilability')) {
      fail('validateRuleCompilability is not dispatched for object writes — tier 2 would then be ' +
           'vacuous, a clean read over a gate that never touches the ajv-carrying rules (#4716)');
    }
    if (!objectResult.errors.some((f) => f.rule === 'filter-preset-comparand')) {
      fail('the gate produced no finding on the object write — the probe below would be vacuously true');
    }
    for (const dep of ${JSON.stringify(LAZY_DEPS)}) {
      if (loaded(dep)) {
        fail(dep + ' was loaded by RUNNING the runtime publish gate on an object write carrying NO json_schema validation');
      }
    }

    // Tier 3 (#4716): the SAME write carrying a json_schema validation must be
    // REFUSED by name, ajv must have loaded to judge it, and the parsers must
    // still be absent. Last, deliberately: after this the cache is dirty.
    const schemaResult = mod.runRuntimeAuthoringRules({
      type: 'object',
      item: ${JSON.stringify(SCHEMA_OBJECT)},
      context: { objects: ${JSON.stringify(OBJECT_CONTEXT)} },
    });
    if (!schemaResult.errors.some((f) => f.rule === 'validation-rule-json-schema-uncompilable')) {
      fail('the gate did not refuse the uncompilable json_schema — either SCHEMA_OBJECT degraded ' +
           'into a schema ajv accepts, or the #4716 widening came back off the object door');
    }
    for (const dep of ${JSON.stringify(PARSER_DEPS)}) {
      if (loaded(dep)) fail(dep + ' was loaded while gating an object write — no written type may reach a source parser');
    }
    for (const dep of ${JSON.stringify(SCHEMA_DEPS)}) {
      if (!loaded(dep)) {
        fail(dep + ' did NOT load while the gate judged a json_schema validation — the tier-2 clean ' +
             'reads above are then unfalsifiable; fix the probe, do not trust the greens');
      }
    }
    console.log('OK');
  };
`;

// Cold-loading a dist entry in a spawned node on a busy runner takes seconds.
const COLD_LOAD_TIMEOUT_MS = 30_000;

describe('@objectstack/lint/runtime (kernel boot-path contract, #4463)', () => {
  it.skipIf(!existsSync(runtimeCjs))(
    'built CJS runtime entry honours the three-tier dep contract, at import AND while gating',
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
    'built ESM runtime entry honours the three-tier dep contract, at import AND while gating',
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

  // #4716 tier 2, in-process: an object write with NO json_schema validation
  // runs all five widened rules — the two ajv-carrying ones included — and
  // loads no compiler. This is the hot path (every ordinary Studio field
  // edit), and it runs BEFORE any schema-carrying probe deliberately: the
  // tier-3 legs are spawned precisely so they can never poison this cache.
  it('gating an object with NO json_schema validation loads no dep, and still finds the defect', async () => {
    const req = createRequire(import.meta.url);
    const { runRuntimeAuthoringRules } = await import('./runtime.js');

    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: PLAIN_OBJECT,
      context: { objects: OBJECT_CONTEXT },
    });
    // Three non-vacuity claims, because this leg can go hollow three ways: no
    // rule gating the type, a dispatch that lost the ajv-carrying rules (a
    // clean read over rules that never ran), or a body no gating rule objects to.
    expect(
      result.rulesRun.length,
      'no registry rule gates an object write — this leg would then prove nothing about the boot path',
    ).toBeGreaterThan(0);
    expect(
      result.rulesRun,
      'the ajv-carrying rule is not dispatched for object writes — the clean read below would then ' +
        'be vacuous (#4716)',
    ).toContain('validateRuleCompilability');
    expect(result.errors.map((f) => f.rule)).toContain('filter-preset-comparand');

    for (const dep of LAZY_DEPS) {
      expect(
        depLoaded(req.cache, dep),
        `${dep} loaded while gating an object write that carries no json_schema validation. The ` +
          `metadata write path is on the kernel boot path: Studio's designer reaches it on every ` +
          `field edit, and a schema-free save may not pay for a compiler — the #4716 adjudication ` +
          `priced the load for schema-CARRYING writes only. Do not relax this; find the eager import`,
      ).toBe(false);
    }
  }, COLD_LOAD_TIMEOUT_MS);

  // #4716 — the probe's own non-vacuity, and the diagnostic that splits the
  // two ways tier 3 can fail.
  //
  // A require-cache walk that reports "clean" proves nothing until it has been
  // shown to report "dirty" for the load it exists to catch. The tier-3 stage
  // of the spawned legs above already demands the load through the GATE; this
  // control demands it from the RULE directly, bypassing the dispatch table.
  // When tier 3 fails "ajv did not load", the two together name the culprit:
  // this control green means the probe sees loads fine and the gate stopped
  // dispatching the rule; this control red means the probe itself (or the
  // fixture's schema) broke, and no clean read in this file can be trusted.
  // Measured: 63 ajv modules + 3 ajv-formats modules, cold ~56 ms vs warm ~11 ms.
  //
  // Spawned, never in-process: this test deliberately loads the deps the
  // tier-2 legs forbid, and the native require cache it writes into is the
  // very one the in-process leg reads.
  it.skipIf(!existsSync(indexCjs) || !existsSync(runtimeCjs))(
    'the schema-carrying body DOES load ajv when the compilability rule judges it directly (probe is not vacuous)',
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
             item: ${JSON.stringify(SCHEMA_OBJECT)},
             context: { objects: ${JSON.stringify(OBJECT_CONTEXT)} },
           });
           if (!snapshots) fail('the gate builds no snapshot for an object write — the tier legs above are then untested');
           const findings = full.validateRuleCompilability(snapshots.candidate);
           if (!findings.some((f) => f.rule === 'validation-rule-json-schema-uncompilable')) {
             fail('SCHEMA_OBJECT no longer carries a schema ajv refuses to compile, so the tier-2 legs ' +
                  'have degraded into "a body with nothing in it loads nothing" and tier 3 refuses ' +
                  'nothing. Restore a schema ajv rejects rather than deleting this test.');
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
