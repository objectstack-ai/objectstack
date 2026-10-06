// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which forms a `view` body opens to anonymous intake — the ONE rule.
 *
 * The anonymous form doors (`GET /forms/:slug`, `POST /forms/:slug/submit`,
 * `registerFormEndpoints` in `@objectstack/rest`) serve exactly the candidates
 * this module returns, and `@objectstack/metadata-protocol` judges an
 * organization-scoped `view` write by the slug set it projects. Both import it
 * from here so the doors and the write-time judgement can never disagree about
 * which forms are published.
 *
 * A form candidate is open to anonymous intake when its `sharing` (the spec's
 * `SharingConfigSchema`) declares all three of:
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
 * A withdrawal is a kill switch: any metadata layer whose body of the same
 * view name explicitly withdraws the form (the link kept, a switch set to
 * `false`), matched by slot or by slug, closes it, and layering may only narrow
 * intake, never re-open it ({@link anonymousFormIntakeWithdrawnIn}).
 *
 * The candidates are the three shapes a view carries a form in: the nested
 * `form`, every `formViews` entry, and the flattened `config` of a
 * `viewKind: 'form'` item.
 *
 * [#21476] The module also answers the second question an open form raises:
 * can it take an anonymous submission on THIS deployment's posture
 * ({@link anonymousFormIntakeUnavailability})? Three readers ask it — both
 * anonymous doors, the administrator's read of the view, and the runtime
 * authoring gate's save/publish advisory — and each states the same reason
 * ({@link anonymousFormIntakeUnavailableMessage}) at the same location
 * ({@link anonymousFormSharingPath}), so the author is told exactly when the
 * doors withhold the form.
 */

import {
    normalizeTenancyPosture,
    postureEnforcesWall,
    type TenancyPosture,
} from '@objectstack/spec/security';
import { applyInjectedSystemColumns } from './injected-system-columns.js';
import { resolveRecordWallOrganizationField } from './record-organization.js';

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

/** The object an open form candidate submits into: the form's own `data.object`, else the view's. */
export function anonymousFormObjectName(view: unknown, form: unknown): string | undefined {
    const v = (view && typeof view === 'object' ? view : {}) as Record<string, any>;
    const f = (form && typeof form === 'object' ? form : {}) as Record<string, any>;
    return f.data?.object ?? v.list?.data?.object ?? v.form?.data?.object ?? v.object;
}

/**
 * Where a candidate's `sharing` sits in the `view` body — `form.sharing`,
 * `formViews.KEY.sharing` or `config.sharing`. Item-relative: the admin read
 * states it as is, and the authoring gate prefixes the write's own root.
 */
export function anonymousFormSharingPath(view: Record<string, any>, candidate: AnonymousFormIntakeCandidate): string {
    if (candidate.form === view.form) return 'form.sharing';
    if (candidate.key !== undefined && view.formViews?.[candidate.key] === candidate.form) {
        return `formViews.${candidate.key}.sharing`;
    }
    return 'config.sharing';
}

/** [#21476] Why an open public form cannot take an anonymous submission on this deployment. */
export interface AnonymousFormIntakeUnavailable {
    /** The object the form submits into. */
    object: string;
    /** The walled posture in force. */
    posture: TenancyPosture;
    /** The column the object is walled by. */
    tenantField: string;
}

/**
 * [#21476] The posture IN FORCE, as a `tenancy` service reports it, or
 * `undefined` when there is no tenancy service (or it names no posture).
 *
 * In force, never requested: a walled request the deployment cannot enforce
 * is `single` there (ADR-0105 D12), and that is the value SecurityPlugin hands
 * the engine (`setTenancyPostureProvider`) — so it is what decides whether an
 * anonymous insert is refused. Never re-read from the environment. Every
 * reader of {@link anonymousFormIntakeUnavailability} reads the posture here,
 * so the doors and the authoring gate cannot read two different postures.
 */
export function anonymousFormIntakePosture(tenancy: unknown): TenancyPosture | undefined {
    if (!tenancy || typeof tenancy !== 'object') return undefined;
    return normalizeTenancyPosture((tenancy as { posture?: unknown }).posture);
}

const isPromiseLike = (value: unknown): value is PromiseLike<unknown> =>
    !!value && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as { then?: unknown }).then === 'function';

