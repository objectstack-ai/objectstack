// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#20197) — in a namespaced project, what `os generate` writes names its
 * object the way the namespace-prefix gate demands, and the generated SET
 * passes `defineStack` as a whole.
 *
 * ## The defect
 *
 * `os init my-app -t app` writes `manifest.namespace: 'my_app'`, and then
 * `os g object order_line` wrote `name: 'order_line'`. `defineStack` refused
 * it on the next `os validate` (exit 1) and `os compile` (exit 2):
 *
 *   Object 'order_line' is missing the package namespace prefix. Rename it to
 *   'my_app_order_line' (namespace = 'my_app').
 *
 * ## Which names the gate judges (the census this file pins)
 *
 * Measured by generating every type into an `os init -t app` project, wiring
 * every barrel into `defineStack` and running `os validate`:
 *
 *   object  `name`                  REFUSED unprefixed (namespace-prefix gate)
 *   action  `objectName`            REFUSED once the object is prefixed (cross-reference)
 *   app     nav `objectName`        REFUSED once the object is prefixed (cross-reference)
 *   flow    start `objectName`      advisory `flow-trigger-unknown-object`: the flow never fires
 *   view    `object`                no finding at all: a binding to nothing, silently
 *
 * No `os validate` gate judges a view's, action's, flow's, dashboard's, app's
 * or skill's OWN `name` against the namespace. So those stay as typed, and
 * every OBJECT name gains the prefix through one derivation (`objectNameFor`).
 *
 * One exception the census above could not see, because it stops at
 * `os validate` (#20215): the RUNTIME registers a views container under the
 * object it binds to and refuses, at boot, one whose own `name` disagrees.
 * Since #21325 the container writes no `name` at all — its registered key is
 * its `object` — so that exception is read through `registeredItemName`.
 *
 * ## Where the bound object comes from (#21325)
 *
 * A `view`, `action`, `flow` or `app` scaffold no longer derives the object it
 * binds from its own name: the command resolves it against the project's
 * stack and hands it to `generate`. So the SET below is composed the way an
 * author builds it — the object first, then each binding scaffold handed that
 * object (and the action the flow), resolved through `stackBindingCandidates`,
 * the reader the command uses. The prefix then reaches every binding through
 * the one place it is applied: the object scaffold's own `name`.
 *
 * ## Why `defineStack` and not the per-artifact parse
 *
 * `generate-scaffold-validates.test.ts` runs each scaffold ALONE through the
 * schema and the author-time rules. Both refusals above live in `defineStack`,
 * the call the config module makes when `os validate` loads it, and both are
 * about the SET: a prefix judged against the manifest, a reference judged
 * against the objects beside it. So this file materializes every scaffold,
 * composes them into one namespaced stack and hands that to `defineStack`
 * itself. The control case below shows the same harness refusing the pre-fix
 * output, so its green is not vacuous.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import {
  defineStack,
  ObjectStackDefinitionSchema,
  normalizeStackInput,
} from '@objectstack/spec';
import { singularToPlural } from '@objectstack/spec/shared';
import { runAuthoringRules, splitBySeverity, FLOW_TRIGGER_UNKNOWN_OBJECT } from '@objectstack/lint';
import { GENERATOR_SCAFFOLD_TARGETS, stackBindingCandidates, type ScaffoldBindings } from '../src/commands/generate.js';
import { registeredItemName } from '../src/utils/scaffold-wiring.js';
import { probeBindings } from './helpers/scaffold-bindings.js';
import { BUNDLE_REQUIRE_EXTERNALS } from '../src/utils/config.js';
import { readProjectNamespace } from '../src/utils/project-namespace.js';

/** The namespace `os init my-app` writes, and the name the card reproduced with. */
const NS = 'my_app';
const STEM = 'order_line';
const PREFIXED = `${NS}_${STEM}`;

/**
 * Inside the package's own `node_modules`, for the reason
 * `generate-scaffold-validates.test.ts` gives: git-ignored, and a scaffold's
 * `@objectstack/spec` import resolves from here.
 */
const TMP_ROOT = fs.mkdtempSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', '.scaffold-namespace-'),
);

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

let fileSeq = 0;

/** Load one scaffold the way `os validate` loads authored TypeScript. */
async function materialize(type: string, source: string): Promise<Record<string, unknown>> {
  const file = path.join(TMP_ROOT, `${type}-${fileSeq++}.scaffold.ts`);
  fs.writeFileSync(file, source, 'utf8');
  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  return ((mod as { default?: unknown }).default ?? mod) as Record<string, unknown>;
}

/**
 * Every generator's scaffold for `name`, keyed by type, composed the way an
 * author builds the set (#21325): the object first, then the flow bound to it,
 * then every other scaffold, each binding resolved off the set so far.
 */
