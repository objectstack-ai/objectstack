// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * useDatasetFields — metadata-driven catalogs for the DatasetDefaultInspector
 * pickers (ADR-0021). Turns the dataset designer's three free-text inputs
 * (base object, included relationships, dimension/measure `field`) into
 * dropdowns of the real object graph, so an author picks instead of recalling
 * exact API names.
 *
 *   • {@link useObjectOptions}        — every object (Base object picker).
 *   • {@link useDatasetFieldCatalog}  — the base object's relationships
 *     (join allowlist) + a flat `field` / `relationship.field` option list,
 *     fetching each included relationship's target object on demand.
 *   • {@link useDatasetUsage}         — reverse lineage: how many reports /
 *     dashboards bind this dataset (shown before a breaking edit).
 *
 * The hooks are defensive (a 404 / transport error resolves to an empty
 * catalog so the inspector falls back to free-text entry) and the heavy
 * normalization is factored into exported pure helpers for unit testing.
 */

import * as React from 'react';
import { useMetadataClient } from '../useMetadata.js';
import { readFields } from '../previews/object-fields-io.js';

/* ─────────────── Types ─────────────── */

export interface DatasetObjectOption {
  /** Object API name (snake_case) — what `dataset.object` stores. */
  name: string;
  /** Human label (falls back to the name). */
  label: string;
}

export interface DatasetRelationship {
  /** Relationship field name — what goes in `dataset.include`. */
  name: string;
  /** Human label (falls back to the name). */
  label: string;
  /** Target object the relationship points at (for `rel.field` paths). */
  referenceTo?: string;
}

export interface DatasetFieldOption {
  /** Field path: a base field name or `relationship.field`. */
  value: string;
  /** Human label (falls back to the value). */
  label: string;
  /** Raw framework field type (e.g. 'text', 'currency', 'lookup'). */
  type?: string;
  /** Group heading: the base object label, or `rel → target`. */
  group: string;
}

export interface DatasetFieldCatalog {
  relationships: DatasetRelationship[];
  fieldOptions: DatasetFieldOption[];
  loading: boolean;
}

/* ─────────────── Pure helpers (unit-tested) ─────────────── */

/** Field types that join to another object (so they're valid `include` entries). */
const RELATIONSHIP_TYPES = new Set(['lookup', 'master_detail', 'masterdetail', 'master-detail']);

/** Resolve a string | i18n-object label down to a display string. */
export function resolveLabel(label: unknown, fallback: string): string {
  if (typeof label === 'string' && label) return label;
  if (label && typeof label === 'object') {
    const def = (label as { default?: unknown }).default;
    if (typeof def === 'string' && def) return def;
  }
  return fallback;
}

