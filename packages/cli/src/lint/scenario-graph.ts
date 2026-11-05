// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// Ported from the cloud eval harness under the cloud#3600 D2 ruling (the graph reader in agent-e2e.ts).

/**
 * A built artifact (`dist/objectstack.json`, as `os build` writes it) read into
 * the {@link EvalGraph} the scenario scorers judge.
 *
 * ## One reader of `packages[]`, not a second one
 *
 * A multi-package artifact may carry its collections only inside
 * `packages[i].manifest` (ADR-0130 D4, option B). Every collection here is read
 * through `resolveStackCollection` — the rule `@objectstack/cli` and
 * `@objectstack/verify` already share (`utils/stack-collections.ts`): the
 * top-level array when present, otherwise every package body's, in the
 * dependency order `resolveArtifactPackageOrder` decides. ⛔ No local walk of
 * `packages[]`.
 *
 * ## The spec's shapes, and only those
 *
 * The cloud reader this replaces read a live environment's metadata API and
 * tolerated several spellings per key (`navigation ?? nav ?? tabs ?? …`,
 * `reference_to ?? referenceTo ?? reference`). An artifact has been parsed by
 * the spec before it was written, so each key is read in its ONE declared
 * shape: object `fields` is a name-keyed record, a field's target is
 * `reference` (through `referenceTargetOf`), an app's nav is `navigation` with
 * nested `children`, a widget's measures are `values` and its binding is
 * `dataset` (ADR-0021). A scorer that quietly accepted a second spelling would
 * score an off-spec build as if it were on spec.
 *
 * A value that cannot be read in that shape — an object with no name, a
 * `fields` that is not a record — is refused with a thrown `TypeError` naming
 * where, never read as an empty object: an empty object is a DEGRADED build to
 * the scorer, and an unreadable artifact must not score as one.
 */

import { REFERENCE_VALUE_TYPES, referenceTargetOf } from '@objectstack/spec/data';

import { resolveStackCollection } from '../utils/stack-collections.js';
import { PLATFORM_OBJECT_PREFIX, type EvalGraph, type EvalGraphField, type EvalGraphNavEntry } from './scenario-score.js';

type Bag = Record<string, unknown>;

const isBag = (value: unknown): value is Bag => !!value && typeof value === 'object' && !Array.isArray(value);

function named(item: unknown, where: string): Bag & { name: string } {
  if (!isBag(item) || typeof item.name !== 'string' || item.name === '') {
    throw new TypeError(`scenario graph: ${where} has no \`name\` — the artifact cannot be scored.`);
  }
  return item as Bag & { name: string };
}

/**
 * The author-chosen target of a field, or `undefined`.
 *
 * A type whose target the TYPE fixes (`user` → `sys_user`) has none: whether a
 * type fixes its target is asked of the spec (`referenceTargetOf` on the bare
 * type answers only for those), never transcribed here.
 */
function authoredReference(def: Bag): string | undefined {
  if (typeof def.type !== 'string' || !REFERENCE_VALUE_TYPES.has(def.type)) return undefined;
  if (referenceTargetOf({ type: def.type }) !== undefined) return undefined;
  return referenceTargetOf(def);
}

function toField(name: string, def: unknown, where: string): EvalGraphField {
  if (!isBag(def)) throw new TypeError(`scenario graph: ${where} is not a field definition.`);
  const field: EvalGraphField = { name, type: typeof def.type === 'string' ? def.type : '' };
  if (def.required === true) field.required = true;
  if (Array.isArray(def.options)) {
    field.options = def.options.filter(isBag).map((o) => ({
      value: String(o.value),
      ...(typeof o.label === 'string' ? { label: o.label } : {}),
    }));
  }
  const reference = authoredReference(def);
  if (reference !== undefined) field.reference = reference;
  return field;
}

/** `[kind, targetKey]` per nav item type that targets a named build member. */
const NAV_TARGET_KEYS: Readonly<Record<string, readonly [kind: string, key: string]>> = {
  object: ['object', 'objectName'],
  dashboard: ['dashboard', 'dashboardName'],
  page: ['page', 'pageName'],
  report: ['report', 'reportName'],
};

function navEntries(items: unknown, members: Readonly<Record<string, Set<string>>>, out: EvalGraphNavEntry[]): void {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (!isBag(item)) continue;
    const spec = typeof item.type === 'string' ? NAV_TARGET_KEYS[item.type] : undefined;
    if (spec) {
      const [kind, key] = spec;
      const target = item[key];
      if (typeof target === 'string') {
        const resolves = members[kind]!.has(target) || (kind === 'object' && PLATFORM_OBJECT_PREFIX.test(target));
        out.push({ target, resolves });
      }
    }
    navEntries(item.children, members, out);
  }
}

/**
 * Read a built artifact into an {@link EvalGraph}.
 *
 * @param artifact - The artifact exactly as `JSON.parse` returns
 *   `dist/objectstack.json` — single-package, or multi-package with its
 *   collections under `packages[]`.
 * @throws TypeError when a collection member cannot be read in its spec shape;
 *   the ADR-0112 refusal of `resolveArtifactPackageOrder` for a malformed
 *   `packages` array.
 */
export function artifactToEvalGraph(artifact: unknown): EvalGraph {
  const collection = (key: string) => resolveStackCollection(artifact, key);

  const objects = collection('objects').map((raw, i) => {
    const o = named(raw, `objects[${i}]`);
    const fieldsRaw = o.fields ?? {};
    if (!isBag(fieldsRaw)) {
      throw new TypeError(`scenario graph: object ${o.name} has a \`fields\` that is not a name-keyed record.`);
    }
    return {
      name: o.name,
      fields: Object.entries(fieldsRaw).map(([name, def]) => toField(name, def, `${o.name}.${name}`)),
    };
  });

  const dashboardsRaw = collection('dashboards').map((raw, i) => named(raw, `dashboards[${i}]`));
  const dashboards = dashboardsRaw.map((d) => ({
    name: d.name,
    widgets: (Array.isArray(d.widgets) ? d.widgets : []).filter(isBag).flatMap((w) => {
      const dataset = typeof w.dataset === 'string' ? w.dataset : undefined;
      const values = Array.isArray(w.values) ? w.values.filter((v): v is string => typeof v === 'string') : [];
      return values.length ? values.map((measure) => ({ dataset, measure })) : [{ dataset }];
    }),
  }));

  const datasets = collection('datasets').map((raw, i) => {
    const d = named(raw, `datasets[${i}]`);
    return {
      name: d.name,
      measures: (Array.isArray(d.measures) ? d.measures : [])
        .filter(isBag)
        .map((m) => m.name)
        .filter((n): n is string => typeof n === 'string'),
    };
  });

  const nameSet = (key: string) =>
    new Set(collection(key).map((raw) => (isBag(raw) && typeof raw.name === 'string' ? raw.name : '')).filter(Boolean));
  const members: Record<string, Set<string>> = {
    object: new Set(objects.map((o) => o.name)),
    dashboard: new Set(dashboards.map((d) => d.name)),
    page: nameSet('pages'),
    report: nameSet('reports'),
  };

  const apps = collection('apps').map((raw, i) => {
    const a = named(raw, `apps[${i}]`);
    const nav: EvalGraphNavEntry[] = [];
    navEntries(a.navigation, members, nav);
    return { name: a.name, nav };
  });

  return { objects, dashboards, apps, datasets };
}
