// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared view-container traversal (issue #6381) — the one descent from a
 * `views[]` entry down to the records that can actually carry `sections`.
 *
 * This walk had grown THREE independent implementations in this package, and
 * the same rung was measured missing twice in two consecutive issues. Both
 * times the traversal read only the container's own keys and therefore reported
 * clean on real app metadata: `os build` on `examples/app-showcase` emits its
 * form sections at `views[0].formViews.edit.sections[…]`, and a walker that
 * reads `views[0].sections` finds nothing there.
 *
 *   - `validate-visibility-predicates.ts` — hole found by #6128, fixed by #6248.
 *   - `validate-form-layout.ts` — same hole, same rule family, found by #6251,
 *     fixed by copying #6248's walker verbatim one PR later.
 *   - `validate-translatable-sections.ts` — a third, independently written
 *     ladder (`collectViewSites`) that happened to agree on every rung that can
 *     hold a section.
 *
 * Copying the fixed walker was the cheapest move each time. The copy COUNT is
 * the argument for this file: with three, the next author fixes one of three,
 * and the two survivors keep the old verdict. `page-walk.ts` says the same
 * thing about page components (#3583) and is the model followed here.
 *
 * ## The ladder, rung by rung, and what the schema says about each
 *
 * A `views[]` entry is authored in one of two shapes, and the rungs below cover
 * both:
 *
 *  - **View CONTAINER** (the runtime app shape). `ViewSchema`
 *    (`packages/spec/src/ui/view.zod.ts:1885`) is a `strictObject` whose own
 *    keys are `name` / `label` / `object` / `list` / `form` / `listViews` /
 *    `formViews` (`view.zod.ts:1926-1929`). Sections therefore live one level
 *    down.
 *  - **A bare FORM VIEW** (`FormViewSchema`, `view.zod.ts:1599`), whose
 *    `sections` (`:1649`) and `groups` (`:1650`, the legacy alias) sit at the
 *    top. This is the `defineForm` shape the `*.form.ts` metadata-editing forms
 *    use.
 *
 * | rung | `kind` | why it is walked |
 * | --- | --- | --- |
 * | the entry itself | `self` | the bare `FormViewSchema` shape |
 * | `form` | `form` | the container's DEFAULT form (#5415) |
 * | `listViews.<key>` | `listView` | `objects[].listViews` / container list views — see below |
 * | `formViews.<key>` | `formView` | the named form views #6128 / #6251 both missed |
 *
 * ### `form` — the default anchor, established deliberately (#5415)
 *
 * The container's `form` is the one `defineView({ form: … })` declares and
 * `ObjectForm` renders when no named form view is asked for. It is neither a
 * `formViews.*` entry nor the record's own `sections`, so a walker that
 * enumerates only those two misses it — which is exactly what #5415 measured
 * against `examples/app-showcase`'s `contact.view.ts`: four correctly
 * translated section headings reported as stale keys. All three ladders walk
 * this rung today and it must stay walked.
 *
 * ### `listViews.<key>` — kept, and why it is not deleted as dead
 *
 * A list view carries no sections. `ObjectListViewSchema`
 * (`view.zod.ts:1864-1865`) is `ListViewSchema.omit({ userFilters })` re-extended
 * with a narrowed `userFilters`, and `ListViewSchema` (`view.zod.ts:1067`) is a
 * `strictObject` that declares no `sections` and no `groups` — the only
 * declaration of either key in the file is on `FormViewSchema` (`:1649-1650`).
 * So on a schema-VALID stack `listViews.<key>.sections` can only read
 * `undefined`, and `list` is the same schema for the same reason.
 *
 * That proof is why the two form-layout/visibility rules filter this rung out
 * (see {@link formViewSites}) rather than paying for a descent that cannot
 * produce a finding. It is NOT a licence to drop the rung from the walker:
 *
 *  - `validate-translatable-sections.ts` declares `objects[].listViews` as part
 *    of its section face in its own module docblock, and reaches it by handing
 *    this walker a synthesised `{ object, listViews }` container. Removing the
 *    rung would silently narrow a documented surface.
 *  - `os lint` runs authoring rules over the NORMALIZED stack, not a parsed one
 *    (`runAuthoringRules`), so a raw, non-`defineStack` config's off-spec
 *    `listViews.x.sections` is still present in memory when the rule runs.
 *
 * Both facts point the same way: yield the rung, tag it, and let each consumer
 * decide. The union is the safe shape here — an intersection would have deleted
 * a step someone established on purpose, which is the "next person edits only
 * one copy" failure this file exists to prevent, inverted.
 *
 * ### `objects[].views` — deliberately NOT a rung
 *
 * `packages/spec/src/data/object.zod.ts:1873` tombstones the key by name
 * ("`views` is not an ObjectSchema field"), so a branch keyed on it could only
 * ever fire for stacks the schema already rejects by name — the phantom check
 * #4984 / #5017 removed from two neighbouring rules.
 *
 * ## What this walker does NOT decide
 *
 * **Which bucket to read.** A site is handed back as a RECORD, not as its
 * `sections` array: `validate-visibility-predicates` and `validate-form-layout`
 * read both `sections` and `groups` (the legacy alias, `view.zod.ts:1650`),
 * while `validate-translatable-sections` reads `sections` only. Yielding the
 * record keeps that a consumer's choice instead of freezing one rule's answer
 * into the shared walk.
 *
 * **How a site's binding is COMPOSED.** The BASE ladder — which keys on ONE
 * record name an object — is shared, and lives here as {@link viewObjectName}
 * (#6662). What each consumer wraps around it is its own and stays its own:
 * `validate-form-layout` falls back to the container,
 * `validate-translatable-sections` falls back to the container and then to the
 * default `list`'s binding, `validate-translation-references` falls back to the
 * record, and `validate-visibility-predicates` needs no binding at all. Folding
 * those fallbacks into one walk would change verdicts, which a refactor may not
 * do; sharing the rung they all start from cannot.
 */

type AnyRec = Record<string, unknown>;

/** Which rung of the container ladder a site sits on. */
export type ViewSiteKind = 'self' | 'form' | 'listView' | 'formView';

/** One record on the ladder, with everything a rule needs to locate it. */
export interface ViewSite {
  /** The record itself — the `views[]` entry, or one of its sub-containers. */
  view: AnyRec;
  /**
   * Config path of that record — `views[0]`, `views[0].form`,
   * `views[0].formViews.edit`. Consumers append the bucket they read
   * (`.sections`, `.groups[2].fields[1]`, …); findings are consumed as edit
   * targets (`os lint --json`, Studio's finding renderer), so the path has to
   * be one an author can actually look up.
   */
  path: string;
  /**
   * The sub-container segment for a human-readable `where`, WITHOUT the view's
   * own name — `''` for the entry itself, else `form` / `formViews.edit` /
   * `listViews.all`. It earns its place on exactly the shape this traversal was
   * extended for: a runtime container carries neither `name` nor `object` in
   * the emitted artifact, so without it every finding under one view reads
   * `view "views[0]"` and the author cannot tell the `edit` form from the
   * `create` one.
   */
  surface: string;
  /** Which rung this is — see {@link ViewSiteKind}. */
  kind: ViewSiteKind;
}

function isRec(v: unknown): v is AnyRec {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function strName(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * The object ONE record — a `views[]` entry, or one of its sub-containers —
 * binds to, across the shapes it is authored in: `objectName` → `object` →
 * `data.object`.
 *
 * This is the BASE rung only. It had three byte-identical copies under two
 * names (#6662): `boundObject` in `validate-form-layout.ts`, `viewObjectName`
 * in `validate-translatable-sections.ts` and in
 * `validate-translation-references.ts`. The majority spelling wins here, and it
 * is also the CLI i18n extractor's (`packages/cli/src/utils/i18n-extract.ts`)
 * and the spec resolver's (`packages/spec/src/system/i18n-resolver.ts`), so
 * every walker in the repo now agrees on which object a record belongs to by
 * reading the same four lines. Disagreeing here would mean warning about the
 * wrong object — a container retargeted at another object keys its headings
 * there.
 *
 * What is NOT folded in is the per-rule FALLBACK composition (see the module
 * docblock): on the canonical container shape the binding lives INSIDE the
 * sub-container (`form.data.object` / `list.data.object`) while the container
 * itself carries `object`, so each rule resolves the site first and then falls
 * back its own way. A record-level lookup alone resolves to nothing on the
 * shape real apps ship.
 *
 * `name` is deliberately NOT a rung. A stack-level container's `name` may be
 * the object name (`view.zod.ts` says so for object-scoped containers), but a
 * form view's `name` is its own — `contract_form`, not `contract` — and reading
 * it here would bind the wrong object and report every field on the form as
 * unknown.
 */
export function viewObjectName(view: AnyRec): string | undefined {
  return (
    strName(view.objectName) ??
    strName(view.object) ??
    (isRec(view.data) ? strName(view.data.object) : undefined)
  );
}

/**
 * EVERY site one `views[]` entry can carry sections on, in ladder order:
 * the entry itself, its default `form`, its `listViews.*`, its `formViews.*`.
 *
 * `basePath` is the caller's path prefix for the entry (e.g. `views[3]`).
 *
 * Order is part of the contract, not an accident: findings are emitted in walk
 * order, so a consumer's output order is this array's order.
 */
export function viewContainerSites(view: AnyRec, basePath: string): ViewSite[] {
  // Defensive, and unreachable from the three in-repo callers — all of them
  // arrive through a `collectionEntries` helper that yields records only. Same
  // guard `page-walk.ts` opens with.
  if (!isRec(view)) return [];

  const sites: ViewSite[] = [{ view, path: basePath, surface: '', kind: 'self' }];

  if (isRec(view.form)) {
    sites.push({ view: view.form, path: `${basePath}.form`, surface: 'form', kind: 'form' });
  }

  for (const key of ['listViews', 'formViews'] as const) {
    const container = view[key];
    if (!isRec(container)) continue;
    const kind: ViewSiteKind = key === 'listViews' ? 'listView' : 'formView';
    for (const [subKey, sub] of Object.entries(container)) {
      if (!isRec(sub)) continue;
      sites.push({
        view: sub,
        path: `${basePath}.${key}.${subKey}`,
        surface: `${key}.${subKey}`,
        kind,
      });
    }
  }

  return sites;
}

/**
 * The FORM-carrying subset of {@link viewContainerSites}: the entry itself, the
 * default `form`, and each `formViews.<key>`.
 *
 * `list` / `listViews.<key>` are `ObjectListViewSchema` and declare no
 * `sections` (proof in the module docblock), so a rule that judges form
 * sections gains nothing by descending them. This is the shape
 * `validate-visibility-predicates` and `validate-form-layout` consume; it is a
 * FILTER over the one ladder rather than a second ladder, so a rung that breaks
 * here breaks for every consumer at once.
 */
export function formViewSites(view: AnyRec, basePath: string): ViewSite[] {
  return viewContainerSites(view, basePath).filter((site) => site.kind !== 'listView');
}