/**
 * Read a lookup/master_detail field's target object from its raw def.
 *
 * `reference` is the ONLY spelling this reads, and that is a measurement rather
 * than a preference (objectui#6528). The four-spelling fallback chain this
 * replaces (`reference ?? reference_to ?? referenceTo ?? reference_to_object`)
 * was censused against every producer that can reach this helper:
 *
 *   reference             ACCEPTED by `ObjectSchema.safeParse` (spec 17.2.0) and
 *                         emitted by both designer writers today
 *                         (`MetadataService.toFieldPayload`,
 *                         `MetadataFieldsPage.fromDesignerField`, each
 *                         `reference: <target>`). 445 of the 565 lookup /
 *                         master_detail defs in the framework tree spell it
 *                         this way. This is the positive control every zero
 *                         below is measured against.
 *   reference_to          REFUSED BY NAME — "Did you mean `reference_to` ->
 *                         `reference`?". Zero producers on THIS surface. It was
 *                         then a live key only on ObjectUI's own view/field
 *                         schema (`@object-ui/types` `views.zod.ts`), a
 *                         different contract that `plugin-detail` translated
 *                         INTO from `reference` (objectui#11070 round 4 moved
 *                         that schema to `reference` too); an object metadata
 *                         document never carries it.
 *   referenceTo           REFUSED BY NAME. Its two historical producers were
 *                         retired at the producer by objectui#6041, and
 *                         objectui#6519 added it to `RETIRED_FIELD_KEYS` so the
 *                         read door strips it — `normalizeObject` builds every
 *                         def through `readFields`, so this branch could not
 *                         receive a value here even from a stored pre-#6041 row.
 *   reference_to_object   REFUSED, and not even a recognised alias (the spec's
 *                         alias table folds `relatedTo` / `referenceTo` /
 *                         `target` / `targetObject` / `lookupObject` onto
 *                         `reference` — never this one). Zero occurrences
 *                         anywhere in either tree except this chain and the unit
 *                         test that called it: it was only ever produced by its
 *                         own test.
 *
 * Keeping the chain would be the shape AGENTS.md #0.1 forbids — a lenient
 * consumer is where a wrong producer hides. A doc that reaches here spelling the
 * target any other way is a PRODUCER defect, and must fail visibly here so it is
 * fixed there.
 *
 * The CARRIER — the shape the value may take — is narrowed on the same evidence
 * standard as of objectui#6648. `FieldSchema.reference` is a plain `z.string()`,
 * and `ObjectSchema.safeParse` (spec 17.2.0) REFUSES the other two carriers on
 * the canonical key while ACCEPTING the bare name (the positive control):
 * `reference: ['crm_account']` is `invalid_type: expected string, received
 * array`, `reference: { object: 'crm_account' }` is `expected string, received
 * object`.
 *
 * The carrier census walked STRUCTURE, not text — JSON/YAML parsed and walked,
 * TS/TSX through the TypeScript compiler API — recording each hit's ancestor
 * property chain and its enclosing object's sibling keys, so a FIELD DEF is
 * separated from the other tiers that also spell `reference` (a form field
 * literally named `reference`, its translation entries, a JSON-Schema property
 * descriptor, a liveness-ledger row). Across both trees: 607 hits at the
 * field-def key position, 587 of them the bare-string carrier, and ZERO array
 * or `{ object }` carriers from any producer. Every dynamic initializer at that
 * position resolved to a string source, and every `reference` TYPE declaration
 * in either tree declares `string`. The detector is not blind to the shape it
 * hunted: it DID report array and `{ object }` carriers — the two green pins
 * that asserted this tolerance, and one framework lint FIXTURE whose own rule
 * (`refOf`) already reads string-only.
 *
 * The array branch was also a silent PRODUCT decision: handed a multi-target
 * value it returned `raw[0]` and discarded the rest. Nothing declares such a
 * value — polymorphic lookup is an open Tier-3 gap in the spec's own audit
 * report ("Current `reference` only supports a single target"), and the
 * platform's one polymorphic reference (ADR-0018 `xRef`) is a STRING with a
 * sibling discriminator, never a list. If multi-target lookups land they land
 * as a declared spec shape; until then, silently taking element zero is data
 * loss wearing a compatibility shim.
 */
export function resolveReferenceTo(def: Record<string, unknown>): string | undefined {
  const raw = def.reference;
  return typeof raw === 'string' && raw ? raw : undefined;
}

/** Map a framework field type onto a dataset dimension type. */
export function fieldTypeToDimensionType(type: string | undefined): string {
  switch (type) {
    case 'lookup':
    case 'master_detail':
    case 'masterDetail':
    case 'master-detail':
      return 'lookup';
    case 'date':
    case 'datetime':
    case 'time':
      return 'date';
    case 'number':
    case 'currency':
    case 'percent':
    case 'int':
    case 'integer':
    case 'float':
    case 'double':
    case 'autonumber':
      return 'number';
    case 'boolean':
    case 'toggle':
      return 'boolean';
    default:
      return 'string';
  }
}

export interface NormalizedObject {
  label: string;
  fields: Array<{ name: string; label: string; type?: string; def: Record<string, unknown> }>;
  relationships: DatasetRelationship[];
}

