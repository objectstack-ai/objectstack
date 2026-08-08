// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time form-layout diagnostics (#2578).
 *
 * Authored form views carry field references and column-layout hints that are
 * Zod-valid but can be silently wrong at render time — the "parsed, unmarked,
 * silently inert" shape ADR-0078 prohibits. This lint catches the two that
 * matter for multi-column, AI-authored forms, uniformly for `os build` /
 * `os validate`, MCP authoring and hand authors (ADR-0019).
 *
 * Both rules are warnings, not errors — nothing is fully broken (an unknown
 * field name is skipped; an over-wide colSpan is clamped) — but each is almost
 * certainly an authoring mistake worth surfacing at author time:
 *
 * - `form-field-unknown` — a section references a field that is not on the
 *   form's bound object, so the field silently does not render.
 * - `absolute-colspan-discouraged` — a field uses the absolute `colSpan`. Under
 *   a per-surface DERIVED column count (mobile 1 / modal 2 / page 3-4) a fixed
 *   span only lines up at the one width the author imagined; the renderer
 *   clamps it. The robust primitive is the relative `span: 'full'`.
 *
 * Scope: every form view reachable from a `views[]` entry — the entry itself
 * when it IS a bare form view, plus the container's default `form` and each
 * `formViews.<key>` (see {@link formViewSites} for why reading only the first
 * shape left both rules reporting clean on real app metadata, #6251). Forms
 * embedded inside page component trees are a follow-up — the walker
 * deliberately stays shallow so it never guesses at an arbitrary component's
 * object binding.
 */

export const FORM_FIELD_UNKNOWN = 'form-field-unknown';
export const FORM_COLSPAN_ABSOLUTE = 'absolute-colspan-discouraged';

export type FormLayoutSeverity = 'error' | 'warning';

export interface FormLayoutFinding {
  /** Always `warning` today — both rules are advisory (see module note). */
  severity: FormLayoutSeverity;
  /** Diagnostic rule id, e.g. `form-field-unknown`. */
  rule: string;
  /** Human-readable location, e.g. `view "contract_form" · formViews.create`. */
  where: string;
  /** Config path, e.g. `views[2].formViews.create.sections[0].fields[3]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Every record in a collection authored either as an array or as a name-keyed
 * map, each with its config PATH — `views[2]` for the array shape,
 * `views.contact_views` for the map. Findings here are consumed as edit targets
 * (`os lint --json`, Studio's finding renderer), so a map-shaped collection must
 * not report a synthetic index nobody can look up. Same helper, same reasoning
 * as `validate-visibility-predicates.ts` and `validate-translatable-sections.ts`.
 */
function collectionEntries(v: unknown, base: string): Array<{ rec: AnyRec; path: string }> {
  if (Array.isArray(v)) {
    const out: Array<{ rec: AnyRec; path: string }> = [];
    for (let i = 0; i < v.length; i++) {
      if (isRec(v[i])) out.push({ rec: v[i] as AnyRec, path: `${base}[${i}]` });
    }
    return out;
  }
  if (isRec(v)) {
    return Object.entries(v)
      .filter(([, def]) => isRec(def))
      .map(([name, def]) => ({ rec: { name, ...(def as AnyRec) }, path: `${base}.${name}` }));
  }
  return [];
}

/**
 * Every FORM VIEW reachable from one `views[]` entry, with the path each sits at.
 *
 * **Copied from `validate-visibility-predicates.ts`'s `formViewSites` (#6248)**
 * rather than re-derived: that file fixed this exact traversal hole on the
 * sibling rule one PR earlier, and a second hand-rolled ladder is how two rules
 * on one surface start disagreeing about which forms exist. The only thing added
 * here is the object binding each site inherits (below) — this rule resolves a
 * field reference, the visibility rules do not.
 *
 * Two shapes, and reading only the first is how BOTH rules in this file were
 * dead on real app metadata until #6251 measured it. `os build` on
 * `examples/app-showcase` emits its form sections at
 * `views[0].formViews.edit.sections[…]`; the traversal read `views[0].sections`,
 * found nothing, and reported clean on a stack that DOES carry form sections:
 *
 *  - **View CONTAINER** (the runtime app shape). `ViewSchema` declares exactly
 *    `name` / `label` / `object` / `list` / `form` / `listViews` / `formViews`
 *    (`view.zod.ts:1890-1903` — the strict error map spells the container's own
 *    keys out in prose). Form sections therefore live one level down, under
 *    `form` and each `formViews.<key>`.
 *  - **A bare FORM VIEW** (`FormViewSchema`, `view.zod.ts:1623-1624`), whose
 *    `sections` / `groups` sit at the top.
 *
 * `list` / `listViews.<key>` are `ObjectListViewSchema`
 * (`view.zod.ts:1838` — `ListViewSchema` minus `userFilters`) and carry no
 * `sections` at all, so they are deliberately NOT walked. This is the one point
 * where the other in-repo ladder, `validate-translatable-sections.ts`'s
 * `collectViewSites`, is wider: it also visits `listViews.*.sections`. Measured
 * against the schema, that rung can only ever read `undefined` — it costs
 * nothing there and buys nothing here, so the narrower #6248 ladder is the one
 * copied. Both agree on every rung that can hold a section.
 *
 * `objects[].views` is deliberately absent for the reason #6248 states:
 * `object.zod.ts:1833` tombstones the key by name ("`views` is not an
 * ObjectSchema field"), so a branch keyed on it could only fire for stacks the
 * schema already rejects — the phantom check #4984 / #5017 removed elsewhere.
 *
 * The bare-form site (the entry itself) is NOT such a phantom, and the
 * distinction is worth keeping straight: strict `ViewSchema` refuses a `views[]`
 * entry carrying root `sections` — measured, `unrecognized_keys` naming
 * `sections` — so on a parsed `defineStack` config only the container rungs can
 * fire. But this rule is registered `input: 'parsed'`, and `os lint` never
 * parses: `runAuthoringRules` hands `parsed` rules the NORMALIZED stack, where a
 * raw (non-`defineStack`) config's root `sections` is still present and still
 * the author's mistake to hear about.
 */
function formViewSites(
  view: AnyRec,
  basePath: string,
): Array<{ form: AnyRec; path: string; surface: string }> {
  // `surface` names the sub-container in the human-readable `where`. It earns
  // its place on exactly the shape this traversal was extended for: a runtime
  // container carries neither `name` nor `object` in the emitted artifact, so
  // without it every finding under one view reads `view "views[0]"` and the
  // author cannot tell the `edit` form from the `create` one.
  const sites = [{ form: view, path: basePath, surface: '' }];
  const dflt = view.form;
  if (isRec(dflt)) {
    sites.push({ form: dflt, path: `${basePath}.form`, surface: 'form' });
  }
  const named = view.formViews;
  if (isRec(named)) {
    for (const [key, sub] of Object.entries(named)) {
      if (isRec(sub)) {
        sites.push({ form: sub, path: `${basePath}.formViews.${key}`, surface: `formViews.${key}` });
      }
    }
  }
  return sites;
}

/** A section field entry is either a bare field name or `{ field, colSpan, … }`. */
function fieldNameOf(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.length > 0 ? entry : null;
  if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
    const f = (entry as AnyRec).field;
    return typeof f === 'string' && f.length > 0 ? f : null;
  }
  return null;
}

/**
 * The object a view — or one of its sub-containers — binds to, across the shapes
 * it is authored in.
 *
 * The ladder is `objectName` → `object` → `data.object`, identical to
 * `validate-translation-references.ts` and `validate-translatable-sections.ts`'s
 * `viewObjectName` (and to the CLI i18n walker's), so all of them agree on which
 * object a form belongs to. On the canonical container shape the binding lives
 * INSIDE the sub-container (`form.data.object`) while the container itself
 * carries `object`, which is why the caller resolves the site first and falls
 * back to the container — a record-level lookup alone resolves to nothing on the
 * shape real apps ship.
 *
 * `name` is deliberately NOT a rung. A stack-level container's `name` may be the
 * object name (`view.zod.ts` says so for object-scoped containers), but a form
 * view's `name` is its own — `contract_form`, not `contract` — and reading it
 * here would bind the wrong object and report every field on the form as unknown.
 */
function boundObject(view: AnyRec): string | undefined {
  return (
    strName(view.objectName) ??
    strName(view.object) ??
    (isRec(view.data) ? strName(view.data.object) : undefined)
  );
}

/**
 * Validate authored form-view layout. Returns findings (empty = clean).
 * Advisory only — the caller must never fail the build on these alone.
 */
export function validateFormLayout(stack: AnyRec): FormLayoutFinding[] {
  const findings: FormLayoutFinding[] = [];

  // object name → its field-name set, for reference checking.
  const objectFields = new Map<string, Set<string>>();
  for (const obj of asArray(stack.objects)) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const fields = (obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields))
      ? Object.keys(obj.fields as AnyRec)
      : [];
    objectFields.set(name, new Set(fields));
  }

  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    // A container names itself with `name`, or binds with `object` — and an
    // artifact-emitted one may carry neither, so the path is the last resort.
    const viewName = strName(view.name) ?? strName(view.object) ?? viewPath;
    const containerObject = boundObject(view);

    for (const site of formViewSites(view, viewPath)) {
      // A sub-container declares its own binding (`form.data.object`) and
      // otherwise inherits the container's — the resolution order every other
      // view-walking rule in this package uses.
      const objName = boundObject(site.form) ?? containerObject;
      // Only reference-check when the bound object resolves; otherwise we can't.
      const known = objName ? objectFields.get(objName) : undefined;
      const where = site.surface ? `view "${viewName}" · ${site.surface}` : `view "${viewName}"`;

      // `sections` (canonical) and `groups` (legacy alias → sections,
      // `view.zod.ts:1624`) both hold FormSection objects. Reading both is what
      // #6248 does on this surface, for the same reason: a rule that judges only
      // the canonical spelling is silent on the legacy one, which is exactly the
      // half-coverage this issue is about.
      for (const bucket of ['sections', 'groups'] as const) {
        const sections = Array.isArray(site.form[bucket]) ? (site.form[bucket] as unknown[]) : [];

        for (let s = 0; s < sections.length; s++) {
          const sec = sections[s];
          const secFields = isRec(sec) && Array.isArray(sec.fields) ? (sec.fields as unknown[]) : [];
          for (let f = 0; f < secFields.length; f++) {
            const entry = secFields[f];
            const fname = fieldNameOf(entry);
            const fpath = `${site.path}.${bucket}[${s}].fields[${f}]`;

            // ── (a) section field references a real field on the bound object ──
            if (fname && known && !known.has(fname)) {
              findings.push({
                severity: 'warning',
                rule: FORM_FIELD_UNKNOWN,
                where,
                path: fpath,
                message:
                  `${viewName}: field "${fname}" is not a field on object "${objName}" — ` +
                  `it is silently skipped and never renders on the form`,
                hint:
                  `Fix the field name, or add "${fname}" to ${objName}. Section field ` +
                  `references must match the object's field names exactly.`,
              });
            }

            // ── (b) absolute colSpan → steer to the surface-independent span ──
            const colSpan = isRec(entry) ? entry.colSpan : undefined;
            if (colSpan != null) {
              findings.push({
                severity: 'warning',
                rule: FORM_COLSPAN_ABSOLUTE,
                where,
                path: `${fpath}.colSpan`,
                message:
                  `${viewName}: field "${fname ?? '?'}" sets absolute colSpan ${String(colSpan)} — ` +
                  `the form's column count is derived per surface (mobile 1 / modal 2 / page 3-4), ` +
                  `so a fixed span only aligns at one width`,
                hint:
                  `Prefer span: 'full' (whole row at any column count), or omit for auto ` +
                  `width. The renderer clamps colSpan to the current column count.`,
              });
            }
          }
        }
      }
    }
  }

  return findings;
}
