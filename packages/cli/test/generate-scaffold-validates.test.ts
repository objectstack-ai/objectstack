// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#14087, widened by #21325) — what `os generate` writes, the project's
 * own gates accept with ZERO findings: `os validate`, `os build` and `os lint`,
 * errors and warnings alike, for every generator on the roster.
 *
 * ## The defects
 *
 * #14087: the `flow` scaffold emitted a shape `FlowSchema` refuses. Measured
 * on `origin/main` d63c8a2, `os g flow probe_thing` produced four refusals in
 * one parse:
 *
 *   flows[0].nodes[0].label  invalid_type — expected string, received undefined
 *   flows[0].nodes[0]        unrecognized_keys — `name`, `next`
 *   flows[0].edges           invalid_type — expected array, received undefined
 *   flows[0]                 unrecognized_keys — `trigger`
 *
 * #21325: this file then held every scaffold to the ERROR half of
 * `os validate` only, judged beside an object named exactly like the item —
 * and both choices hid what an author met. Measured on a fresh
 * `npm create objectstack` project (namespace `tasks_app`) after
 * `os g object project` / `os g object task`, on `origin/main` 97239c3c8a:
 *
 *   os g flow task_done      exit 0, start node bound to `tasks_app_task_done`
 *                            (derived from the flow's name; no such object) —
 *                            `flow-trigger-unknown-object` and
 *                            `flow-draft-status-ambiguous` warnings
 *   os g view task           `os lint` exit 1: `required/label` at
 *                            views[0].list.label; container `name` / `label`
 *                            each a `liveness-dead-property` warning
 *   os g action complete_task / os g app tasks
 *                            exit 1: object `tasks_app_complete_task` /
 *                            `tasks_app_tasks` and flow `complete_task_flow`
 *                            derived from the name, refused by `defineStack`
 *   os g object …            its `description` field a `field-no-consumers`
 *                            warning as soon as the stack held a consumer
 *   os g action …            (once it could be written) `action-no-placement`
 *
 * So every binding below is resolved the way the command resolves it — from a
 * stack that declares the target, through `stackBindingCandidates` — and the
 * target is deliberately NOT named like the item (`probe_target` vs
 * `probe_thing`): a scaffold that derived its binding from its own name binds
 * an object this stack does not declare, and is red here.
 *
 * ## Why the test loads the scaffold the way `os validate` loads it
 *
 * A scaffold is TypeScript, and `os validate` does not read it as text: it
 * hands the authored source to `bundle-require` (`loadConfig`,
 * `packages/cli/src/utils/config.ts`) and validates the RUNTIME object that
 * comes back. So this file materializes each scaffold through that same
 * loader, with that same `external` list, composes the stack an author's
 * config would build, and runs what the three commands run on it:
 *
 *   load     `defineStack` — the cross-reference and namespace checks a config
 *            meets when it is evaluated (what refused the action and the app)
 *   validate `normalizeStackInput` → the unknown-key lints →
 *            `ObjectStackDefinitionSchema.safeParse` → `runAuthoringRules('validate')`
 *   build    `runAuthoringRules('build')` over the same input
 *   lint     `lintConfig` — the command's own checks (`required/label`, …) plus
 *            its `runAuthoringRules('lint')` pass
 *
 * EVERY severity counts. The author-time rules carry the advisories (a flow
 * that never fires, a dead key, a field nothing reads) and those are exactly
 * the findings #21325 was about, so asserting the error half alone would let
 * the scaffolds keep teaching them.
 *
 * The real commands, on a real fresh project, are the nightly sibling
 * `generate-scaffold-gates.e2e.test.ts`; this file is the per-PR half.
 *
 * ## The roster is derived, and so is each scaffold's stack
 *
 * `GENERATOR_SCAFFOLD_TARGETS` is built from `GENERATORS` itself, the
 * collection each artifact lands in comes from `singularToPlural`, and the
 * prerequisites a binding scaffold needs come from its own `binds` — an object
 * from the `object` generator, a flow from the `flow` generator, each built the
 * same way. Nothing here restates any of it, so a generator added tomorrow is
 * measured by this file on the day it lands.
 *
 * ## The ledger is EMPTY, and shrink-only
 *
 * Running the roster is how it emerged that `flow` was not the only scaffold
 * `os validate` refused when #14087 landed (`object`, `view`, `action`, `app`;
 * commit 79c71d29d repaired all four and emptied the ledger). The two
 * properties it was built with still hold: a kind NOT in the ledger must pass
 * clean, and a kind IN it must still fail, so the ledger cannot outlive the
 * defect it records or grow to cover a regression. ⛔ A red here is a template
 * to fix, never a line to add.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import {
  ObjectStackDefinitionSchema,
  defineStack,
  normalizeStackInput,
  lintUnknownStackKeys,
  lintUnknownAuthoringKeys,
} from '@objectstack/spec';
import { singularToPlural } from '@objectstack/spec/shared';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { runAuthoringRules } from '@objectstack/lint';
import {
  GENERATOR_SCAFFOLD_TARGETS,
  stackBindingCandidates,
  type ScaffoldBindings,
} from '../src/commands/generate.js';
import { lintConfig } from '../src/commands/lint.js';
import { BUNDLE_REQUIRE_EXTERNALS } from '../src/utils/config.js';