/** Normalize a raw object metadata doc into label + fields + relationships. */
export function normalizeObject(doc: Record<string, unknown> | null | undefined, name: string): NormalizedObject {
  if (!doc) return { label: name, fields: [], relationships: [] };
  const label = resolveLabel(doc.label, name);
  const fields = readFields((doc as any).fields).entries.map((e) => ({
    name: e.name,
    label: resolveLabel(e.def.label, e.name),
    type: typeof e.def.type === 'string' ? (e.def.type as string) : undefined,
    def: e.def,
  }));
  const relationships: DatasetRelationship[] = fields
    .filter((f) => f.type && RELATIONSHIP_TYPES.has(f.type.toLowerCase()))
    .map((f) => ({ name: f.name, label: f.label, referenceTo: resolveReferenceTo(f.def) }));
  return { label, fields, relationships };
}

/**
 * Walk a dotted relationship PATH from the base object, returning the object at
 * its end (whose fields a `path.field` references) plus each hop's relationship
 * label, or undefined if any hop can't be resolved (ADR-0071 multi-hop).
 * `objectsByName` holds the already-fetched objects along the chain.
 */
export function resolvePath(
  base: NormalizedObject,
  path: string,
  objectsByName: Record<string, NormalizedObject>,
): { target: NormalizedObject; labels: string[] } | undefined {
  let current: NormalizedObject = base;
  const labels: string[] = [];
  for (const seg of path.split('.')) {
    const rel = current.relationships.find((r) => r.name === seg);
    if (!rel?.referenceTo) return undefined;
    const next = objectsByName[rel.referenceTo];
    if (!next) return undefined;
    labels.push(rel.label);
    current = next;
  }
  return { target: current, labels };
}

/**
 * Build the flat `field` / `relationship[.relationship].field` option list from
 * the base object and the (already-fetched) objects along each included PATH.
 * Single-hop paths behave exactly as before.
 */
export function buildFieldOptions(
  base: NormalizedObject,
  include: string[],
  objectsByName: Record<string, NormalizedObject>,
): DatasetFieldOption[] {
  const options: DatasetFieldOption[] = base.fields.map((f) => ({
    value: f.name,
    label: f.label,
    type: f.type,
    group: base.label,
  }));
  for (const path of include) {
    const resolved = resolvePath(base, path, objectsByName);
    if (!resolved) continue;
    const heading = [...resolved.labels, resolved.target.label].join(' → ');
    for (const f of resolved.target.fields) {
      options.push({ value: `${path}.${f.name}`, label: f.label, type: f.type, group: heading });
    }
  }
  return options;
}

/** Recursively test whether a metadata doc references `datasetName` via a `dataset` key. */
export function referencesDataset(doc: unknown, datasetName: string): boolean {
  if (!doc || typeof doc !== 'object') return false;
  if (Array.isArray(doc)) return doc.some((d) => referencesDataset(d, datasetName));
  const rec = doc as Record<string, unknown>;
  if (typeof rec.dataset === 'string' && rec.dataset === datasetName) return true;
  return Object.values(rec).some((v) => v && typeof v === 'object' && referencesDataset(v, datasetName));
}

/* ─────────────── Hooks ─────────────── */

