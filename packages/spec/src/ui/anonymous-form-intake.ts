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
 * ## The withdrawal half
 *
 * Whether a metadata layer's body withdraws an open candidate
 * (`anonymousFormIntakeWithdrawnIn`, a kill switch that layering may only
 * narrow, never re-open) is a pure judgement of bodies the caller hands it, so
 * it is declared here too: the anonymous doors judge the layers they read with
 * it, and a console that switches an installed app's form judges the app's own
 * document with the same function (objectstack#36444).
 *
 * ## What stays in `@objectstack/metadata-core`
 *
 * The half that reads server state: whether the deployment's tenancy posture
 * lets an open form take an anonymous submission
 * (`anonymousFormIntakeUnavailability`). An open candidate here is what the
 * view body itself declares, before any other layer or the posture is
 * consulted. The object a candidate submits into
 * (`anonymousFormObjectName`) reads no server state, so it is declared here
 * too, and `@objectstack/metadata-core` re-exports it.
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

/**
 * The object an open form candidate submits into: the form's own `data.object`,
 * else the view's `list.data.object`, `form.data.object` and `object`. The one
 * rung order both anonymous doors and the authoring lint resolve by.
 */
export function anonymousFormObjectName(view: unknown, form: unknown): string | undefined {
  const v = (view && typeof view === 'object' ? view : {}) as Record<string, any>;
  const f = (form && typeof form === 'object' ? form : {}) as Record<string, any>;
  return f.data?.object ?? v.list?.data?.object ?? v.form?.data?.object ?? v.object;
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

/**
 * Where a form sits in a `view` body, independent of its content: the nested
 * `form`, one `formViews` entry, or the flattened `config`.
 */
function anonymousFormSlot(view: Record<string, any>, candidate: AnonymousFormIntakeCandidate): string {
  if (candidate.form === view.form) return 'form';
  if (candidate.key !== undefined && view.formViews?.[candidate.key] === candidate.form) {
    return `formViews:${candidate.key}`;
  }
  return 'config';
}

/**
 * The forms a `view` body EXPLICITLY withdraws, with their slot and slug: a
 * form `sharing` that keeps a non-empty `publicLink` and sets `enabled ===
 * false` or `allowAnonymous === false`. Judged on the body as stored: a switch
 * that is absent is not a withdrawal (only an explicit `false` is), and a
 * sharing with no public link withdraws nothing — removing the sharing block or
 * clearing the link is not a withdrawal. A package artifact parsed by the
 * stack schema (strict `defineStack`) carries the schema's default
 * `enabled: false`, which is an explicit `false`: a shipped form that keeps its
 * link without switching `enabled` on is withdrawn (fail closed). An artifact
 * that reached the runtime unparsed (`strict: false`, a hand-built manifest)
 * is judged as written, so a switch it omits is absent. The env-wide definition is the
 * switch above it, so an env-wide save may still open it.
 */
function anonymousFormExplicitWithdrawals(view: unknown): Array<{ slot: string; slug: string }> {
  if (!view || typeof view !== 'object') return [];
  const v = view as Record<string, any>;
  const forms: Array<{ slot: string; form: unknown }> = [];
  if (v.form && typeof v.form === 'object') forms.push({ slot: 'form', form: v.form });
  if (v.formViews && typeof v.formViews === 'object') {
    for (const [key, fv] of Object.entries(v.formViews)) forms.push({ slot: `formViews:${key}`, form: fv });
  }
  if (v.viewKind === 'form' && v.config && typeof v.config === 'object') forms.push({ slot: 'config', form: v.config });
  const out: Array<{ slot: string; slug: string }> = [];
  for (const { slot, form } of forms) {
    const sharing = form && typeof form === 'object' ? (form as Record<string, unknown>).sharing : undefined;
    if (!sharing || typeof sharing !== 'object') continue;
    const s = sharing as Record<string, unknown>;
    if (typeof s.publicLink !== 'string' || !s.publicLink) continue;
    if (s.enabled !== false && s.allowAnonymous !== false) continue;
    out.push({ slot, slug: publicFormSlug(s.publicLink) });
  }
  return out;
}

/**
 * Does one metadata layer withdraw an open form candidate? A WITHDRAWAL IS A
 * KILL SWITCH: layering may only narrow anonymous intake, never re-open it, so
 * the anonymous form doors serve a candidate only when no layer beneath it
 * withdraws it, and the organization-scoped write door refuses a save that
 * would leave one open.
 *
 * Identity is the `name`: the layer withdraws the candidate only through a
 * body of the same `name` as the candidate's `view`. What that name is depends
 * on the caller. The organization-scoped write door passes the env-wide body
 * of the stored row the overlay is keyed by, so a key rename, a `form.name`,
 * a slot move or an expansion rename is still judged against the form it was.
 * The anonymous doors pass the env-wide view list and the item they serve, so
 * they judge by the served item name (a known limit: an overlay stored before
 * the withdrawal, or restored by rollback or revert, that moves its form to
 * another key or slot is not matched there). The layer withdraws the
 * candidate when its body of that name EXPLICITLY
 * withdraws a form ({@link anonymousFormExplicitWithdrawals}) that matches the
 * candidate by slot (the same `form`, `formViews` key or `config`) OR by slug
 * (the same public link, compared exactly as the doors resolve it). Either
 * match is enough, so the same form cannot escape a withdrawal by moving to
 * another slot or key, or by pointing its link at a new slug; only a form that
 * differs from every withdrawn one in both is a different form (a sibling in
 * the same container).
 *
 * Another row that publishes or withdraws the same slug is a different form
 * and closes nothing. The package a body is bound to is NOT compared: a
 * withdrawal of a name closes that name's form in every package (a known
 * limit that fails closed: it may over-close another package's form of the
 * same name). It judges only the bodies the layer holds, so a caller closes a
 * name in every package only when its layer holds every package's body of the
 * name. The organization-scoped write door anchors one body per package. The
 * env-wide view list the anonymous doors read holds one item per package of a
 * name: a package's saved env-wide copy of a view container serves that
 * package's item of each form it expands, and a package-less copy stands in
 * for every package with no copy of its own. A layer
 * with no body of the row, or whose body has no explicit withdrawal, withdraws
 * nothing, so a form published only in an organization stays open there.
 */
export function anonymousFormIntakeWithdrawnIn(
  layer: ReadonlyArray<unknown>,
  view: unknown,
  candidate: AnonymousFormIntakeCandidate,
): boolean {
  if (!view || typeof view !== 'object') return false;
  const v = view as Record<string, any>;
  const name = typeof v.name === 'string' && v.name ? v.name : undefined;
  if (name === undefined) return false;
  const slot = anonymousFormSlot(v, candidate);
  for (const other of layer) {
    if (!other || typeof other !== 'object') continue;
    if ((other as Record<string, unknown>).name !== name) continue;
    for (const w of anonymousFormExplicitWithdrawals(other)) {
      if (w.slot === slot || w.slug === candidate.slug) return true;
    }
  }
  return false;
}

/** One withdrawal a layer holds: the served name it closes, and the slug its body names. */
export interface FormWithdrawal {
  name: string;
  slug: string;
}

/**
 * The slug a form body EXPLICITLY withdraws: its `sharing` keeps a non-empty
 * `publicLink` and sets `enabled === false` or `allowAnonymous === false`.
 * Absent switches are not a withdrawal; a cleared link withdraws nothing (the
 * rule `anonymousFormIntakeWithdrawnIn` applies to a `view` body).
 */
export function formExplicitlyWithdraws(form: unknown): string | undefined {
  const sharing = (form as { sharing?: unknown } | null)?.sharing;
  if (!sharing || typeof sharing !== 'object') return undefined;
  const s = sharing as Record<string, unknown>;
  if (typeof s.publicLink !== 'string' || !s.publicLink) return undefined;
  if (s.enabled !== false && s.allowAnonymous !== false) return undefined;
  return publicFormSlug(s.publicLink);
}

