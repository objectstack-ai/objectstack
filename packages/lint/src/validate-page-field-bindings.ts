// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0078 — completeness] Field-reference integrity for page components
 * (issue #3583, assessment R3).
 *
 * `PageComponent.properties` is `z.record(z.string(), z.unknown())` — an
 * untyped bag. The typed prop schemas exist (`ComponentPropsMap` in
 * `@objectstack/spec/ui`) but nothing validates `properties` against them, so
 * every field name a component references ships exactly as typed. The HotCRM
 * audit found KPI cards and page headers bound to fields the object does not
 * have; each renders blank or falls back, and nothing reports the miss.
 *
 * Field-existence lint already exists for forms (`FORM_FIELD_UNKNOWN`),
 * semantic roles, and flow templates. This is the same check for pages, at the
 * same advisory severity: every consumer degrades gracefully (a missing field
 * is skipped, not crashed on), so a warning is the honest level.
 *
 * ── Which object a component binds ──────────────────────────────────────
 *
 * `dataSource.object` → `properties.object` → the page's `object`. A per-element
 * `dataSource` exists precisely so one page can bind several objects, and the
 * `element:*` family declares its own `object`; both must win over the page's.
 *
 * ── Why a hand-written descriptor table ─────────────────────────────────
 *
 * `ComponentPropsMap` cannot drive this rule: a Zod schema does not say which
 * of its `z.string()` props is a FIELD NAME (`RecordPathProps.statusField` and
 * `AIChatWindowProps.agentId` are both plain strings), and the type universe is
 * open anyway — `PageComponent.type` is `z.union([PageComponentType,
 * z.string()])`, so unregistered types like `record:line_items` parse and are
 * authored in the wild. The table below names the field-bearing props
 * explicitly; an unknown component type is SKIPPED silently, never flagged.
 *
 * The table once also covered shapes the props schemas did not describe but
 * real pages authored anyway (`record:details` `sections[].fields[]` /
 * `hideFields[]`, the record picker's `labelField`). #5611 and #5775 settled
 * those the other way — the delivered shape got declared — so today every prop
 * this table names is a live (non-retired) key on its `ComponentPropsMap`
 * schema, and `component-field-specs-liveness.test.ts` pins that: a future
 * retirement that forgets this table turns that test red instead of leaving a
 * tombstoned key listed here as if it were still-valid spelling (#6629).
 *
 * ── Shared with the react page surface ──────────────────────────────────
 *
 * A `kind:'react'` page authors the SAME components, one surface over, as JSX
 * props instead of a `properties` bag (`<RecordHighlights fields={…}>`). The
 * extraction and the check are therefore exported — `COMPONENT_FIELD_SPECS`,
 * {@link componentFieldRefs}, {@link relatedListFieldRefs},
 * {@link indexObjectFields}, {@link checkFieldRefs} — and
 * `validate-react-page-props` runs them on the parsed JSX (#4340). Same table,
 * same skips, same rule id: the two surfaces agree on what counts as a field by
 * construction rather than by two lists that happen to match, which is the
 * drift #4330 had just finished removing from the system-field lists.
 */

export const PAGE_FIELD_UNKNOWN = 'page-field-unknown';
/**
 * [#8340] The reference RESOLVES to a registry-injected system column — so
 * {@link PAGE_FIELD_UNKNOWN} is right to stay silent — but the bound object is
 * ADR-0015 `external`, where the platform registers the anchor and provisions
 * no storage behind it. Always `warning`, on both consequences and including
 * the `queried` one that gates for a genuinely missing column: the existence
 * question has a closed oracle here and the provenance question does not (this
 * pass cannot see the remote schema, only that the platform stores nothing) —
 * #8116's severity reasoning, unchanged.
 */
export const PAGE_FIELD_UNPROVISIONED = 'page-field-unprovisioned';

export type PageFieldSeverity = 'error' | 'warning';

export interface PageFieldFinding {
  /**
   * `warning` on every surface this rule itself walks — page renderers skip an
   * unknown field rather than fail. The shared {@link checkFieldRefs} core also
   * serves the react page surface, where one batch of refs reaches a QUERY
   * rather than a renderer and gates instead; see {@link FieldRefConsequence}.
   */
  severity: PageFieldSeverity;
  /** Diagnostic rule id. */
  rule: string;
  /** Human-readable location, e.g. `page "task_detail" · record:highlights`. */
  where: string;
  /** Config path, e.g. `pages[0].regions[1].components[0].properties.fields[2]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

import { walkPageComponents, type AnyRec } from './page-walk.js';
// Real pages DO reference registry-injected columns — e.g. `sys_user.page.ts`
// lists `created_at` in a related-list's columns — so the shared set is load-
// bearing here, not merely defensive.
import {
  SYSTEM_FIELDS,
  indexUnprovisionedAnchors,
  unprovisionedAnchorCause,
  unprovisionedAnchorHint,
} from './system-fields.js';

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** A field reference found in a props bag, with the path that located it. */
export interface FieldRef {
  name: string;
  path: string;
}

/**
 * Pull field names out of a value that may be a bare string, a `{field}` or
 * `{name}` record, or an array of either — the three shapes the component props
 * use interchangeably (`record:highlights` keys its object form `name`, while
 * columns/sort/filter key theirs `field`).
 */
export function fieldRefsFrom(value: unknown, basePath: string): FieldRef[] {
  const out: FieldRef[] = [];
  const one = (v: unknown, path: string) => {
    const bare = strName(v);
    if (bare) {
      out.push({ name: bare, path });
      return;
    }
    if (!isRec(v)) return;
    const named = strName(v.field) ?? strName(v.name);
    if (named) out.push({ name: named, path: `${path}.${strName(v.field) ? 'field' : 'name'}` });
  };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) one(value[i], `${basePath}[${i}]`);
  } else {
    one(value, basePath);
  }
  return out;
}

/**
 * Field references in a `sort` value.
 *
 * The structured form (`[{ field, order }]`) is ordinary {@link fieldRefsFrom}
 * work. The LEGACY bare-string form is not: `ListViewSchema.sort` still accepts
 * `"created_at desc"`, where the string names ONE field followed by a direction
 * word — so reading the whole string as a field name reports `"created_at desc"`
 * as unknown, a finding whose "field" the author never wrote. Read its head
 * instead, which is exactly what the renderer does with it.
 */
export function sortFieldRefs(value: unknown, basePath: string): FieldRef[] {
  if (typeof value === 'string') {
    const head = value.trim().split(/\s+/)[0];
    return head ? [{ name: head, path: basePath }] : [];
  }
  return fieldRefsFrom(value, basePath);
}

/**
 * Per-component-type descriptor: which `properties` paths hold field names, and
 * whether they resolve against this component's own object or another one.
 *
 * `props` entries are read from `component.properties`. Entries under
 * `nestedSections` walk `properties.<key>[].fields[]` — the section shape real
 * pages author for `record:details`.
 */
export interface ComponentFieldSpec {
  /** Props holding field names bound to the component's resolved object. */
  props?: readonly string[];
  /** Props holding `{...}[]` section objects whose `fields[]` are field names. */
  nestedSections?: readonly string[];
}

export const COMPONENT_FIELD_SPECS: Readonly<Record<string, ComponentFieldSpec>> = {
  'record:highlights': { props: ['fields'] },
  // `sections` (object form) and `hideFields` are what every real page authors,
  // and since #5611 they are what `RecordDetailsProps` declares — this model and
  // the spec agree. (Before that, `sections` was declared as an ID `string[]`
  // and `hideFields` not at all; both survived only because `properties` is
  // unvalidated.)
  'record:details': { props: ['fields', 'hideFields'], nestedSections: ['sections'] },
  'record:path': { props: ['statusField'] },
  'element:number': { props: ['field'] },
  'element:filter': { props: ['fields'] },
  'element:form': { props: ['fields'] },
  // `labelField` is the one field-bearing prop this element declares. Its former
  // companions `displayField` (renamed to `labelField`, ADR-0087 D2) and
  // `searchFields` (deleted, ADR-0049) were retired in #5775 and are
  // `retiredKey()` tombstones on `ElementRecordPickerPropsSchema` — so no
  // spec-conformant page carries either, and this rule's job (resolve a field
  // NAME against the object) is not the question a retired key raises (#6629).
  //
  // A non-conformant page that writes one anyway is not left unattended: the
  // #5068 props gate reports the key with its rename/delete prescription. That
  // gate is advisory and CLI-only and lives in a different registry
  // (`authoring-rules`) from this suite, so it neither precedes nor suppresses
  // this rule — what these two entries actually added was a SECOND finding,
  // saying a field named by a key that no longer exists does not exist either.
  // The prescription is the useful half; this half was noise on top of it.
  'element:record_picker': { props: ['labelField'] },
};

/**
 * `record:related_list` is special: its `columns`/`sort`/`filter` resolve
 * against the RELATED object (`properties.objectName`), not the page's object,
 * so it cannot ride the generic table.
 */
export const RELATED_LIST_TYPE = 'record:related_list';

/**
 * The field references a component's props bag holds, per
 * {@link COMPONENT_FIELD_SPECS}. `null` for a type with no descriptor —
 * unregistered / non-field components are skipped silently, never flagged.
 *
 * `basePath` is the path of the props bag itself, and `sep` joins a prop name
 * onto it: `.` for a metadata page (`…components[0].properties.fields[2]`),
 * ` › ` for react source, whose props live inside one opaque `source` string
 * and so are addressed the way #4329 established (`pages[0].source › fields[2]`).
 */
export function componentFieldRefs(
  type: string,
  props: AnyRec,
  basePath: string,
  sep = '.',
): FieldRef[] | null {
  const spec = COMPONENT_FIELD_SPECS[type];
  if (!spec) return null;
  const refs: FieldRef[] = [];
  for (const key of spec.props ?? []) {
    refs.push(...fieldRefsFrom(props[key], `${basePath}${sep}${key}`));
  }
  for (const key of spec.nestedSections ?? []) {
    const sections = Array.isArray(props[key]) ? (props[key] as unknown[]) : [];
    for (let si = 0; si < sections.length; si++) {
      const section = sections[si];
      // A non-object entry yields nothing here, which is right: lint runs on
      // unvalidated `properties`, so it must survive off-spec input rather than
      // throw on it. (Until #5611 the ID `string[]` this skips was the shape
      // `RecordDetailsProps` declared; it declares the object form now, so this
      // is a defensive guard rather than a divergence from the spec.)
      if (!isRec(section)) continue;
      refs.push(...fieldRefsFrom(section.fields, `${basePath}${sep}${key}[${si}].fields`));
    }
  }
  return refs;
}

/** A `record:related_list` props bag, split by which object each batch resolves against. */
export interface RelatedListFieldRefs {
  /** The related (child) object this list renders — `properties.objectName`. */
  relatedObject: string | undefined;
  /** Refs resolved against {@link relatedObject}. */
  related: FieldRef[];
  /** Refs resolved against the PARENT object (the record the list hangs off). */
  parent: FieldRef[];
  /** The Add picker's own object, and the refs resolved against it. */
  pickerObject: string | undefined;
  picker: FieldRef[];
}

/**
 * Split a `record:related_list` props bag into its three object scopes. Shared
 * so the react `<RecordRelatedList>` block and the metadata component cannot
 * disagree about which object each prop addresses — the exact confusion #4340
 * found published under one prop name.
 */
export function relatedListFieldRefs(
  props: AnyRec,
  basePath: string,
  sep = '.',
): RelatedListFieldRefs {
  const add = isRec(props.add) ? props.add : undefined;
  const picker = add && isRec(add.picker) ? add.picker : undefined;
  const at = (key: string) => `${basePath}${sep}${key}`;
  return {
    relatedObject: strName(props.objectName),
    related: [
      ...fieldRefsFrom(props.columns, at('columns')),
      ...sortFieldRefs(props.sort, at('sort')),
      ...fieldRefsFrom(props.filter, at('filter')),
      ...fieldRefsFrom(props.relationshipField, at('relationshipField')),
      ...(add ? fieldRefsFrom(add.linkField, at('add.linkField')) : []),
    ],
    parent: fieldRefsFrom(props.relationshipValueField, at('relationshipValueField')),
    pickerObject: picker ? strName(picker.object) : undefined,
    picker: picker
      ? [
          ...fieldRefsFrom(picker.valueField, at('add.picker.valueField')),
          ...fieldRefsFrom(picker.labelField, at('add.picker.labelField')),
        ]
      : [],
  };
}

/** object name → its declared field names. Both `fields` shapes resolve. */
export function indexObjectFields(stack: AnyRec): Map<string, Set<string>> {
  const objectFields = new Map<string, Set<string>>();
  if (!isRec(stack)) return objectFields;
  for (const obj of asArray(stack.objects)) {
    const name = strName(obj.name);
    if (!name) continue;
    const names = new Set<string>();
    for (const f of asArray(obj.fields)) {
      const fn = strName(f.name);
      if (fn) names.add(fn);
    }
    objectFields.set(name, names);
  }
  return objectFields;
}

/**
 * How a miss on this batch of refs fails at runtime — the two calls this
 * package makes, named so the message and the severity cannot drift apart.
 *
 * - `skipped` (default): the consumer drops the unknown name and renders the
 *   rest. Advisory, like every other field-existence rule.
 * - `queried`: the name reached a QUERY. An unknown column in a predicate
 *   matches no row (`SqlDriver` swallows the driver's "no such column" and
 *   returns `[]`), so the surface renders an empty list that is
 *   indistinguishable from "there is no data" — the silent-zero failure
 *   `filter-token-unknown` and `validate-flow-template-paths`' filter-position
 *   call both gate on. Gating.
 */
export type FieldRefConsequence = 'skipped' | 'queried';

/**
 * Check one batch of refs against `objectName`'s declared fields.
 *
 * Bails out entirely when the object is not defined in this stack — it may come
 * from another installed package, and we cannot judge fields on a schema we
 * cannot see (the same skip the flow/widget rules use).
 */
export function checkFieldRefs(
  refs: readonly FieldRef[],
  objectName: string | undefined,
  objectFields: ReadonlyMap<string, Set<string>>,
  where: string,
  consequence: FieldRefConsequence = 'skipped',
  // [#8340] `objectName -> its unprovisioned injected anchors`
  // ({@link indexUnprovisionedAnchors}). OPTIONAL, and its absence means
  // exactly one thing: this caller did not build the index, so the provenance
  // question goes unasked and only the existence one is answered — the
  // pre-#8340 behaviour, preserved for out-of-repo callers of this exported
  // core (cloud graph-lint, the AI authoring path). Every in-repo caller passes
  // it: `validatePageFieldBindings` below, and `checkBlockFieldProps` in
  // `validate-react-page-props`.
  //
  // [#8664] What NOTICES if one stops is a behaviour test through the
  // top-level entry point — nothing else can. No CI gate reads call sites:
  // `check-cross-package-test-inputs`, named here until #8664, is an
  // input-scoping gate (it decides which packages CI runs and how the `test`
  // task cache is keyed, from a declared glob list) and has no view of
  // argument passing. Measured by dropping the argument at each site: both
  // entry seams go red — "warns on a highlights binding over an unprovisioned
  // anchor" in this file's test, and "reaches the FILTER position through the
  // shared core" in validate-react-page-props.test.ts, which also covers the
  // `queried` call inside `checkBlockFieldProps`. The other four calls inside
  // `checkBlockFieldProps` are threaded by convention only — dropping the
  // index there leaves the whole lint suite green (#8943).
  unprovisionedAnchors?: ReadonlyMap<string, ReadonlySet<string>>,
): PageFieldFinding[] {
  const findings: PageFieldFinding[] = [];
  if (!objectName) return findings; // nothing to resolve against
  const known = objectFields.get(objectName);
  if (!known) return findings; // cross-package object — unknowable here
  const anchors = unprovisionedAnchors?.get(objectName);
  for (const ref of refs) {
    // A relationship path (`account.name`) is resolved by the query engine,
    // not a base column, so it cannot be judged here.
    if (ref.name.includes('.')) continue;
    if (known.has(ref.name) || SYSTEM_FIELDS.has(ref.name)) {
      // [#8340] Existence answered "yes"; provenance is a second question, and
      // the membership test above keeps owning the first one. An injected
      // anchor on a federated object is addressable and empty: in a QUERY the
      // predicate degrades to constant-false (an empty result that reads as
      // "there is no data"), in a display binding the column renders blank on
      // every record.
      if (anchors?.has(ref.name)) {
        findings.push({
          severity: 'warning',
          rule: PAGE_FIELD_UNPROVISIONED,
          where,
          path: ref.path,
          message:
            `field "${ref.name}" resolves on object "${objectName}", but ` +
            `${unprovisionedAnchorCause(objectName, ref.name)}` +
            (consequence === 'queried'
              ? ' — it is used in a QUERY, so the predicate can never match a real value: on ' +
                'SQLite it silently degrades to constant-false and the surface renders an empty ' +
                'result that looks exactly like "there is no data".'
              : ' — the component renders it, blank, on every record.'),
          hint: unprovisionedAnchorHint(objectName, ref.name),
        });
      }
      continue;
    }
    findings.push({
      severity: consequence === 'queried' ? 'error' : 'warning',
      rule: PAGE_FIELD_UNKNOWN,
      where,
      path: ref.path,
      message:
        `field "${ref.name}" is not a field on object "${objectName}" — ` +
        (consequence === 'queried'
          ? 'it is used in a QUERY, so the predicate can never match: the surface ' +
            'renders an empty result that looks exactly like "there is no data".'
          : 'the component silently skips it, so it never renders.'),
      hint:
        `Fix the field name, or add "${ref.name}" to ${objectName}. ` +
        `References must match the object's field names exactly.` +
        (known.size > 0 ? ` Object fields: ${[...known].sort().join(', ')}.` : ''),
    });
  }
  return findings;
}

export function validatePageFieldBindings(stack: AnyRec): PageFieldFinding[] {
  const findings: PageFieldFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  // object name → its declared field names. Built with `asArray` so BOTH
  // `fields` shapes (array of `{name}` and name-keyed map) resolve.
  const objectFields = indexObjectFields(stack);
  // [#8340] The provenance index alongside the existence one — same keying,
  // asked on the path where the existence check stays silent.
  const unprovisionedAnchors = indexUnprovisionedAnchors(stack);

  const pages = asArray(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!page || typeof page !== 'object') continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    const checkRefs = (refs: readonly FieldRef[], objectName: string | undefined, where: string) => {
      findings.push(
        ...checkFieldRefs(refs, objectName, objectFields, where, 'skipped', unprovisionedAnchors),
      );
    };

    for (const { component, path, objectName } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type);
      const props = isRec(component.properties) ? component.properties : undefined;
      if (!type || !props) continue;
      const where = `page "${pageName}" · ${type}`;
      const base = `${path}.properties`;

      if (type === RELATED_LIST_TYPE) {
        const split = relatedListFieldRefs(props, base);
        checkRefs(split.related, split.relatedObject, where);
        // `relationshipValueField` names a field on the PARENT (page) object.
        checkRefs(split.parent, objectName, where);
        // The add-picker resolves against its own object.
        checkRefs(split.picker, split.pickerObject, where);
        continue;
      }

      const refs = componentFieldRefs(type, props, base);
      if (!refs) continue; // unregistered / non-field component — skip silently
      checkRefs(refs, objectName, where);
    }

    // ── interfaceConfig (list pages) ──
    // Bound by `interfaceConfig.source`, falling back to the page's object.
    const cfg = isRec(page.interfaceConfig) ? page.interfaceConfig : undefined;
    if (cfg) {
      const cfgObject = strName(cfg.source) ?? strName(page.object);
      const base = `pages[${pi}].interfaceConfig`;
      const refs: FieldRef[] = [
        ...fieldRefsFrom(cfg.columns, `${base}.columns`),
        ...sortFieldRefs(cfg.sort, `${base}.sort`),
        ...fieldRefsFrom(cfg.filterBy, `${base}.filterBy`),
      ];
      const userFilters = isRec(cfg.userFilters) ? cfg.userFilters : undefined;
      if (userFilters) {
        refs.push(...fieldRefsFrom(userFilters.fields, `${base}.userFilters.fields`));
      }
      checkRefs(refs, cfgObject, `page "${pageName}" · interfaceConfig`);
    }
  }

  return findings;
}