/** Every object as `{ name, label }`, sorted by label. Fetched once. */
export function useObjectOptions(): { options: DatasetObjectOption[]; loading: boolean } {
  const client = useMetadataClient();
  const [state, setState] = React.useState<{ options: DatasetObjectOption[]; loading: boolean }>({
    options: [],
    loading: true,
  });

  React.useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    client
      .list<Record<string, unknown>>('object')
      .then((docs) => {
        if (cancelled) return;
        const options = (Array.isArray(docs) ? docs : [])
          .map((d) => ({ name: typeof d.name === 'string' ? d.name : '', label: resolveLabel(d.label, typeof d.name === 'string' ? d.name : '') }))
          .filter((o) => !!o.name)
          .sort((a, b) => a.label.localeCompare(b.label));
        setState({ options, loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ options: [], loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  return state;
}

/**
 * The base object's relationships (join allowlist) + a flat `field` /
 * `relationship.field` option list. Refetches when `object` or the set of
 * included relationships changes.
 */
export function useDatasetFieldCatalog(
  object: string | undefined,
  include: string[],
): DatasetFieldCatalog {
  const client = useMetadataClient();
  // Serialized rather than joined on a separator: this value is only a React
  // dependency key, and the separator used to be a raw U+0000 byte picked as
  // "a character no path can contain" -- which made this entire file binary to
  // grep, so no content search could see it (objectstack#5425). JSON needs no
  // impossible character at all, so the round-trip below cannot be broken by
  // any path value, and the source stays plain ASCII.
  const includeKey = JSON.stringify(include);
  const [state, setState] = React.useState<DatasetFieldCatalog>({
    relationships: [],
    fieldOptions: [],
    loading: !!object,
  });

  React.useEffect(() => {
    if (!object) {
      setState({ relationships: [], fieldOptions: [], loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      try {
        const baseDoc = await client.get<Record<string, unknown>>('object', object);
        if (cancelled) return;
        const base = normalizeObject(baseDoc, object);
        const includeList: string[] = JSON.parse(includeKey);
        // Walk each included PATH hop-by-hop, fetching every object along the
        // chain (memoized by name) so multi-hop `a.b.field` paths resolve
        // (ADR-0021 single-hop, generalized by ADR-0071). Hops can't be fetched
        // in parallel across a chain — hop N's target is only known once hop
        // N-1 is fetched.
        const objectsByName: Record<string, NormalizedObject> = { [object]: base };
        const fetchObject = async (name: string): Promise<NormalizedObject> => {
          if (objectsByName[name]) return objectsByName[name];
          let norm: NormalizedObject;
          try {
            norm = normalizeObject(await client.get<Record<string, unknown>>('object', name), name);
          } catch {
            norm = normalizeObject(null, name);
          }
          objectsByName[name] = norm;
          return norm;
        };
        for (const path of includeList) {
          let current = base;
          for (const seg of path.split('.')) {
            const rel = current.relationships.find((r) => r.name === seg);
            if (!rel?.referenceTo) break;
            current = await fetchObject(rel.referenceTo);
          }
        }
        if (cancelled) return;
        // The include combo offers base relationships AND one level deeper along
        // each already-included path (so the author drills `account` ->
        // `account.owner`), capped at the 3-hop ADR-0071 limit.
        const relationshipPaths: DatasetRelationship[] = [...base.relationships];
        for (const path of includeList) {
          if (path.split('.').length >= 3) continue;
          const resolved = resolvePath(base, path, objectsByName);
          if (!resolved) continue;
          for (const r of resolved.target.relationships) {
            relationshipPaths.push({ name: `${path}.${r.name}`, label: `${path}.${r.name}`, referenceTo: r.referenceTo });
          }
        }
        setState({
          relationships: relationshipPaths,
          fieldOptions: buildFieldOptions(base, includeList, objectsByName),
          loading: false,
        });
      } catch {
        if (!cancelled) setState({ relationships: [], fieldOptions: [], loading: false });
      }
    })();
    return () => {
      cancelled = true;
    };
    // includeKey captures the include array by value; eslint-disable the
    // exhaustive-deps array-identity warning since we key on the serialized string.
  }, [client, object, includeKey]);

  return state;
}

export interface DatasetUsage {
  reports: number;
  dashboards: number;
  loading: boolean;
}

/** Reverse lineage: how many reports / dashboards bind this dataset by name. */
export function useDatasetUsage(name: string | undefined): DatasetUsage {
  const client = useMetadataClient();
  const [state, setState] = React.useState<DatasetUsage>({ reports: 0, dashboards: 0, loading: !!name });

  React.useEffect(() => {
    if (!name) {
      setState({ reports: 0, dashboards: 0, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    (async () => {
      const [reports, dashboards] = await Promise.all([
        client.list<Record<string, unknown>>('report').catch(() => []),
        client.list<Record<string, unknown>>('dashboard').catch(() => []),
      ]);
      if (cancelled) return;
      setState({
        reports: (Array.isArray(reports) ? reports : []).filter((d) => referencesDataset(d, name)).length,
        dashboards: (Array.isArray(dashboards) ? dashboards : []).filter((d) => referencesDataset(d, name)).length,
        loading: false,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [client, name]);

  return state;
}
