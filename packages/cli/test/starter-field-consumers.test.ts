// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#21370) — no starter ships a latent `field-no-consumers` warning. Every
 * object a fresh project starts with stays silent under `os validate` and
 * `os lint` once the project holds a dashboard, a view or a flow, and the
 * silence comes from the starter's field groups, not from a rule that never ran.
 *
 * ## The defect, measured through the real commands
 *
 * On `origin/main` 69a12a0952, each starter followed by ONE of
 * `os g dashboard probe`, `os g object gate_target` + `os g view gate_target`,
 * or `os g object gate_target` + `os g flow gate_probe --object gate_target`:
 *
 *   npm create objectstack   `os validate` and `os lint` exit 0 with one
 *                            `field-no-consumers` warning: the starter note's
 *                            `body`
 *   os init -t app           the same, with two: the item's `description` and
 *                            `status`
 *   os init -t plugin        clean: its one field is the record's title
 *
 * Every bare starter reports nothing. The rule stays silent while a stack holds
 * no consumer root (a stack of objects is judged to be another stack's object
 * library), so the author's first view, flow, dashboard or anything else that
 * could read a field woke a warning about a field the author never wrote.
 *
 * ## The fix this pins
 *
 * Each starter object places the fields it declares in a keyed field group:
 * `fieldGroups` on the object and `group` on each field (ADR-0085 §5). The
 * rule credits a field the synthesized layout places in a KEYED section as
 * displayed (`@objectstack/lint`'s `validate-field-consumers` module header,
 * "The synthesized layout"), because that section is what the form, detail
 * and drawer surfaces draw. The rule itself is unchanged: a starter is a
 * stack like any other.
 *
 * ## Every non-title field is its own control
 *
 * A zero proves nothing by itself, because a pipeline that failed before the
 * rule ran reads zero too. So every leg first requires its stack to load
 * (`defineStack`) and parse, and every non-title starter field is a control:
 * with its `group` removed, the same pipeline reports `field-no-consumers` at
 * exactly that field, under both commands. The title field is no control. The
 * rule exempts it through the platform's `nameField` ladder
 * (`resolveDisplayField`), which this file reads rather than restates.
 *
 * ## The roster is derived
 *
 * The starters are every `*.object.ts` the blank starter ships and every
 * `*.object.ts` an `os init` template renders (`TEMPLATES`), so a starter
 * object added later is measured the day it lands. The wakers are the real
 * generators' output (`GENERATOR_SCAFFOLD_TARGETS`), bound the way the
 * command binds them (`stackBindingCandidates`). Every source is loaded the way
 * `os validate` loads authored TypeScript (`bundle-require` with
 * `BUNDLE_REQUIRE_EXTERNALS`), and the findings come from what the two commands
 * run: `runAuthoringRules('validate')` over the parsed stack, and `lintConfig`.
 *
 * The real commands on real projects are the nightly sibling
 * `starter-field-consumers.e2e.test.ts`. This file is the per-PR half.
 */

import { afterAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleRequire } from 'bundle-require';
import { ObjectStackDefinitionSchema, defineStack, normalizeStackInput } from '@objectstack/spec';
import { resolveDisplayField, type DisplayNameObjectMeta } from '@objectstack/spec/data';
import { singularToPlural } from '@objectstack/spec/shared';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { FIELD_NO_CONSUMERS, runAuthoringRules } from '@objectstack/lint';
import { TEMPLATES, sanitizeNamespace } from '../src/commands/init.js';
import {
  GENERATOR_SCAFFOLD_TARGETS,
  stackBindingCandidates,
  type ScaffoldBindings,
} from '../src/commands/generate.js';
import { lintConfig } from '../src/commands/lint.js';
import { BUNDLE_REQUIRE_EXTERNALS } from '../src/utils/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// One `path.resolve(HERE, …)` call per line: `check:cross-package-test-inputs`
// reconstructs these reads by SOURCE SCAN. The blank starter's config and its
// `src/**` tree are declared inputs of this package
// (scripts/cross-package-test-inputs.mjs), so a template-only diff re-runs this file.
const BLANK_CONFIG = path.resolve(HERE, '../../create-objectstack/src/templates/blank/objectstack.config.ts');
const BLANK_OBJECTS = path.resolve(HERE, '../../create-objectstack/src/templates/blank/src/objects');

/**
 * Where sources are materialized for `bundle-require`: under this package's own
 * `node_modules`, so `@objectstack/spec/…` resolves from there as it would for
 * a file in an author's project, and git-ignored, so a killed run leaves inert
 * litter rather than sources a repo-wide scan can trip over. The same choice,
 * argued at length, as `generate-scaffold-validates.test.ts`.
 */
const TMP_ROOT = fs.mkdtempSync(path.join(HERE, '..', 'node_modules', '.starter-field-consumers-'));

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