/**
 * Scaffolds the gates still refuse, with the measured reason. SHRINK-ONLY —
 * see the header. EMPTY since commit 79c71d29d; keep it that way.
 */
const KNOWN_UNVALIDATED_SCAFFOLDS: Record<string, string> = {};

/** The namespace the host stack declares, so every object name is judged against a prefix. */
const NS = 'scaffold';
/** The name `os g <type> <name>` is invoked with for the item under test. */
const ITEM = 'probe_thing';
/**
 * The stems the prerequisites are generated under. Deliberately not `ITEM`:
 * the defect was a binding derived from the item's own name.
 */
const PREREQUISITE_STEM: Record<string, string> = { object: 'probe_target', flow: 'probe_target_changed' };

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

const target = (type: string) => {
  const found = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type);
  if (!found) throw new Error(`no '${type}' generator in the roster`);
  return found;
};

let fileSeq = 0;

/** Materialize one scaffold through the loader `os validate` uses (see the header). */
async function loadScaffold(type: string, source: string): Promise<Record<string, unknown>> {
  const file = path.join(TMP_ROOT, `${type}-${fileSeq++}.scaffold.ts`);
  fs.writeFileSync(file, source, 'utf8');
  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  return ((mod as { default?: unknown }).default ?? mod) as Record<string, unknown>;
}

/** A project's stack: a namespaced manifest, the scaffolds' collections, the union of what they require. */
interface Project {
  items: { type: string; artifact: Record<string, unknown> }[];
}

function stackOf(project: Project): Record<string, unknown> {
  const stack: Record<string, unknown> = {
    // `engines.protocol` as every scaffolded config declares it: `os lint`
    // reports a manifest without one, and that finding is the host's.
    manifest: {
      id: 'com.example.scaffold',
      name: 'scaffold',
      version: '1.0.0',
      type: 'app',
      namespace: NS,
      engines: { protocol: `^${PROTOCOL_MAJOR}` },
    },
  };
  const requires = new Set<string>();
  for (const { type, artifact } of project.items) {
    const key = singularToPlural(type);
    stack[key] = [...((stack[key] as unknown[] | undefined) ?? []), artifact];
    for (const token of target(type).requires) requires.add(token);
  }
  if (requires.size > 0) stack.requires = [...requires];
  return stack;
}

/**
 * Generate `type` into `project` the way the command does: each reference its
 * `binds` declares is first generated into the project (once), then resolved
 * off the project's stack through `stackBindingCandidates` — the reader the
 * command uses — and handed to `generate`. A view is named after its object.
 */
async function generateInto(project: Project, type: string, name: string): Promise<Record<string, unknown>> {
  const t = target(type);
  const bindings: ScaffoldBindings = {};
  for (const key of ['object', 'flow'] as const) {
    if (!t.binds[key]) continue;
    const prerequisite = target(key);
    const stem = PREREQUISITE_STEM[key];
    const wanted = prerequisite.itemName(stem, NS);
    const candidates = () => stackBindingCandidates(stackOf(project));
    const present = () =>
      key === 'object'
        ? candidates().objects.some((o) => o.name === wanted)
        : candidates().flows.includes(wanted);
    if (!present()) await generateInto(project, key, stem);
    if (key === 'object') bindings.object = candidates().objects.find((o) => o.name === wanted);
    else bindings.flow = candidates().flows.find((f) => f === wanted);
    expect(bindings[key], `the ${key} prerequisite of \`os g ${type}\` must resolve`).toBeDefined();
  }
  const itemName = t.binds.object === 'name' ? PREREQUISITE_STEM.object : name;
  const artifact = await loadScaffold(type, t.generate(itemName, NS, bindings));
  project.items.push({ type, artifact });
  return artifact;
}

/** One fresh project holding `type`'s scaffold and its prerequisites. */
async function projectWith(type: string): Promise<{ stack: Record<string, unknown>; artifact: Record<string, unknown> }> {
  const project: Project = { items: [] };
  const artifact = await generateInto(project, type, ITEM);
  return { stack: stackOf(project), artifact };
}

