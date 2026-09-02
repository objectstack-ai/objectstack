// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#14087) — what `os generate` writes, `os validate` accepts.
 *
 * ## The defect
 *
 * The `flow` scaffold emitted a shape `FlowSchema` refuses. Measured on
 * `origin/main` d63c8a2, `os g flow probe_thing` produced four refusals in one
 * parse:
 *
 *   flows[0].nodes[0].label  invalid_type — expected string, received undefined
 *   flows[0].nodes[0]        unrecognized_keys — `name`, `next`
 *   flows[0].edges           invalid_type — expected array, received undefined
 *   flows[0]                 unrecognized_keys — `trigger`
 *
 * A record-change flow binds its trigger on the START node's `config`
 * (`{ objectName, triggerType, condition }`) — the same place
 * `AutomationEngine.resolveTriggerBinding` reads it from. There is no
 * top-level `trigger` key and never was one on protocol 17. So a newcomer's
 * FIRST flow was a file their own toolchain refused.
 *
 * ## Why the test loads the scaffold the way `os validate` loads it
 *
 * A scaffold is TypeScript, and `os validate` does not read it as text: it
 * hands the authored source to `bundle-require` (`loadConfig`,
 * `packages/cli/src/utils/config.ts`) and validates the RUNTIME object that
 * comes back. So this file materializes each scaffold through that same
 * loader, with that same `external` list, and then re-runs the two steps
 * `Validate.run()` performs on the result:
 *
 *   step 2 — `normalizeStackInput` → the unknown-key lints → `ObjectStackDefinitionSchema.safeParse`
 *   step 3 — `runAuthoringRules('validate')`, gating on the error-severity half
 *
 * Both steps are load-bearing, and step 3 is the half a schema-only assertion
 * would miss. A flow node's `config` is an OPEN slot by design (ADR-0018), so
 * `FlowSchema` cannot judge the trigger vocabulary at all: a start node
 * carrying `triggerType: 'record_change'` (the engine routes only `record-*`)
 * parses green and is caught one layer later, by
 * `validate-flow-trigger-readiness`. Asserting the schema alone would let the
 * scaffold's own trigger token drift back to a spelling that never fires.
 *
 * ## The roster is derived, and so is each artifact's stack slot
 *
 * `GENERATOR_SCAFFOLD_TARGETS` is built from `GENERATORS` itself, and the
 * collection each artifact lands in comes from `singularToPlural` — the map
 * `defineStack` and the metadata registry already share. Nothing here restates
 * either, so a generator added tomorrow is measured by this file on the day it
 * lands rather than the day someone remembers to extend a hand-kept list.
 *
 * ## The ledger, and why this card did not empty it
 *
 * Running the roster is how it emerged that `flow` is not the only scaffold
 * `os validate` refuses. Measured on the same commit, same harness:
 *
 *   object     parses, then FAILS the author-time rules — `security-owd-unset`
 *   view       `views[0].list.pageSize`, and `type` / `objectName` on the container
 *   action     `type: 'custom'` is not an Action type; `handler` is not an Action key
 *   app        `navigation` takes an array, the scaffold writes an object
 *   dashboard  clean
 *   skill      clean
 *
 * Those four are a separate card by triage's own fence — a census of the other
 * artifacts is explicitly NOT folded into #14087 — so this file RECORDS them
 * instead of fixing them, in the shrink-only shape this repo uses elsewhere
 * (`KNOWN_UNALIASED_TEST_IMPORTS`, the type-check debt ledger). Two properties
 * follow, and both are asserted below:
 *
 *   - a kind NOT in the ledger must validate clean. That is the pin.
 *   - a kind IN the ledger must still FAIL. So whoever repairs one of them
 *     turns this file red and deletes its entry in the same PR; the ledger
 *     cannot quietly outlive the defect it records, and it can never grow to
 *     cover a regression (a newly-broken kind is not in it, so it just fails).
 *
 * `flow` is additionally asserted to be absent from the ledger, so this card's
 * own defect cannot be re-admitted by adding a line to a table.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import {
  ObjectStackDefinitionSchema,
  normalizeStackInput,
  lintUnknownStackKeys,
  lintUnknownAuthoringKeys,
} from '@objectstack/spec';
import { singularToPlural } from '@objectstack/spec/shared';
import { runAuthoringRules, splitBySeverity } from '@objectstack/lint';
import { GENERATOR_SCAFFOLD_TARGETS } from '../src/commands/generate.js';
import { BUNDLE_REQUIRE_EXTERNALS } from '../src/utils/config.js';

