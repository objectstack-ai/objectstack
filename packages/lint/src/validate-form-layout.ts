// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time form-layout diagnostics (#2578).
 *
 * Authored form views carry field and field-group references that are Zod-valid
 * but can be silently wrong at render time — the "parsed, unmarked, silently
 * inert" shape ADR-0078 prohibits. This lint catches them uniformly for
 * `os build` / `os validate`, MCP authoring and hand authors (ADR-0019).
 *
 * Every rule here is a warning, not an error — nothing is fully broken (an
 * unknown field name is skipped) — but each is almost certainly an authoring
 * mistake worth surfacing at author time:
 *
 * - `form-field-unknown` — a section references a field that is not on the
 *   form's bound object, so the field silently does not render.
 * - `form-section-group-unknown` — see {@link FORM_SECTION_GROUP_UNKNOWN}.
 *
 * ## Retired: `absolute-colspan-discouraged` (#17328)
 *
 * It fired on EVERY authored `colSpan`, `colSpan: 1` included, and asserted a
 * rendering consequence: "the form's column count is derived per surface
 * (mobile 1 / modal 2 / page 3-4), so a fixed span only aligns at one width".
 * Measured in Chromium on a real authored 3-column section at all three of the
 * widths that sentence names (390 / 720 / 1700), the misalignment does not
 * happen. The span is emitted as ONE container-query-scoped class clamped to
 * the section's declared column count, so it is grid-aligned at every width and
 * rendered overflow is 0px in every configuration — including `colSpan: 4` in a
 * 3-column section, the case that would overflow if the clamp did not work. The
 * clamp is the REASON the message was false, and this file's own note above
 * already recorded the clamp: it contradicted itself.
 *
 * The hint was the sharper half. It steered authors to `span: 'full'`, and
 * `span: 'full'` and `colSpan: 4` compile to the IDENTICAL class
 * (`@2xl:col-span-3`) and measure byte-identically — the rule warned about one
 * of them and recommended the other. At the modal width `span: 'full'` renders
 * pixel-identical to writing nothing at all, so an author who complied was left
 * worse off than one who ignored it.
 *
 * With no authored `colSpan` shape left that misbehaves there was nothing to
 * re-ground, so the rule was WITHDRAWN rather than narrowed: `colSpan: 1` emits
 * no class at all (inert), a `colSpan` within the column count renders exactly
 * as authored, and one above it clamps. `colSpan` itself is untouched and still
 * parses — only the diagnostic is gone. ⛔ Do not reintroduce a colSpan warning
 * from source reading: it takes a browser measurement naming an authored shape
 * that actually misrenders, and a positive control proving the probe fires on
 * it.
 *
 * Scope: every form view reachable from a `views[]` entry — the entry itself
 * when it IS a bare form view, plus the container's default `form` and each
 * `formViews.<key>`, through the shared `view-walk.ts` ladder (#6381; see
 * {@link formViewSites} for why reading only the first shape left the rules
 * reporting clean on real app metadata, #6251). Forms embedded inside page
 * component trees are a follow-up — the walk deliberately stays shallow so it
 * never guesses at an arbitrary component's object binding.
 */

import { collectionEntries } from './collection-entries.js';
// [#13855] The field-group reference question, shared with
// `validate-page-field-bindings` so both layout escape hatches resolve a
// `section.group` against one index and report the same way.
import {
  checkSectionGroupRefs,
  indexObjectFieldGroups,
  sectionGroupRefs,
} from './object-field-groups.js';
import { formViewSites, viewObjectName } from './view-walk.js';
import { recordsOf } from './object-graph.js';

export const FORM_FIELD_UNKNOWN = 'form-field-unknown';
/**
 * [#13855] A section's `group` names a field group the bound object does not
 * declare. The reference form inherits the section's whole membership from that
 * group, so a dangling key leaves the section with no members and it does not
 * render at all. Advisory like both rules above — see `object-field-groups.ts`.
 */
export const FORM_SECTION_GROUP_UNKNOWN = 'form-section-group-unknown';

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

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The bare-form site (the `views[]` entry itself) is NOT a phantom check, and
 * the distinction is worth keeping straight where this rule reads it: strict
 * `ViewSchema` refuses a `views[]` entry carrying root `sections` — measured,
 * `unrecognized_keys` naming `sections` — so on a parsed `defineStack` config
 * only the container rungs can fire. But this rule is registered
 * `input: 'parsed'`, and `os lint` never parses: `runAuthoringRules` hands
 * `parsed` rules the NORMALIZED stack, where a raw (non-`defineStack`) config's
 * root `sections` is still present and still the author's mistake to hear about.
 *
 * The ladder itself — which rungs exist, which are filtered, and the schema
 * proof behind each — lives once in `view-walk.ts` (#6381). It used to be a
 * verbatim copy of `validate-visibility-predicates.ts`'s walker (#6248 → #6251);
 * a third independent copy in `validate-translatable-sections.ts` made three,
 * and three copies is how the next author fixes one and leaves two behind.
 */

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
 * Validate authored form-view layout. Returns findings (empty = clean).
 * Advisory only — the caller must never fail the build on these alone.
 */
export function validateFormLayout(stack: AnyRec): FormLayoutFinding[] {
  const findings: FormLayoutFinding[] = [];

  // object name → its field-name set, for reference checking.
  const objectFields = new Map<string, Set<string>>();
  for (const obj of recordsOf(stack.objects)) {
    const name = typeof obj.name === 'string' ? obj.name : undefined;
    if (!name) continue;
    const fields = (obj.fields && typeof obj.fields === 'object' && !Array.isArray(obj.fields))
      ? Object.keys(obj.fields as AnyRec)
      : [];
    objectFields.set(name, new Set(fields));
  }
  // [#13855] object name → its declared field-group keys, for `section.group`.
  const objectFieldGroups = indexObjectFieldGroups(stack);

  for (const { rec: view, path: viewPath } of collectionEntries(stack.views, 'views')) {
    // A container names itself with `name`, or binds with `object` — and an
    // artifact-emitted one may carry neither, so the path is the last resort.
    const viewName = strName(view.name) ?? strName(view.object) ?? viewPath;
    const containerObject = viewObjectName(view);
    // [#16168] A container whose object lives on the LIST block
    // (`list.data.object`, `list.object` or `list.objectName` — any anchor
    // `viewObjectName` reads) has no `object` / `objectName` / `data.object` of
    // its own, so `containerObject` above is `undefined` and every site under it
    // — including the container's own default `form` — was unreferenceable.
    // Same third rung `validate-translatable-sections.ts:178-179` already
    // carries for its own sites.
    const listBinding = isRec(view.list) ? viewObjectName(view.list) ?? containerObject : undefined;

    for (const site of formViewSites(view, viewPath)) {
      // A sub-container declares its own binding (`form.data.object`) and
      // otherwise inherits the container's, then the container's list-bound
      // object as a last resort (#16168) — the resolution order every other
      // view-walking rule in this package uses. The base rung is the shared
      // `viewObjectName` (#6662); this FALLBACK is deliberately NOT folded into
      // the shared walker, because the consumers compose it differently (see
      // `view-walk.ts`) and a refactor that changes a verdict is a failed
      // refactor.
      const objName = viewObjectName(site.view) ?? containerObject ?? listBinding;
      // Only reference-check when the bound object resolves; otherwise we can't.
      const known = objName ? objectFields.get(objName) : undefined;
      const where = site.surface ? `view "${viewName}" · ${site.surface}` : `view "${viewName}"`;

      // `sections` (canonical) and `groups` (legacy alias → sections,
      // `view.zod.ts:1624`) both hold FormSection objects. Reading both is what
      // #6248 does on this surface, for the same reason: a rule that judges only
      // the canonical spelling is silent on the legacy one, which is exactly the
      // half-coverage this issue is about.
      for (const bucket of ['sections', 'groups'] as const) {
        const sections = Array.isArray(site.view[bucket]) ? (site.view[bucket] as unknown[]) : [];

        // ── (c) [#13855] a section's `group` names a declared field group ──
        // Both buckets, for the reason (a) reads both: a rule that judges only
        // the canonical spelling is silent on the legacy one.
        findings.push(
          ...checkSectionGroupRefs(
            sectionGroupRefs(sections, `${site.path}.${bucket}`),
            objName,
            objectFieldGroups,
            where,
            FORM_SECTION_GROUP_UNKNOWN,
          ),
        );

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
          }
        }
      }
    }
  }

  return findings;
}