/** The predicate's second fact, once the object schema is in hand. */
function judgeObjectSchema(
    object: string,
    posture: TenancyPosture,
    objectSchema: unknown,
): AnonymousFormIntakeUnavailable | null {
    // The EFFECTIVE schema: the declared fields plus the columns the platform
    // injects (`organization_id` among them). A served object document already
    // carries them, so this is the same reference there; a stored or pending
    // body does not, and judged raw it would read as unwalled.
    const effective = applyInjectedSystemColumns(objectSchema);
    const fields = (effective as { fields?: unknown } | null | undefined)?.fields;
    const tenantField = resolveRecordWallOrganizationField(
        effective,
        (field) => !!fields && typeof fields === 'object' && Object.prototype.hasOwnProperty.call(fields, field),
    );
    return tenantField === null ? null : { object, posture, tenantField };
}

/**
 * [#21476] THE intake-availability predicate: `null` when an open public form
 * bound to `object` can take an anonymous submission on `posture`, otherwise
 * why it cannot.
 *
 * An anonymous submission carries no organization, and on a walled posture the
 * engine refuses an insert without one into an object walled by an organization
 * column (`resolveSystemInsertOrganization`, `@objectstack/objectql`). Its two
 * facts:
 *
 *  - `posture`: {@link anonymousFormIntakePosture}, the posture in force.
 *    `undefined` (no tenancy service) names no wall.
 *  - the wall column: `resolveRecordWallOrganizationField` over the object's
 *    EFFECTIVE schema (its declared fields plus the injected columns, as a
 *    served object document carries them).
 *
 * `readObjectSchema` runs only once a wall is in force. A synchronous reader
 * gets a synchronous answer (the authoring gate); a reader that returns a
 * promise gets a promise, or `null` when nothing had to be read — `await`
 * reads both (the doors and the admin read).
 *
 * ⚠️ It reads declarations. The engine also passes a federated (`external`)
 * object, a platform object its inventory has not admitted, and a row a
 * `beforeInsert` hook stamped; a form bound to one of those with a wall column
 * is withheld although the engine would accept it (fail closed).
 */
export function anonymousFormIntakeUnavailability(
    object: string,
    posture: TenancyPosture | undefined,
    readObjectSchema: () => PromiseLike<unknown>,
): Promise<AnonymousFormIntakeUnavailable | null> | null;
export function anonymousFormIntakeUnavailability(
    object: string,
    posture: TenancyPosture | undefined,
    readObjectSchema: () => unknown,
): AnonymousFormIntakeUnavailable | null;
export function anonymousFormIntakeUnavailability(
    object: string,
    posture: TenancyPosture | undefined,
    readObjectSchema: () => unknown,
): Promise<AnonymousFormIntakeUnavailable | null> | AnonymousFormIntakeUnavailable | null {
    if (posture === undefined || !postureEnforcesWall(posture)) return null;
    const objectSchema = readObjectSchema();
    if (isPromiseLike(objectSchema)) {
        return Promise.resolve(objectSchema).then((schema) => judgeObjectSchema(object, posture, schema));
    }
    return judgeObjectSchema(object, posture, objectSchema);
}

/** [#21476] How the author makes an unavailable form available again: the closing sentences of the reason. */
export function anonymousFormIntakeUnavailableRemedy(u: AnonymousFormIntakeUnavailable): string {
    return (
        `If the rows of '${u.object}' belong to no organization, declare that on the object `
        + `(tenancy: { enabled: false }) and the form is offered again. Otherwise collect this data through `
        + `a signed-in surface.`
    );
}

/**
 * [#21476] THE reason, with its remedy: what the administrator's read states at
 * the form's `sharing`, and what the authoring gate's advisory states on save
 * and publish — one string, so the two can never word it differently.
 */
export function anonymousFormIntakeUnavailableMessage(slug: string, u: AnonymousFormIntakeUnavailable): string {
    return (
        `Public form '/forms/${slug}' is not offered to anonymous visitors on this deployment, so both `
        + `anonymous form doors answer it as not found. It submits into '${u.object}', which is walled by `
        + `'${u.tenantField}', and this deployment runs the '${u.posture}' tenancy posture: an anonymous `
        + `submission carries no organization, and an insert without one into a walled object is refused. `
        + anonymousFormIntakeUnavailableRemedy(u)
    );
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
