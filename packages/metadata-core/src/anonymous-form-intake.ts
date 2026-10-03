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