/**
 * Scaffolds `os validate` still refuses, with the measured reason. SHRINK-ONLY
 * — see the header. Adding an entry to silence a failure is the one edit this
 * table must never receive; the assertions below make a stale entry fail too.
 */
const KNOWN_UNVALIDATED_SCAFFOLDS: Record<string, string> = {
  object:
    'parses, then fails the author-time rules: `security-owd-unset` (no sharingModel authored).',
  view:
    'unrecognized `pageSize` on the list view, and `type` / `objectName` on the view container.',
  action:
    "`type: 'custom'` is not an Action type, and `handler` is not an Action key.",
  app:
    '`navigation` takes an array of nav items; the scaffold writes a `{ type, items }` object.',
};

/** The name `os g <type> <name>` is invoked with throughout this file. */
const STEM = 'probe_thing';

/**
 * Where materialized scaffolds are written.
 *
 * Inside the package's own `node_modules` on purpose, and both halves matter:
 * it is git-ignored (a materialized scaffold is a build artifact, not a
 * fixture), and it sits under `packages/cli`, so a scaffold's own
 * `import … from '@objectstack/spec/…'` resolves from there exactly as it
 * would for a file the author had scaffolded into this package — which is the
 * resolution `bundle-require` performs for any specifier kept `external`.
 */
const TMP_ROOT = fs.mkdtempSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.scaffold-validate-'),
);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** A legal, minimal host stack. Only the collection under test is populated. */
const hostStack = (collection: string, artifact: unknown) => ({
  manifest: {
    id: 'com.example.scaffold',
    name: 'scaffold',
    version: '1.0.0',
    type: 'app' as const,
    namespace: 'scaffold',
  },
  [collection]: [artifact],
});

/**
 * Load a scaffold the way `os validate` loads authored TypeScript, then run
 * the two steps `Validate.run()` runs on it.
 */
async function validateScaffold(type: string, source: string) {
  const file = path.join(TMP_ROOT, `${type}.scaffold.ts`);
  fs.writeFileSync(file, source, 'utf8');

  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  const artifact = (mod as { default?: unknown }).default ?? mod;

  const normalized = normalizeStackInput(
    hostStack(singularToPlural(type), artifact) as Record<string, unknown>,
  ) as Record<string, unknown>;

  const unknownKeys = [
    ...lintUnknownStackKeys(normalized, ObjectStackDefinitionSchema),
    ...lintUnknownAuthoringKeys(normalized, ObjectStackDefinitionSchema),
  ];
  const parsed = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!parsed.success) {
    return { artifact, unknownKeys, parsed, ruleErrors: null, advisories: null };
  }

  const findings = runAuthoringRules('validate', {
    normalized,
    parsed: parsed.data as Record<string, unknown>,
  });
  const { errors, advisories } = splitBySeverity(findings);
  return { artifact, unknownKeys, parsed, ruleErrors: errors, advisories };
}

/** Everything `os validate` would refuse this artifact for, as one string. */
const refusals = (r: Awaited<ReturnType<typeof validateScaffold>>): string[] => [
  ...r.unknownKeys.map((k) => `unknown-key ${JSON.stringify(k)}`),
  ...(r.parsed.success
    ? []
    : r.parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)),
  ...(r.ruleErrors ?? []).map((f) => `${f.rule} at ${f.path}: ${f.message}`),
];

