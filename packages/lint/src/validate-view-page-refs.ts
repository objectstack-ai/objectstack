// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13216 — reference resolvability] A `type: 'page'` list view's `pageName`
 * must name a page the stack actually declares.
 *
 * ## What the schema already settles, and what it cannot
 *
 * `ListViewSchema`'s `checkListViewPageMount` refuses a `page` view with no
 * `pageName`, refuses `pageName` on any other view type, and refuses a
 * `pageName` outside `SnakeCaseIdentifierSchema`'s grammar — so by the time a
 * body reaches here the key is present, well-formed, and on the one view type
 * that reads it. What a per-body parse cannot ask is whether the page EXISTS,
 * because the answer lives in a sibling collection the body never sees. That is
 * this rule's whole question, and it is the same question
 * `validate-nav-target-refs` asks about the identical reference one surface
 * over — `{ type: 'page', pageName }` on an app navigation item.
 *
 * ## Severity: warning, for its twin's reason
 *
 * `validate-nav-target-refs` explains why the honest ceiling for a page
 * reference is advisory: unlike objects, pages have no curated
 * cross-package registry, so "unresolved here" cannot be told apart from
 * "provided by a package this stack cannot see". Nothing about mounting the
 * same page on a view changes that, so the verdict matches its twin rather
 * than inventing a second severity for one reference kind. `defineStack`'s
 * `validateCrossReferences` still hard-fails first whenever the stack DOES
 * declare pages — this rule is what speaks when that check has switched itself
 * off (`pageNames.size > 0`), which is exactly the state a stack is in when
 * the target was never written.
 *
 * ## Why it runs at the runtime publish gate too (`runtimeTypes: view`)
 *
 * The mount this rule guards is reachable in exactly the way #13100 measured:
 * an agent publishes a page through the metadata API, then writes a view that
 * mounts it. Both writes go through `PUT /api/v1/meta/view` — no CLI is
 * involved anywhere on that path, so a build-time-only rule would never speak
 * to the author who needs it. Crossing the member onto `view` snapshots is
 * therefore the point, not a bonus.
 *
 * It is safe to cross ONLY because the per-write snapshot now carries `pages`
 * (`RuntimeStackContext.pages`, added with this rule). Without that collection
 * the member would not go quiet — it would report EVERY page mount as dead,
 * which is the missing-collection false-positive channel
 * `ReferenceIntegrityRule.runtimeTypes` exists to keep closed, and the reason
 * `validateNavTargetRefs` is NOT crossed: nothing carries a snapshot's `apps`.
 *
 * ## The rungs, and why the list matches the sort rule's
 *
 * A `pageName` can be authored on every shape that carries a list view, and the
 * #9313 lesson is that declaring `runtimeTypes` is necessary and NOT sufficient
 * — the WALK has to reach the flattened top-level shape the write door actually
 * carries, or the crossing is a silent no-op that reads as coverage. So the
 * rungs are `validate-sortable-fields`' rungs, one key over:
 *
 *   - `objects[].listViews.<key>` — built-in named list views;
 *   - `views[]` itself on a FLATTENED LIST OVERLAY (`viewKind: 'list'`, no
 *     nested `config`) — the shape the runtime gate snapshots as `views: [item]`;
 *   - `views[].config` on a standalone ViewItem RECORD (`viewKind: 'list'` with
 *     a record-shaped `config`) — the shape a Studio-saved view round-trips as;
 *   - `views[].list` — a `defineView` aggregate's default list;
 *   - `views[].listViews.<key>` — its named list views.
 *
 * ## Not covered, deliberately
 *
 * An interpolated target (`${…}`) resolves at render time and is skipped — the
 * conservative exemption `validate-nav-target-refs` and
 * `validate-object-references` both use (ADR-0072 D1). It cannot currently
 * arise (the schema's snake_case grammar refuses `$` and `{`), and is kept so
 * this rule does not become the thing that has to change if the grammar ever
 * widens.
 *
 * The view's `type` is NOT re-checked here. A body reaching a CLI command has
 * been parsed; a body reaching `os lint` may not have been, and in that state
 * reading `pageName` wherever it is written is the more useful answer — a
 * `pageName` on a `grid` view is a schema refusal, not this rule's business,
 * and reporting the dead reference underneath it as well helps rather than
 * misleads.
 */

import type { ReferenceIntegrityFinding } from './reference-integrity-suite.js';

export type ViewPageRefSeverity = 'error' | 'warning';
export type ViewPageRefFinding = ReferenceIntegrityFinding;

/** Emitted when a `type: 'page'` view mounts a page the stack cannot resolve. */
export const VIEW_PAGE_UNRESOLVED = 'view-page-unresolved';

type AnyRec = Record<string, unknown>;

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/** Coerce an array-or-name-keyed-map collection to an array (name injected). */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v.filter(isRec);
  if (isRec(v)) return Object.entries(v).map(([name, def]) => (isRec(def) ? { name, ...def } : { name }));
  return [];
}

