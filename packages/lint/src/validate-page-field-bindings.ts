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
 * The table also covers shapes the props schemas do not yet describe but real
 * pages authored anyway (they pass only because `properties` is unvalidated):
 * `record:details` `sections[].fields[]` and `hideFields[]`, and the record
 * picker's `labelField`. Linting the schema's shape alone would find nothing on
 * the actual corpus.
 */

export const PAGE_FIELD_UNKNOWN = 'page-field-unknown';

export type PageFieldSeverity = 'error' | 'warning';

export interface PageFieldFinding {
  /** Always `warning` — page renderers skip an unknown field rather than fail. */
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

/**
 * Registry-injected fields present on (almost) every object but NOT declared in
 * `object.fields`. Copied verbatim from `validate-widget-bindings` so the two
 * rules agree on what counts as a field. Deliberately generous: over-inclusion
 * costs at worst a missed warning on a `systemFields: false` object; under-
 * inclusion costs a false one, and a false finding is what makes authors stop
 * trusting the linter (ADR-0072 D1). Real pages DO reference these — e.g.
 * `sys_user.page.ts` lists `created_at` in a related-list's columns.
 */
const SYSTEM_FIELDS = new Set<string>([
  'id',
  'created_at', 'created_by', 'updated_at', 'updated_by',
  'owner_id', 'organization_id', 'tenant_id', 'user_id',
  'deleted_at',
]);

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
interface FieldRef {
  name: string;
  path: string;
}

/**
 * Pull field names out of a value that may be a bare string, a `{field}` or
 * `{name}` record, or an array of either — the three shapes the component props
 * use interchangeably (`record:highlights` keys its object form `name`, while
 * columns/sort/filter key theirs `field`).
 */
function fieldRefsFrom(value: unknown, basePath: string): FieldRef[] {
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
 * Per-component-type descriptor: which `properties` paths hold field names, and
 * whether they resolve against this component's own object or another one.
 *
 * `props` entries are read from `component.properties`. Entries under
 * `nestedSections` walk `properties.<key>[].fields[]` — the section shape real
 * pages author for `record:details`.
 */
interface ComponentFieldSpec {
  /** Props holding field names bound to the component's resolved object. */
  props?: readonly string[];
  /** Props holding `{...}[]` section objects whose `fields[]` are field names. */
  nestedSections?: readonly string[];
}

const COMPONENT_FIELD_SPECS: Readonly<Record<string, ComponentFieldSpec>> = {
  'record:highlights': { props: ['fields'] },
  // `sections`/`hideFields` are not in RecordDetailsProps, but every real page
  // authors them (they survive because `properties` is unvalidated).
  'record:details': { props: ['fields', 'hideFields'], nestedSections: ['sections'] },
  'record:path': { props: ['statusField'] },
  'element:number': { props: ['field'] },
  'element:filter': { props: ['fields'] },
  'element:form': { props: ['fields'] },
  // The schema says `displayField`; real pages author `labelField`. Accept both.
  'element:record_picker': { props: ['displayField', 'labelField', 'searchFields'] },
};

/**
 * `record:related_list` is special: its `columns`/`sort`/`filter` resolve
 * against the RELATED object (`properties.objectName`), not the page's object,
 * so it cannot ride the generic table.
 */
const RELATED_LIST_TYPE = 'record:related_list';

export function validatePageFieldBindings(stack: AnyRec): PageFieldFinding[] {
  const findings: PageFieldFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  // object name → its declared field names. Built with `asArray` so BOTH
  // `fields` shapes (array of `{name}` and name-keyed map) resolve.
  const objectFields = new Map<string, Set<string>>();
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

  const pages = asArray(stack.pages);
  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi];
    if (!page || typeof page !== 'object') continue;
    const pageName = strName(page.name) ?? `#${pi}`;

    /**
     * Check one batch of refs against `objectName`. Bails out entirely when the
     * object is not defined in this stack — it may come from another installed
     * package, and we cannot judge fields on a schema we cannot see (the same
     * skip the flow/widget rules use).
     */
    const checkRefs = (refs: FieldRef[], objectName: string | undefined, where: string) => {
      if (!objectName) return; // nothing to resolve against
      const known = objectFields.get(objectName);
      if (!known) return; // cross-package object — unknowable here
      for (const ref of refs) {
        // A relationship path (`account.name`) is resolved by the query engine,
        // not a base column, so it cannot be judged here.
        if (ref.name.includes('.')) continue;
        if (known.has(ref.name) || SYSTEM_FIELDS.has(ref.name)) continue;
        findings.push({
          severity: 'warning',
          rule: PAGE_FIELD_UNKNOWN,
          where,
          path: ref.path,
          message:
            `field "${ref.name}" is not a field on object "${objectName}" — ` +
            `the component silently skips it, so it never renders.`,
          hint:
            `Fix the field name, or add "${ref.name}" to ${objectName}. ` +
            `References must match the object's field names exactly.` +
            (known.size > 0 ? ` Object fields: ${[...known].sort().join(', ')}.` : ''),
        });
      }
    };

    for (const { component, path, objectName } of walkPageComponents(page, `pages[${pi}]`)) {
      const type = strName(component.type);
      const props = isRec(component.properties) ? component.properties : undefined;
      if (!type || !props) continue;
      const where = `page "${pageName}" · ${type}`;

      if (type === RELATED_LIST_TYPE) {
        // Columns / sort / filter address the RELATED object.
        const relatedObject = strName(props.objectName);
        const relatedRefs: FieldRef[] = [
          ...fieldRefsFrom(props.columns, `${path}.properties.columns`),
          ...fieldRefsFrom(props.sort, `${path}.properties.sort`),
          ...fieldRefsFrom(props.filter, `${path}.properties.filter`),
          ...fieldRefsFrom(props.relationshipField, `${path}.properties.relationshipField`),
        ];
        checkRefs(relatedRefs, relatedObject, where);
        // `relationshipValueField` names a field on the PARENT (page) object.
        checkRefs(
          fieldRefsFrom(props.relationshipValueField, `${path}.properties.relationshipValueField`),
          objectName,
          where,
        );
        // The add-picker resolves against its own object.
        const add = isRec(props.add) ? props.add : undefined;
        const picker = add && isRec(add.picker) ? add.picker : undefined;
        if (picker) {
          checkRefs(
            [
              ...fieldRefsFrom(picker.valueField, `${path}.properties.add.picker.valueField`),
              ...fieldRefsFrom(picker.labelField, `${path}.properties.add.picker.labelField`),
            ],
            strName(picker.object),
            where,
          );
        }
        if (add) {
          checkRefs(
            fieldRefsFrom(add.linkField, `${path}.properties.add.linkField`),
            relatedObject,
            where,
          );
        }
        continue;
      }

      const spec = COMPONENT_FIELD_SPECS[type];
      if (!spec) continue; // unregistered / non-field component — skip silently

      const refs: FieldRef[] = [];
      for (const key of spec.props ?? []) {
        refs.push(...fieldRefsFrom(props[key], `${path}.properties.${key}`));
      }
      for (const key of spec.nestedSections ?? []) {
        const sections = Array.isArray(props[key]) ? (props[key] as unknown[]) : [];
        for (let si = 0; si < sections.length; si++) {
          const section = sections[si];
          if (!isRec(section)) continue;
          refs.push(
            ...fieldRefsFrom(section.fields, `${path}.properties.${key}[${si}].fields`),
          );
        }
      }
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
        ...fieldRefsFrom(cfg.sort, `${base}.sort`),
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
