// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which forms a `view` body opens to anonymous intake — the candidates half of
 * the ONE rule.
 *
 * A form candidate is open to anonymous intake when its `sharing` (the
 * `SharingConfigSchema`, `sharing.zod.ts` beside this module) declares all three of:
 *
 * - `enabled === true` — "Enable public sharing". The schema defaults it to
 *   `false`, and a parsed body carries that default, so an absent `enabled`
 *   reads as not shared here too: a raw body and its parsed form get the same
 *   answer.
 * - `allowAnonymous === true` — "Allow access without authentication".
 * - a non-empty `publicLink` naming the slug.
 *
 * Clearing either switch withdraws the form from every anonymous door.
 *
 * The candidates are the three shapes a view carries a form in, scanned in
 * this order: the nested `form`, every `formViews` entry, and the flattened
 * `config` of a `viewKind: 'form'` item.
 *
 * ## Why this half lives in `packages/spec`
 *
 * `expandViewContainer` (`view.zod.ts`) is the placement precedent: a pure
 * helper beside the schema it serves. Prime Directive 2 (no business logic in
 * `packages/spec`) holds as ADR-0053 D-D2 reads it: a pure helper that states
 * what the contract's own vocabulary denotes is protocol, not business logic,
 * and a server package re-exports it. The reason two independent codebases
 * must agree on this rule byte for byte is the triage ruling on
 * objectui#11545 (`5967405932`): the console derives "published" from the
 * server's one rule, never from a hand-copied second one. The server's
 * anonymous form doors (`registerFormEndpoints` in `@objectstack/rest`) and the
 * write-time judgement of an organization-scoped `view` write
 * (`@objectstack/metadata-protocol`) serve exactly the candidates this module
 * returns; a console that lists which forms are published imports the same
 * functions instead of re-reading the sharing keys.
 * `@objectstack/metadata-core` re-exports these bindings (the same functions,
 * not a copy), so the server packages keep importing them from there.
 *
 * ## What stays in `@objectstack/metadata-core`
 *
 * The halves that read server state: a withdrawal in another metadata layer
 * (`anonymousFormIntakeWithdrawnIn`, a kill switch that layering may only
 * narrow, never re-open), and whether the deployment's tenancy posture lets an
 * open form take an anonymous submission (`anonymousFormIntakeUnavailability`).
 * Kept beside them is the object a candidate submits into
 * (`anonymousFormObjectName`): a pure read of the form's `data.object` and the
 * view's `list.data.object`, `form.data.object` and `object`, which reads no
 * server state and stays there because that is where this export's surface
 * was drawn. An open candidate here is therefore what the view body itself
 * declares, before any other layer or the posture is consulted.
 *
 * Pure functions with no imports and no module-load work: this module links no
 * schema, so a browser bundle that reaches it pays for these functions alone.
 */

/** A form candidate of a view that is open to anonymous intake. */
export interface AnonymousFormIntakeCandidate {
  /** The form view object (the nested `form`, a `formViews` entry, or the flattened `config`). */
  form: Record<string, any>;
  /** The `formViews` key, or the view name for a flattened `viewKind: 'form'` item. */
  key?: string;
  /** The slug its `publicLink` names, normalised (`/forms/x`, `forms/x` and `x` are one slug). */
  slug: string;
}

/** Normalise a `publicLink` to the slug the doors compare: `/forms/x`, `forms/x` and `x` are one slug. */
export function publicFormSlug(publicLink: string): string {
  return publicLink.replace(/^\/+/, '').replace(/^forms\//, '');
}

/** The slug a form's `sharing` opens to anonymous intake, or `null` when it opens none. */
export function anonymousFormIntakeSlug(sharing: unknown): string | null {
  if (!sharing || typeof sharing !== 'object') return null;
  const s = sharing as Record<string, unknown>;
  if (s.enabled !== true) return null;
  if (s.allowAnonymous !== true) return null;
  if (typeof s.publicLink !== 'string' || !s.publicLink) return null;
  return publicFormSlug(s.publicLink);
}

/** Every form candidate of a `view` body that is open to anonymous intake, in scan order. */
export function anonymousFormIntakeCandidates(view: unknown): AnonymousFormIntakeCandidate[] {
  if (!view || typeof view !== 'object') return [];
  const v = view as Record<string, any>;
  const forms: Array<{ form: unknown; key?: string }> = [];
  if (v.form && typeof v.form === 'object') forms.push({ form: v.form });
  if (v.formViews && typeof v.formViews === 'object') {
    for (const [key, fv] of Object.entries(v.formViews)) forms.push({ form: fv, key });
  }
  if (v.viewKind === 'form' && v.config && typeof v.config === 'object') {
    forms.push({ form: v.config, key: v.name });
  }
  const open: AnonymousFormIntakeCandidate[] = [];
  for (const { form, key } of forms) {
    if (!form || typeof form !== 'object') continue;
    const slug = anonymousFormIntakeSlug((form as Record<string, unknown>).sharing);
    if (slug === null) continue;
    open.push({ form: form as Record<string, any>, ...(key !== undefined ? { key } : {}), slug });
  }
  return open;
}

/**
 * The sorted, de-duplicated slug set a `view` body opens to anonymous intake.
 * Two bodies with the same set open exactly the same anonymous doors.
 */
export function anonymousFormIntakeSlugs(view: unknown): string[] {
  return [...new Set(anonymousFormIntakeCandidates(view).map((c) => c.slug))].sort();
}