async function generateAll(name: string, namespace?: string): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {};
  const order = ['object', 'flow', ...GENERATOR_SCAFFOLD_TARGETS.map((t) => t.type).filter((t) => t !== 'object' && t !== 'flow')];
  for (const type of order) {
    const target = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type)!;
    const { objects, flows } = stackBindingCandidates({
      objects: out.object ? [out.object] : [],
      flows: out.flow ? [out.flow] : [],
    });
    const bindings: ScaffoldBindings | undefined = Object.keys(target.binds).length === 0 ? undefined : {
      ...(target.binds.object ? { object: objects[0] } : {}),
      ...(target.binds.flow ? { flow: flows[0] } : {}),
    };
    out[type] = await materialize(type, target.generate(name, namespace, bindings));
  }
  return out;
}

/**
 * One stack holding every scaffold, under `manifest.namespace` when given.
 *
 * `requires: ['automation', 'triggers']` is the HOST's declaration, not the
 * scaffold's: the flow scaffold is a `record_change` flow, and `defineStack`
 * refuses such a flow in a stack that does not require the pair that installs
 * its trigger (#20332). That refusal is about the host's capability list and
 * has nothing to do with names.
 */
function composedStack(artifacts: Record<string, Record<string, unknown>>, namespace?: string) {
  const stack: Record<string, unknown> = {
    manifest: {
      id: 'com.example.my-app',
      name: 'my_app',
      version: '1.0.0',
      type: 'app',
      ...(namespace ? { namespace } : {}),
    },
    requires: ['automation', 'triggers'],
  };
  for (const [type, artifact] of Object.entries(artifacts)) {
    stack[singularToPlural(type)] = [artifact];
  }
  return stack;
}

/** `defineStack`'s refusal, as its ADR-0112 envelope, or `null` when it accepts. */
function defineStackRefusal(stack: Record<string, unknown>): { code: unknown; status: unknown; message: string } | null {
  try {
    defineStack(stack as Parameters<typeof defineStack>[0]);
    return null;
  } catch (error) {
    const e = error as { code?: unknown; status?: unknown; message?: string };
    return { code: e.code, status: e.status, message: String(e.message) };
  }
}

/** The author-time findings `os validate` would add after the stack loaded. */
function authoringFindings(stack: Record<string, unknown>) {
  const normalized = normalizeStackInput(stack) as Record<string, unknown>;
  const parsed = ObjectStackDefinitionSchema.safeParse(normalized);
  expect(parsed.success, 'the composed stack must parse').toBe(true);
  const findings = runAuthoringRules('validate', {
    normalized,
    parsed: (parsed as { data: Record<string, unknown> }).data,
  });
  return { findings, ...splitBySeverity(findings) };
}

/** The object name each object-naming scaffold writes, read off the artifact. */
function objectNamesWritten(a: Record<string, Record<string, unknown>>) {
  const flowStart = (a.flow.nodes as { type: string; config?: Record<string, unknown> }[])
    .find((n) => n.type === 'start');
  const nav = (a.app.navigation as { objectName?: unknown }[])[0];
  return {
    'object.name': a.object.name,
    'view.object': a.view.object,
    'view (its registered key)': registeredItemName('views', a.view),
    'action.objectName': a.action.objectName,
    'flow start.config.objectName': flowStart?.config?.objectName,
    'app navigation[0].objectName': nav?.objectName,
  };
}

describe('[#20197] `namesObject` is what each template actually does', () => {
  it('has generators to measure at all', () => {
    expect(GENERATOR_SCAFFOLD_TARGETS.length).toBeGreaterThan(0);
  });

  // `runMetadataGeneration` reads the manifest only for a generator that
  // declares `namesObject`, so a template that writes an object name without
  // the flag would silently lose the prefix again. Derived from the output,
  // never from a list: a generator added tomorrow is measured the day it lands.
  const unbound = GENERATOR_SCAFFOLD_TARGETS.filter((t) => Object.keys(t.binds).length === 0);
  const bound = GENERATOR_SCAFFOLD_TARGETS.filter((t) => t.binds.object !== undefined);

  it.each(unbound.map((t) => [t.type, t] as const))(
    '`os g %s` declares namesObject exactly when its output depends on the namespace',
    (_type, target) => {
      const dependsOnNamespace = target.generate(STEM, NS) !== target.generate(STEM);
      expect(target.namesObject).toBe(dependsOnNamespace);
    },
  );

  // [#21325] A binding scaffold's object is resolved against the namespace by
  // the COMMAND, before rendering, so it must declare `namesObject` — and the
  // template must write exactly the object it was handed, the namespace
  // changing nothing: a template that re-derived the object would differ here.
  it.each(bound.map((t) => [t.type, t] as const))(
    '`os g %s` binds an object: it declares namesObject, and writes the object it is handed',
    (_type, target) => {
      expect(target.namesObject).toBe(true);
      const bindings = probeBindings(target);
      expect(target.generate(STEM, NS, bindings)).toBe(target.generate(STEM, undefined, bindings));
    },
  );
});