/** The project name `os init` is measured with. */
const INIT_PROJECT = 'my-app';
/** The object the binding wakers bind: generated beside the starter, never the starter's own. */
const TARGET_STEM = 'gate_target';
/** The name each waker is invoked with. */
const WAKER_ITEM = 'gate_probe';
/** The generators measured as wakers, each in its own project: the three the ruling names. */
const WAKERS = ['dashboard', 'view', 'flow'] as const;

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

const target = (type: string) => {
  const found = GENERATOR_SCAFFOLD_TARGETS.find((t) => t.type === type);
  if (!found) throw new Error(`no '${type}' generator in the roster`);
  return found;
};

let fileSeq = 0;

/** Load one TypeScript source through the loader `os validate` uses. */
async function loadSource(label: string, source: string): Promise<AnyRec> {
  const file = path.join(TMP_ROOT, `${label.replace(/[^a-z0-9]+/gi, '-')}-${fileSeq++}.ts`);
  fs.writeFileSync(file, source, 'utf8');
  const { mod } = await bundleRequire({ filepath: file, external: BUNDLE_REQUIRE_EXTERNALS });
  return mod as AnyRec;
}

/** Every object definition a module exports, whatever its export names. */
const objectsExportedBy = (mod: AnyRec): AnyRec[] =>
  [...new Set(Object.values(mod))].filter(
    (v): v is AnyRec => isRec(v) && typeof v.name === 'string' && isRec(v.fields),
  );

// ── The roster: every starter object, from both scaffolders ──────────────

interface StarterDoor {
  door: string;
  namespace: string;
  /** Each emitted `*.object.ts`, as the project receives it. */
  sources: string[];
}

const blankNamespace = /namespace: '([a-z][a-z0-9_]*)'/.exec(fs.readFileSync(BLANK_CONFIG, 'utf8'))?.[1];
const initNamespace = sanitizeNamespace(INIT_PROJECT);

const DOORS: StarterDoor[] = [
  {
    door: 'npm create objectstack',
    namespace: blankNamespace ?? '',
    sources: fs
      .readdirSync(BLANK_OBJECTS)
      .filter((f) => f.endsWith('.object.ts'))
      .sort()
      .map((f) => fs.readFileSync(path.join(BLANK_OBJECTS, f), 'utf8')),
  },
  ...Object.entries(TEMPLATES).map(([key, template]) => ({
    door: `os init -t ${key}`,
    namespace: initNamespace,
    sources: Object.entries(template.srcFiles)
      .filter(([file]) => file.endsWith('.object.ts'))
      .map(([, render]) => render(INIT_PROJECT, initNamespace)),
  })),
].filter((d) => d.sources.length > 0);

interface Starter {
  door: string;
  namespace: string;
  objects: AnyRec[];
}

const STARTERS: Starter[] = await Promise.all(
  DOORS.map(async ({ door, namespace, sources }) => ({
    door,
    namespace,
    objects: (await Promise.all(sources.map((s) => loadSource(door, s)))).flatMap(objectsExportedBy),
  })),
);

const starterOf = (door: string): Starter => {
  const found = STARTERS.find((s) => s.door === door);
  if (!found) throw new Error(`no starter '${door}'`);
  return found;
};

/** The record's title field, by the ladder the rule exempts it through. */
const titleOf = (obj: AnyRec): string | undefined =>
  resolveDisplayField({
    nameField: typeof obj.nameField === 'string' ? obj.nameField : undefined,
    displayNameField: typeof obj.displayNameField === 'string' ? obj.displayNameField : undefined,
    fields: obj.fields as DisplayNameObjectMeta['fields'],
  });

/** Every starter field that is not its object's title: one control each. */
const CONTROLS = STARTERS.flatMap((s) =>
  s.objects.flatMap((obj, objectIndex) =>
    Object.keys(obj.fields as AnyRec)
      .filter((field) => field !== titleOf(obj))
      .map((field) => ({ door: s.door, object: String(obj.name), objectIndex, field })),
  ),
);

// ── A project: the starter's objects, then one waker ─────────────────────

interface Item {
  type: string;
  artifact: AnyRec;
}

/** The stack a project's config builds: a namespaced manifest, each item in its collection. */
function stackOf(namespace: string, items: readonly Item[]): AnyRec {
  const stack: AnyRec = {
    // `engines.protocol` as every scaffolded config declares it.
    manifest: {
      id: 'com.example.starter',
      name: 'starter',
      version: '1.0.0',
      type: 'app',
      namespace,
      engines: { protocol: `^${PROTOCOL_MAJOR}` },
    },
  };
  const requires = new Set<string>();
  for (const { type, artifact } of items) {
    const key = singularToPlural(type);
    stack[key] = [...((stack[key] as unknown[] | undefined) ?? []), artifact];
    for (const token of target(type).requires) requires.add(token);
  }
  if (requires.size > 0) stack.requires = [...requires];
  return stack;
}

/**
 * The starter's objects plus `waker`, generated the way the command generates
 * it: an object it binds is first generated beside the starter's (never the
 * starter's own, whose fields a bound view would list) and resolved off the
 * project's stack through `stackBindingCandidates`.
 */