/** See the module docblock — an interpolated target resolves at render time. */
const isInterpolated = (s: string): boolean => s.includes('${') || s.includes('{');

function declaredPageNames(stack: AnyRec): Set<string> {
  const out = new Set<string>();
  for (const page of asArray(stack.pages)) {
    const n = strName(page.name);
    if (n) out.add(n);
  }
  return out;
}

export function validateViewPageRefs(stack: unknown): ViewPageRefFinding[] {
  const findings: ViewPageRefFinding[] = [];
  if (!isRec(stack)) return findings;

  const pages = declaredPageNames(stack);

  const check = (listView: unknown, where: string, path: string): void => {
    if (!isRec(listView)) return;
    const target = strName(listView.pageName);
    if (!target || isInterpolated(target)) return;
    if (pages.has(target)) return;

    const emptyCollection = pages.size === 0;
    findings.push({
      severity: 'warning',
      rule: VIEW_PAGE_UNRESOLVED,
      where,
      path: `${path}.pageName`,
      message:
        `This view mounts page '${target}', which this stack does not declare in \`pages\`. `
        + (emptyCollection
          ? 'The stack declares NO pages at all, so `defineStack`\'s own cross-reference check '
            + 'skipped this entry entirely (it is gated on `pageNames.size > 0`) — nothing else '
            + 'will report it. '
          : '')
        + 'The view appears in the object\'s view switcher and renders nothing when opened: a '
        + '`page` view has no rows of its own to fall back to. If another package provides this '
        + 'page, this is expected and advisory only.',
      hint:
        `Declare the page in \`pages\`, correct \`pageName\`, or change the view's \`type\` away `
        + 'from `page` if the mount is no longer wanted.',
    });
  };

  // ── The object's built-in named list views ──
  for (const [oi, obj] of asArray(stack.objects).entries()) {
    const objName = strName(obj.name);
    const label = objName ? `object "${objName}"` : `objects[${oi}]`;
    if (!isRec(obj.listViews)) continue;
    for (const [key, lv] of Object.entries(obj.listViews)) {
      check(lv, `${label} › listViews.${key}`, `objects[${oi}].listViews.${key}`);
    }
  }

  // ── `views[]`: the flattened overlay / ViewItem record / container rungs ──
  const views = Array.isArray(stack.views) ? (stack.views as unknown[]) : [];
  for (const [vi, view] of views.entries()) {
    if (!isRec(view)) continue;
    const viewLabel = strName(view.name) ?? strName(view.objectName) ?? `#${vi}`;

    if (view.viewKind === 'list' && !isRec(view.config)) {
      check(view, `view "${viewLabel}" (flattened list overlay)`, `views[${vi}]`);
    }
    if (view.viewKind === 'list' && isRec(view.config)) {
      check(view.config, `view "${viewLabel}" (ViewItem record)`, `views[${vi}].config`);
    }
    if (isRec(view.list)) {
      check(view.list, `view "${viewLabel}" › list`, `views[${vi}].list`);
    }
    if (isRec(view.listViews)) {
      for (const [key, lv] of Object.entries(view.listViews)) {
        check(lv, `view "${viewLabel}" › listViews.${key}`, `views[${vi}].listViews.${key}`);
      }
    }
  }

  return findings;
}