describe('[#20197] under a manifest namespace, the generated set passes the gate', () => {
  it('prefixes every object name, and only object names', async () => {
    const a = await generateAll(STEM, NS);
    expect(objectNamesWritten(a)).toEqual({
      'object.name': PREFIXED,
      'view.object': PREFIXED,
      'action.objectName': PREFIXED,
      'flow start.config.objectName': PREFIXED,
      'app navigation[0].objectName': PREFIXED,
      // [#20215] A views container is registered under the object it binds
      // to; since #21325 it writes no `name`, so its key is its `object`.
      'view (its registered key)': PREFIXED,
    });
    // The census: no gate judges these against the namespace, so they are
    // written exactly as they were before this change.
    expect({
      action: a.action.name,
      'action target (a flow)': a.action.target,
      flow: a.flow.name,
      dashboard: a.dashboard.name,
      app: a.app.name,
      skill: a.skill.name,
    }).toEqual({
      action: STEM,
      'action target (a flow)': `${STEM}_flow`,
      flow: `${STEM}_flow`,
      dashboard: `${STEM}_dashboard`,
      app: `${STEM}_app`,
      skill: STEM,
    });
  });

  it('`defineStack` accepts the whole set, and `os validate` adds no error', async () => {
    const stack = composedStack(await generateAll(STEM, NS), NS);
    expect(defineStackRefusal(stack)).toBeNull();

    const { errors, findings } = authoringFindings(stack);
    expect(errors).toEqual([]);
    // The flow's trigger binding resolves, so the advisory that says the flow
    // would never fire is absent.
    expect(findings.filter((f) => f.rule === FLOW_TRIGGER_UNKNOWN_OBJECT)).toEqual([]);
  });

  it('control: the same harness refuses the pre-fix output, by code and status', async () => {
    // What every generator wrote before this change: no namespace applied.
    const stack = composedStack(await generateAll(STEM), NS);
    const refusal = defineStackRefusal(stack);
    expect(refusal).not.toBeNull();
    expect(refusal!.code).toBe('STACK_NAMESPACE_PREFIX_INVALID');
    expect(refusal!.status).toBe(422);
  });
});

describe('[#20197] the name cases around the prefix', () => {
  it('a project with no namespace gets no prefix, and its set passes too', async () => {
    const a = await generateAll(STEM);
    expect(Object.values(objectNamesWritten(a))).toEqual(Array(6).fill(STEM));
    expect(defineStackRefusal(composedStack(a))).toBeNull();
  });

  it('a name that already carries the prefix is used as written, never doubled', async () => {
    const a = await generateAll(PREFIXED, NS);
    expect(Object.values(objectNamesWritten(a))).toEqual(Array(6).fill(PREFIXED));
    expect(defineStackRefusal(composedStack(a, NS))).toBeNull();
  });

  // The two cases the gate's own verdict decides, read off the object
  // template's output rather than re-derived here.
  const objectTemplate = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === 'object')!;

  it('a platform-reserved `sys_*` name is exempt from the gate, so it is not prefixed', () => {
    expect(objectTemplate.generate('sys_probe', NS)).toContain("name: 'sys_probe',");
  });

  it('a name equal to the namespace is prefixed: `my_app` has no `my_app_` prefix', () => {
    expect(objectTemplate.generate(NS, NS)).toContain(`name: '${NS}_${NS}',`);
  });
});

describe('[#20197] the namespace is read from the loaded config, the gate\'s own source', () => {
  /** A project directory holding one config file, under TMP_ROOT. */
  function project(dirName: string, config: string | null): string {
    const dir = path.join(TMP_ROOT, dirName);
    fs.mkdirSync(dir, { recursive: true });
    if (config !== null) fs.writeFileSync(path.join(dir, 'objectstack.config.ts'), config, 'utf8');
    return dir;
  }

  const manifest = (namespace: string | null) => `{
    id: 'com.example.my-app',
    name: 'my_app',
    version: '1.0.0',
    type: 'app',${namespace ? `\n    namespace: '${namespace}',` : ''}
  }`;

  it('no config file: nothing to read, which is not an error', async () => {
    expect(await readProjectNamespace(project('no-config', null))).toEqual({ kind: 'no-config' });
  });

  it('a config declaring a namespace answers that namespace', async () => {
    const dir = project('with-namespace', `import { defineStack } from '@objectstack/spec';
export default defineStack({ manifest: ${manifest(NS)} });
`);
    const read = await readProjectNamespace(dir);
    expect(read).toMatchObject({ kind: 'loaded', namespace: NS });
  });

  it('a config declaring none answers undefined: the gate owes no prefix', async () => {
    const dir = project('without-namespace', `import { defineStack } from '@objectstack/spec';
export default defineStack({ manifest: ${manifest(null)} });
`);
    const read = await readProjectNamespace(dir);
    expect(read).toMatchObject({ kind: 'loaded', namespace: undefined });
  });

  it('a config that does not load is reported as such, never read as "no namespace"', async () => {
    // What a project generated before this fix looks like: the unprefixed
    // object makes `defineStack` throw while the config module evaluates.
    const dir = project('does-not-load', `import { defineStack } from '@objectstack/spec';
export default defineStack({
  manifest: ${manifest(NS)},
  objects: [{ name: '${STEM}', label: 'Order Line', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } }],
});
`);
    const read = await readProjectNamespace(dir);
    expect(read.kind).toBe('load-failed');
    // The named subject, not the prose: the failure is about THIS object.
    expect((read as { message: string }).message).toContain(`'${STEM}'`);
  });
});