/** Everything the three commands would report for `stack`, every severity, one line each. */
function findings(stack: Record<string, unknown>): string[] {
  const out: string[] = [];
  try {
    defineStack(stack as Parameters<typeof defineStack>[0]);
  } catch (error) {
    out.push(`load: ${(error as Error).message}`);
    return out;
  }

  const normalized = normalizeStackInput(stack) as Record<string, unknown>;
  for (const k of [
    ...lintUnknownStackKeys(normalized, ObjectStackDefinitionSchema),
    ...lintUnknownAuthoringKeys(normalized, ObjectStackDefinitionSchema),
  ]) out.push(`validate: unknown-key ${JSON.stringify(k)}`);

  const parsed = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!parsed.success) {
    for (const i of parsed.error.issues) out.push(`validate: ${i.path.join('.') || '(root)'}: ${i.message}`);
    return out;
  }
  const run = { normalized, parsed: parsed.data as Record<string, unknown> };
  for (const command of ['validate', 'build'] as const) {
    for (const f of runAuthoringRules(command, run)) out.push(`${command}: ${f.severity} ${f.rule} at ${f.path}: ${f.message}`);
  }
  for (const issue of lintConfig(normalized)) {
    out.push(`lint: ${issue.severity} ${issue.rule} at ${issue.path}: ${issue.message}`);
  }
  return out;
}

describe('[#14087 / #21325] every `os generate` scaffold passes `os validate`, `os build` and `os lint` with zero findings', () => {
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

  it("`flow` is not in the ledger — #14087's own defect cannot be re-admitted", () => {
    expect(Object.keys(KNOWN_UNVALIDATED_SCAFFOLDS)).not.toContain('flow');
  });

  it('every reference a scaffold binds names a roster generator, so its prerequisite can be built', () => {
    for (const t of GENERATOR_SCAFFOLD_TARGETS) {
      for (const key of Object.keys(t.binds)) {
        expect(PREREQUISITE_STEM[key], `\`os g ${t.type}\` binds a '${key}': give it a prerequisite stem here`).toBeDefined();
        expect(() => target(key)).not.toThrow();
      }
    }
  });

  const clean = GENERATOR_SCAFFOLD_TARGETS.filter((t) => !(t.type in KNOWN_UNVALIDATED_SCAFFOLDS));
  const known = GENERATOR_SCAFFOLD_TARGETS.filter((t) => t.type in KNOWN_UNVALIDATED_SCAFFOLDS);

  it.each(clean)('`os g $type` adds no finding at any severity, beside what it binds', async (t) => {
    const { stack } = await projectWith(t.type);
    expect(findings(stack), `the gates report the ${t.type} scaffold`).toEqual([]);
  });

  it.each(known)(
    '`os g $type` is still refused — delete its ledger entry when you fix it',
    async (t) => {
      const { stack } = await projectWith(t.type);
      expect(
        findings(stack),
        `the ${t.type} scaffold now passes clean. Delete its KNOWN_UNVALIDATED_SCAFFOLDS entry in the same PR that fixed it.`,
      ).not.toEqual([]);
    },
  );
});

describe('[#21325] a binding scaffold binds what it was handed, never what its own name suggests', () => {
  const binding = GENERATOR_SCAFFOLD_TARGETS.filter((t) => t.binds.object === 'flag');

  it('there are binding scaffolds to measure', () => {
    expect(binding.map((t) => t.type)).toEqual(expect.arrayContaining(['action', 'flow', 'app']));
  });

  it.each(binding)('`os g $type probe_thing` writes the bound object and nowhere names `probe_thing` as one', async (t) => {
    const { artifact } = await projectWith(t.type);
    const text = JSON.stringify(artifact);
    const bound = target('object').itemName(PREREQUISITE_STEM.object, NS);
    expect(text).toContain(`"${bound}"`);
    // The object the removed derivation would have bound: the item's own
    // name, namespace-prefixed.
    expect(text).not.toContain(`"${NS}_${ITEM}"`);
  });

  it('rendering a binding scaffold without its binding throws instead of inventing one', () => {
    for (const t of GENERATOR_SCAFFOLD_TARGETS.filter((g) => Object.keys(g.binds).length > 0)) {
      expect(() => t.generate(ITEM, NS), `\`os g ${t.type}\` rendered with no binding`).toThrow(/binds a/);
    }
  });
});

describe('[#14087] the flow scaffold binds its trigger where the engine reads it', () => {
  it('declares the binding on the START node config, not at the flow top level', async () => {
    const flow = (await projectWith('flow')).artifact as {
      trigger?: unknown;
      object?: unknown;
      status?: unknown;
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
    expect(start!.config?.objectName).toBe(target('object').itemName(PREREQUISITE_STEM.object, NS));
    expect(String(start!.config?.triggerType)).toMatch(
      /^record-(?:before|after)-(?:create|insert|update|delete|write)$/,
    );

    // Every node labelled, and the graph declared — the other three refusals.
    for (const node of flow.nodes) expect(typeof node.label).toBe('string');
    expect(Array.isArray(flow.edges)).toBe(true);
    expect(flow.edges.length).toBeGreaterThan(0);
  });
});
