// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time conditional-visibility diagnostics (ADR-0089 D3b).
 *
 * ADR-0089 unifies the conditional-visibility predicate under the single
 * canonical key **`visibleWhen`** across data fields, view form sections/fields,
 * and page components. The deprecated spellings — `visibleOn` (view form) and
 * `visibility` (page component) — stay accepted and are folded into `visibleWhen`
 * at the schema boundary (a zod `.transform()`). Because that fold happens during
 * `parse()`, the aliases are gone from the *parsed* stack — so this rule runs on
 * the **pre-parse** (normalized) stack, exactly like `validate-list-view-mode`,
 * to see what the author actually wrote.
 *
 * Two advisory rules (both `warning` — nothing is broken, the alias still works
 * and a mis-rooted predicate just never matches):
 *
 * - `visibility-alias-deprecated` — a `visibleOn` / `visibility` key in authored
 *   source. Autofix intent: rename the key to `visibleWhen` (same value).
 * - `visibility-root-mislayered` — a visibility predicate whose binding root does
 *   not match its layer (ADR-0089 D3, §Context). The check is **bidirectional**:
 *   - **runtime** view/page surfaces (`*.view.ts` / `*.page.ts`) bind
 *     `record` + `current_user` (pages also expose `page.<var>`), so a `data.`-rooted
 *     predicate here is a wrong-layer paste that silently never matches; and
 *   - **metadata-editing** forms (`*.form.ts` — the row under edit) bind `data`, so
 *     a `record.`-rooted predicate there is the same bug in the other direction.
 *   The layer is supplied by the caller (`opts.layer`, default `'runtime'`): the
 *   app-lint path (`os validate` / `compile`) always lints runtime surfaces, while a
 *   file-aware caller linting a `*.form.ts` passes `layer: 'metadata'`.
 *
 * Scope: `views` (form `sections` / legacy `groups`, and their `fields`) and
 * `pages` (`regions[].components[]`). Data-field `visibleWhen` is already covered
 * by `validate-expressions` and is not re-checked here.
 */

export const VISIBILITY_ALIAS_DEPRECATED = 'visibility-alias-deprecated';
export const VISIBILITY_ROOT_MISLAYERED = 'visibility-root-mislayered';

export type VisibilitySeverity = 'error' | 'warning';

/**
 * Which binding environment the linted surface belongs to (ADR-0089 §Context):
 * - `runtime`  — `*.view.ts` / `*.page.ts`; binds `record` + `current_user` (+ `page`).
 * - `metadata` — `*.form.ts` metadata-editing forms; binds `data` (the row under edit).
 */
export type VisibilityLayer = 'runtime' | 'metadata';

/** Options for {@link validateVisibilityPredicates}. */
export interface VisibilityOptions {
  /** Binding layer of the surface being linted. Defaults to `'runtime'`. */
  layer?: VisibilityLayer;
}

export interface VisibilityFinding {
  /** Always `warning` today — both rules are advisory (see module note). */
  severity: VisibilitySeverity;
  /** Diagnostic rule id, e.g. `visibility-alias-deprecated`. */
  rule: string;
  /** Human-readable location, e.g. `view "contact_form"`. */
  where: string;
  /** Config path, e.g. `views[2].sections[0].fields[3]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** The canonical key and its two deprecated aliases (ADR-0089). */
const CANONICAL = 'visibleWhen';
const ALIASES = ['visibleOn', 'visibility'] as const;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/** Extract the CEL source from a predicate value (string, or `{ source }` envelope). */
function predicateSource(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as AnyRec).source === 'string') {
    return (v as AnyRec).source as string;
  }
  return undefined;
}

/** Does the predicate reference `<root>.<x>` as a leading binding root? */
function usesRoot(source: string, root: string): boolean {
  // `<root>` as a leading identifier followed by a property access. The leading
  // `(^|[^.\w$])` guard excludes a nested access like `foo.data` (a field named
  // `data`) or `my_record.x` (an identifier that merely ends in `record`).
  return new RegExp(`(^|[^.\\w$])${root}\\.\\w`).test(source);
}

/**
 * Per-layer mis-rooted-predicate description. The `runtime` layer forbids the
 * metadata-editing-form root (`data.`); the `metadata` layer forbids the runtime
 * record-surface root (`record.`) — ADR-0089 D3 spells out both directions.
 */
const MISLAYER_BY_LAYER: Record<
  VisibilityLayer,
  { forbiddenRoot: string; message: string; hint: string }
> = {
  runtime: {
    forbiddenRoot: 'data',
    message:
      'visibility predicate is rooted at `data.` — that is the ' +
      'metadata-editing-form root (a `*.form.ts` row under edit), not a runtime ' +
      'surface. A runtime view/page predicate that binds `data.` never matches ' +
      'and the element renders unconditionally (ADR-0089).',
    hint:
      'Runtime record surfaces bind `record` + `current_user` (pages also ' +
      "expose `page.<var>`). Use e.g. `record.status == 'open'` instead of " +
      "`data.status == 'open'`.",
  },
  metadata: {
    forbiddenRoot: 'record',
    message:
      'visibility predicate is rooted at `record.` — that is the runtime ' +
      'record-surface root (a `*.view.ts` / `*.page.ts` live record), not a ' +
      'metadata-editing form. A `*.form.ts` predicate that binds `record.` never ' +
      'matches and the element renders unconditionally (ADR-0089).',
    hint:
      'Metadata-editing forms bind `data` (the row under edit). Use e.g. ' +
      "`data.type == 'grid'` instead of `record.type == 'grid'`.",
  },
};