describe('[#14087] every `os generate` scaffold passes `os validate`', () => {
  it('has generators to measure at all', () => {
    // Guards every `it.each` below against silently iterating nothing if the
    // export ever stops being derived from `GENERATORS`.
    expect(GENERATOR_SCAFFOLD_TARGETS.length).toBeGreaterThan(0);
  });

  it('the ledger names only real generator types', () => {
    const roster = new Set(GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type));
    for (const type of Object.keys(KNOWN_UNVALIDATED_SCAFFOLDS)) {
      expect(roster.has(type), `ledger entry '${type}' is not a generator type`).toBe(true);
    }
  });

  it("`flow` is not in the ledger — this card's own defect cannot be re-admitted", () => {
    expect(Object.keys(KNOWN_UNVALIDATED_SCAFFOLDS)).not.toContain('flow');
  });

  const clean = GENERATOR_SCAFFOLD_TARGETS.filter((t) => !(t.type in KNOWN_UNVALIDATED_SCAFFOLDS));
  const known = GENERATOR_SCAFFOLD_TARGETS.filter((t) => t.type in KNOWN_UNVALIDATED_SCAFFOLDS);

  it.each(clean)('`os g $type` writes a stack `os validate` accepts', async (target) => {
    const result = await validateScaffold(target.type, target.generate(STEM));
    expect(refusals(result), `os validate refuses the ${target.type} scaffold`).toEqual([]);
  });

  it.each(clean)('`os g $type` writes no key any layer drops silently', async (target) => {
    // The pre-parse lint, run for the reason `validate.ts` runs it there: the
    // parse is what strips an undeclared key, so a surface that is not
    // `.strict()` reports here and nowhere else.
    const result = await validateScaffold(target.type, target.generate(STEM));
    expect(result.unknownKeys).toEqual([]);
  });

  it.each(known)(
    '`os g $type` is still refused — delete its ledger entry when you fix it',
    async (target) => {
      const result = await validateScaffold(target.type, target.generate(STEM));
      expect(
        refusals(result),
        `the ${target.type} scaffold now validates clean. Delete its ` +
          `KNOWN_UNVALIDATED_SCAFFOLDS entry in the same PR that fixed it.`,
      ).not.toEqual([]);
    },
  );
});

describe('[#14087] the flow scaffold binds its trigger where the engine reads it', () => {
  it('declares the binding on the START node config, not at the flow top level', async () => {
    const target = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'flow');
    expect(target, 'the flow generator must exist').toBeDefined();

    const flow = (await validateScaffold('flow', target!.generate(STEM))).artifact as {
      trigger?: unknown;
      object?: unknown;
      nodes: { id: string; type: string; label?: string; config?: Record<string, unknown> }[];
      edges: unknown[];
    };

    // The two keys the refusal named. Asserted on the artifact rather than
    // inferred from the parse, because `.strict()` only fails while nothing
    // ELSE about the flow changes — this says the keys are gone for good.
    expect(flow.trigger).toBeUndefined();
    expect(flow.object).toBeUndefined();

    const start = flow.nodes.find((n) => n.type === 'start');
    expect(start, 'a record-change flow needs a START node to bind on').toBeDefined();
    // `resolveTriggerBinding` claims a record-change flow only for a token
    // starting with `record-`, and `validate-flow-trigger-readiness` gates the
    // grammar; both read exactly these two keys off `start.config`.
    expect(start!.config?.objectName).toBe(STEM);
    expect(String(start!.config?.triggerType)).toMatch(
      /^record-(?:before|after)-(?:create|insert|update|delete|write)$/,
    );

    // Every node labelled, and the graph declared — the other three refusals.
    for (const node of flow.nodes) expect(typeof node.label).toBe('string');
    expect(Array.isArray(flow.edges)).toBe(true);
    expect(flow.edges.length).toBeGreaterThan(0);
  });
});
