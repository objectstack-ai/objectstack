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
 * The candidates half — which `sharing` opens a form (`enabled === true`,
 * `allowAnonymous === true` and a non-empty `publicLink` naming the slug) and
 * the three shapes a view carries a form in — is declared in
 * `@objectstack/spec/ui` (`anonymous-form-intake.ts`, beside the
 * `SharingConfigSchema` it reads), whose docblock is the authority on it. So is
 * the object-name half, `anonymousFormObjectName` (the object a candidate
 * submits into), which the authoring lint reads as well. This
 * module re-exports those bindings unchanged, so a console that imports them
 * from the spec reads the same rule the doors serve. Clearing either switch
 * withdraws the form from every anonymous door.
 *
 * A withdrawal is a kill switch: any metadata layer whose body of the same
 * view name explicitly withdraws the form (the link kept, a switch set to
 * `false`), matched by slot or by slug, closes it, and layering may only narrow
 * intake, never re-open it ({@link anonymousFormIntakeWithdrawnIn}).
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
import type { AnonymousFormIntakeCandidate } from '@objectstack/spec/ui';
import { applyInjectedSystemColumns } from './injected-system-columns.js';
import { resolveRecordWallOrganizationField } from './record-organization.js';

// The candidates half of the rule — which form candidates a `view` body opens
// to anonymous intake — the object-name half (`anonymousFormObjectName`, the
// object a candidate submits into) and the withdrawal half
// (`anonymousFormIntakeWithdrawnIn`, whether a layer's body withdraws a
// candidate) live in `@objectstack/spec/ui` beside the `SharingConfigSchema`
// they read, so a console can import the same rule the doors serve. Re-exported here as the SAME bindings (never a wrapper or a
// copy), so every server caller keeps importing it from this package and the
// two entries cannot disagree; the identity is pinned in this module's test.
export {
    anonymousFormIntakeCandidates,
    anonymousFormIntakeSlug,
    anonymousFormIntakeSlugs,
    anonymousFormIntakeWithdrawnIn,
    anonymousFormObjectName,
    publicFormSlug,
} from '@objectstack/spec/ui';
export type { AnonymousFormIntakeCandidate } from '@objectstack/spec/ui';

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