/**
 * Inspect one element carrying a visibility predicate. Emits the alias-deprecated
 * finding (when an alias key is present) and the mis-layered-root finding (when
 * the effective predicate's binding root does not match `layer`).
 */
function checkElement(
  el: AnyRec,
  where: string,
  path: string,
  layer: VisibilityLayer,
  findings: VisibilityFinding[],
): void {
  // (1) deprecated alias key present → steer to `visibleWhen`.
  for (const alias of ALIASES) {
    if (el[alias] !== undefined) {
      findings.push({
        severity: 'warning',
        rule: VISIBILITY_ALIAS_DEPRECATED,
        where,
        path: `${path}.${alias}`,
        message:
          `\`${alias}\` is the deprecated spelling of the conditional-visibility ` +
          `predicate (ADR-0089). It still works — it is normalized to \`visibleWhen\` ` +
          `at parse — but the canonical key is \`visibleWhen\`.`,
        hint: `Rename the key \`${alias}\` → \`visibleWhen\` (same CEL value).`,
      });
    }
  }

  // (2) mis-layered binding root — check the effective predicate (canonical wins)
  // against the root expected for this layer.
  const raw = el[CANONICAL] ?? el.visibleOn ?? el.visibility;
  const source = predicateSource(raw);
  const rule = MISLAYER_BY_LAYER[layer];
  if (source && usesRoot(source, rule.forbiddenRoot)) {
    findings.push({
      severity: 'warning',
      rule: VISIBILITY_ROOT_MISLAYERED,
      where,
      path,
      message: rule.message,
      hint: rule.hint,
    });
  }
}

/** A section field entry is either a bare field name or `{ field, visibleWhen, … }`. */
function isFieldObject(entry: unknown): entry is AnyRec {
  return !!entry && typeof entry === 'object' && !Array.isArray(entry);
}

/**
 * Validate conditional-visibility keys across authored views and pages.
 *
 * Runs on the **pre-parse** (normalized) stack so it can see the deprecated
 * `visibleOn` / `visibility` aliases before the schema folds them into
 * `visibleWhen`. Returns findings (empty = clean); all advisory (`warning`) —
 * the caller must never fail the build on these alone.
 *
 * The binding-root check is layer-directional (ADR-0089 D3): pass
 * `opts.layer = 'metadata'` when linting a `*.form.ts` metadata-editing form (so a
 * `record.`-rooted predicate is flagged), or leave it at the `'runtime'` default for
 * `*.view.ts` / `*.page.ts` surfaces (so a `data.`-rooted predicate is flagged). The
 * alias-deprecated check is layer-agnostic.
 */
export function validateVisibilityPredicates(
  stack: AnyRec,
  opts: VisibilityOptions = {},
): VisibilityFinding[] {
  const layer: VisibilityLayer = opts.layer ?? 'runtime';
  const findings: VisibilityFinding[] = [];

  // ── Views: form sections / legacy groups, and their fields ──────────
  const views = asArray(stack.views);
  for (let i = 0; i < views.length; i++) {
    const view = views[i];
    if (!view || typeof view !== 'object') continue;
    const viewName = typeof view.name === 'string' ? view.name : `(view ${i})`;
    const where = `view "${viewName}"`;

    // `sections` (canonical) and `groups` (legacy alias → sections) both hold
    // FormSection objects with an optional visibility predicate + `fields`.
    for (const bucket of ['sections', 'groups'] as const) {
      const sections = Array.isArray(view[bucket]) ? (view[bucket] as unknown[]) : [];
      for (let s = 0; s < sections.length; s++) {
        const sec = sections[s];
        if (!sec || typeof sec !== 'object') continue;
        const secPath = `views[${i}].${bucket}[${s}]`;
        checkElement(sec as AnyRec, where, secPath, layer, findings);

        const secFields = Array.isArray((sec as AnyRec).fields) ? ((sec as AnyRec).fields as unknown[]) : [];
        for (let f = 0; f < secFields.length; f++) {
          const entry = secFields[f];
          if (isFieldObject(entry)) {
            checkElement(entry, where, `${secPath}.fields[${f}]`, layer, findings);
          }
        }
      }
    }
  }

  // ── Pages: regions[].components[] ───────────────────────────────────
  const pages = asArray(stack.pages);
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page || typeof page !== 'object') continue;
    const pageName = typeof page.name === 'string' ? page.name : `(page ${i})`;
    const where = `page "${pageName}"`;
    const regions = Array.isArray(page.regions) ? (page.regions as unknown[]) : [];
    for (let r = 0; r < regions.length; r++) {
      const region = regions[r];
      const components = region && typeof region === 'object' && Array.isArray((region as AnyRec).components)
        ? ((region as AnyRec).components as unknown[])
        : [];
      for (let c = 0; c < components.length; c++) {
        const comp = components[c];
        if (comp && typeof comp === 'object') {
          checkElement(comp as AnyRec, where, `pages[${i}].regions[${r}].components[${c}]`, layer, findings);
        }
      }
    }
  }

  return findings;
}