async function projectWith(starter: Starter, objects: readonly AnyRec[], waker: string): Promise<AnyRec> {
  const items: Item[] = objects.map((artifact) => ({ type: 'object', artifact }));
  const t = target(waker);
  const bindings: ScaffoldBindings = {};
  for (const key of Object.keys(t.binds)) {
    if (key !== 'object') throw new Error(`\`os g ${waker}\` binds a '${key}': give it a prerequisite here`);
    const object = target('object');
    const mod = await loadSource('object', object.generate(TARGET_STEM, starter.namespace));
    items.push({ type: 'object', artifact: (mod.default ?? mod) as AnyRec });
    const wanted = object.itemName(TARGET_STEM, starter.namespace);
    bindings.object = stackBindingCandidates(stackOf(starter.namespace, items)).objects.find((o) => o.name === wanted);
    if (!bindings.object) throw new Error(`the object \`os g ${waker}\` binds did not resolve: ${wanted}`);
  }
  const itemName = t.binds.object === 'name' ? TARGET_STEM : WAKER_ITEM;
  const mod = await loadSource(waker, t.generate(itemName, starter.namespace, bindings));
  items.push({ type: waker, artifact: (mod.default ?? mod) as AnyRec });
  return stackOf(starter.namespace, items);
}

/**
 * The `field-no-consumers` paths each command reports for `stack`. Throws when
 * the stack does not load or parse: a pipeline that stopped before the rule
 * ran would otherwise read as a clean zero.
 */
function fieldNoConsumers(stack: AnyRec): { validate: string[]; lint: string[] } {
  defineStack(stack as Parameters<typeof defineStack>[0]);
  const normalized = normalizeStackInput(stack) as AnyRec;
  const parsed = ObjectStackDefinitionSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n'));
  }
  const run = { normalized, parsed: parsed.data as AnyRec };
  return {
    validate: runAuthoringRules('validate', run).filter((f) => f.rule === FIELD_NO_CONSUMERS).map((f) => f.path),
    lint: lintConfig(normalized).filter((i) => i.rule === FIELD_NO_CONSUMERS).map((i) => i.path),
  };
}

/** `obj` with `field`'s `group` removed, everything else as the starter wrote it. */
function withoutGroup(obj: AnyRec, field: string): AnyRec {
  const fields = obj.fields as AnyRec;
  const { group: _dropped, ...rest } = fields[field] as AnyRec;
  return { ...obj, fields: { ...fields, [field]: rest } };
}

// ── The pins ─────────────────────────────────────────────────────────────

describe('[#21370] the roster is the real one', () => {
  it('reads the blank starter and every object-bearing `os init` template', () => {
    expect(blankNamespace, 'the blank config declares a namespace').toBeDefined();
    const doors = STARTERS.map((s) => s.door);
    expect(doors).toContain('npm create objectstack');
    for (const [key, template] of Object.entries(TEMPLATES)) {
      if (Object.keys(template.srcFiles).some((f) => f.endsWith('.object.ts'))) expect(doors).toContain(`os init -t ${key}`);
    }
    for (const s of STARTERS) expect(s.objects.length, `${s.door} loads its objects`).toBeGreaterThan(0);
  });

  it('carries non-title fields, so the controls below measure something', () => {
    // Vacuity guard: with no control the zeros below could not be told from a
    // rule that never runs. The two starters the defect was measured on each
    // carry at least one.
    expect(CONTROLS.some((c) => c.door === 'npm create objectstack')).toBe(true);
    expect(CONTROLS.some((c) => c.door === 'os init -t app')).toBe(true);
  });
});

describe('[#21370] every starter, then `os g dashboard | view | flow`: zero `field-no-consumers`', () => {
  const legs = STARTERS.flatMap((s) => WAKERS.map((waker) => [s.door, waker] as const));

  it.each(legs)('%s, then `os g %s`: `os validate` and `os lint` report none', async (door, waker) => {
    const starter = starterOf(door);
    const reported = fieldNoConsumers(await projectWith(starter, starter.objects, waker));
    expect(reported.validate, 'os validate').toEqual([]);
    expect(reported.lint, 'os lint').toEqual([]);
  });
});

describe('[#21370] CONTROL — a starter field with its `group` removed warns again', () => {
  it.each(CONTROLS.map((c) => [c.door, c.object, c.field, c] as const))(
    '%s: `%s.%s` without its group is reported by both commands',
    async (_door, _object, _field, c) => {
      const starter = starterOf(c.door);
      const objects = starter.objects.map((obj, i) => (i === c.objectIndex ? withoutGroup(obj, c.field) : obj));
      const at = `objects[${c.objectIndex}].fields.${c.field}`;
      const reported = fieldNoConsumers(await projectWith(starter, objects, 'dashboard'));
      expect(reported.validate, 'os validate').toEqual([at]);
      expect(reported.lint, 'os lint').toEqual([at]);
    },
  );
});
