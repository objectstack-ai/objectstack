// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27627] `GET {metaPath}/app/:appId/bundle` — the app metadata bundle
 * (`AppMetadataBundleResponseSchema`, `@objectstack/spec/api`).
 *
 * One request answers the metadata reads a console made one by one while it
 * worked inside an app: the app, each object it opened, and the views, pages
 * and dashboards those draw. The spec module's header carries what each member
 * list holds and the cache contract; this header carries how it is built.
 *
 * ## Every member is THE item answer, asked as the same caller
 *
 * Each member — the app included — is fetched the way the plain read's
 * uncached arm fetches it (`getMetaItem({ type, name })`) and answered by
 * `createMetaItemAnswer` in `./meta-item-read-gate.ts`, the ONE item chain
 * `GET /meta/:type/:name` and the runtime dispatcher's item read both call,
 * under the rendered read's policy (`{ arms: 'all', app: 'gate' }`) and the
 * member's own field-visibility posture (`resolveObjectMasker`, resolved before
 * the fetch). The per-caller gate, the doc locale collapse, the ADR-0106 mask,
 * the translation, `sortability` and the public-form intake reason are
 * therefore whatever that chain applies, by construction; ⛔ this module adds
 * no judgement of its own and copies no gate. The uncached arm is the one
 * chosen because it is the chain's own entry — the cached arm reaches the same
 * gate and mask through the same functions for the two types it serves gated,
 * and serves the published value under a validator this bundle replaces with
 * the bundle's own (below).
 *
 * A member the chain refuses (`absent`, `app-permission`,
 * `audience-permission`, `docs-audience`), or whose fetch throws the bare
 * not-found the item read answers as absent, is left out. The app's own
 * refusal is the whole answer, written by the item read's emitter
 * (`sendMetaReadRefusal`) byte for byte. A mask fault, and any other thrown
 * read, is the whole answer too: a member that could not be judged is never
 * served as one that is absent.
 *
 * ## Which items are members
 *
 * Read from the app document the caller is SERVED — the gate has already
 * pruned its navigation — so an entry the caller may not open reaches nothing.
 * The relationship scan, the views bound to an object and the pages bound to
 * one are found in the protocol's whole-type lists (`metaListSource`, the same
 * source the read gate reads), which only NAME candidates: every candidate is
 * then answered through the item chain above. A list read that throws is the
 * whole answer — an enumeration that failed is never served as one that found
 * nothing.
 *
 * ## The validator
 *
 * The `/meta` reads' one rule, `metaRepresentationCaching` and
 * `sendMetaRepresentation` (`./meta-representation-validator.ts`, over
 * `representationEtag` in `@objectstack/types`): the weak `ETag` hashes the
 * JSON this response sends, so it folds every per-caller dimension the members
 * were judged under (the gate, the mask, the runtime view, the intake reason)
 * and the locale, because each of them changes those bytes; two callers are
 * answered one validator only when they are sent the same body. The posture is
 * `private, no-cache`, and a matching `If-None-Match` is a bodiless `304`. A
 * member served under an undetermined field visibility (ADR-0106 D6 tier 2)
 * carries its `private, no-store` and no validator, and so does the whole
 * bundle, as that item's read does. `metadata.enableCache: false` sends no
 * validator, as it does for the item reads.
 *
 * The closed query-parameter set is empty (AGENTS.md, Route & surface
 * ownership 5). The route registers through the per-item switch inside the
 * `/meta` umbrella, so the anonymous deny and the type-level admissions apply
 * to it as to every `/meta` route.
 */

import { ObjectSchemaMaskEvaluationError } from '@objectstack/metadata-core';
import type { GetMetaItemRequest, GetMetaItemsRequest } from '@objectstack/spec/api';
import { deriveViewContainerObject } from '@objectstack/spec/ui';
import { measureServerTiming } from '@objectstack/observability';
import { handleRouteError, sendFieldVisibilityFault, thrownAnswerIsBareNotFound } from './error-response.js';
import type { MetaRouteScope } from './meta-collection-routes.js';
import * as metaReadGate from './meta-item-read-gate.js';
import type { MetaItemAnswer, MetaReadGatePolicy } from './meta-item-read-gate.js';
import { metaRepresentationCaching, sendMetaRepresentation } from './meta-representation-validator.js';
import { refuseUnknownQueryParams } from './query-allowlist.js';
import { sendMetaItemAbsent, type RestServer } from './rest-server.js';

/** The closed query-parameter set of `GET {metaPath}/app/:appId/bundle`: EMPTY. */
export const META_APP_BUNDLE_PARAMS: readonly string[] = [];

/** The relationship field types whose `reference` makes an object an inbound relation. */
const RELATIONSHIP_TYPES = new Set(['lookup', 'master_detail']);

/** The rendered read's gate policy — `GET /meta/:type/:name` without `?state=draft`. */
const RENDERED_READ_POLICY: MetaReadGatePolicy = Object.freeze({ arms: 'all', app: 'gate' });

/**
 * The `RestServer` members {@link registerMetaAppBundleRoute} reads — every
 * one of them, and no other. Each is typed AS the class member, so a change to
 * a member's signature on the class is a change here too. No route manager:
 * the route registers through the scope's per-item registrar, which reads the
 * umbrella's wrapping one at call time.
 */
export interface MetaAppBundleRouteHost {
    resolveProtocol: RestServer['resolveProtocol'];
    resolveObjectMasker: RestServer['resolveObjectMasker'];
    metaItemAnswerSources: RestServer['metaItemAnswerSources'];
    metaListSource: RestServer['metaListSource'];
    sendMetaReadRefusal: (typeof RestServer)['sendMetaReadRefusal'];
}

/** The names an app's navigation reaches, per member type, in navigation order. */
export interface AppNavigationReach {
    objects: string[];
    views: string[];
    pages: string[];
    dashboards: string[];
}

/** A non-empty string, or `undefined`. */
function nameOf(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Append `name` to `list` once. */
function addOnce(list: string[], name: string | undefined): void {
    if (name !== undefined && !list.includes(name)) list.push(name);
}

/**
 * What an app's navigation reaches: every `object` entry's `objectName` and
 * `viewName`, every `page` entry's `pageName` and every `dashboard` entry's
 * `dashboardName`, in the trees the read gate's navigation prune walks —
 * top-level `navigation`, each area's `navigation`, and `children` at any
 * depth.
 */
export function appNavigationReach(app: unknown): AppNavigationReach {
    const reach: AppNavigationReach = { objects: [], views: [], pages: [], dashboards: [] };
    const walk = (entries: unknown): void => {
        if (!Array.isArray(entries)) return;
        for (const entry of entries) {
            if (!entry || typeof entry !== 'object') continue;
            const e = entry as Record<string, unknown>;
            if (e.type === 'object') {
                addOnce(reach.objects, nameOf(e.objectName));
                addOnce(reach.views, nameOf(e.viewName));
            } else if (e.type === 'page') {
                addOnce(reach.pages, nameOf(e.pageName));
            } else if (e.type === 'dashboard') {
                addOnce(reach.dashboards, nameOf(e.dashboardName));
            }
            walk(e.children);
        }
    };
    if (app && typeof app === 'object') {
        const a = app as Record<string, unknown>;
        walk(a.navigation);
        if (Array.isArray(a.areas)) {
            for (const area of a.areas) walk((area as Record<string, unknown> | null)?.navigation);
        }
    }
    return reach;
}

/** The fields of an object document, from either stored shape of `fields`. */
function fieldsOf(item: unknown): any[] {
    const fields = (item as { fields?: unknown } | null)?.fields;
    if (Array.isArray(fields)) return fields;
    if (fields && typeof fields === 'object') return Object.values(fields);
    return [];
}

/**
 * The objects with a relationship field (`lookup` / `master_detail`) whose
 * `reference` names one of `targets`, in list order, excluding the targets.
 */
export function inboundRelationObjects(objects: readonly unknown[], targets: readonly string[]): string[] {
    const wanted = new Set(targets);
    const found: string[] = [];
    for (const item of objects) {
        const name = nameOf((item as { name?: unknown } | null)?.name);
        if (name === undefined || wanted.has(name)) continue;
        const relates = fieldsOf(item).some((field) =>
            field && RELATIONSHIP_TYPES.has(String(field.type)) && wanted.has(String(field.reference)));
        if (relates) addOnce(found, name);
    }
    return found;
}

/** A member the chain could not judge: the whole request answers it. */
class BundleMemberFault extends Error {
    constructor(readonly object: string) {
        super(`Field visibility for object '${object}' could not be evaluated.`);
    }
}

/**
 * Register the app metadata bundle route — called by
 * `RestServer#registerMetadataEndpointsInner` with a
 * {@link MetaAppBundleRouteHost} as `this`, through the scope's per-item
 * registrar.
 */
export function registerMetaAppBundleRoute(this: MetaAppBundleRouteHost, scope: MetaRouteScope): void {
    const { metadata, metaPath, isScoped, registerPerItemRoute } = scope;

    registerPerItemRoute({
        method: 'GET',
        path: `${metaPath}/app/:appId/bundle`,
        handler: async (req: any, res: any) => {
            const appId = String(req.params?.appId ?? '');
            try {
                if (refuseUnknownQueryParams(req, res, META_APP_BUNDLE_PARAMS)) return;
                const environmentId = isScoped ? req.params?.environmentId : undefined;
                const p = await this.resolveProtocol(environmentId, req);

                // One masker per type, resolved once per request, as the list
                // read resolves its own.
                const maskers = new Map<string, Promise<(name: string) => Promise<any>>>();
                const maskerFor = (type: string) => {
                    let masker = maskers.get(type);
                    if (!masker) {
                        masker = this.resolveObjectMasker(environmentId, req, type);
                        maskers.set(type, masker);
                    }
                    return masker;
                };

                /**
                 * THE item answer of `GET /meta/{type}/{name}`'s uncached arm
                 * for one member, or `undefined` when that read answers the
                 * bare not-found it serves as absent.
                 */
                const answer = async (type: string, name: string): Promise<MetaItemAnswer | undefined> => {
                    let maskPosture;
                    try {
                        maskPosture = await (await maskerFor(type))(name);
                    } catch (maskError) {
                        if (maskError instanceof ObjectSchemaMaskEvaluationError) throw new BundleMemberFault(name);
                        throw maskError;
                    }
                    let envelope: Record<string, any>;
                    try {
                        envelope = await p.getMetaItem({ type, name } satisfies GetMetaItemRequest) as Record<string, any>;
                    } catch (error) {
                        if (thrownAnswerIsBareNotFound(error)) return undefined;
                        throw error;
                    }
                    const answered = await metaReadGate.createMetaItemAnswer(
                        this.metaItemAnswerSources(environmentId, req, p, RENDERED_READ_POLICY, type),
                        { metaType: type, name, policy: RENDERED_READ_POLICY, maskPosture },
                    )(envelope);
                    if (answered.kind === 'mask-fault') throw new BundleMemberFault(answered.object);
                    return answered;
                };

                /** The served members of one type, in `names` order. */
                const members = async (type: string, names: readonly string[]) => {
                    const answers = await Promise.all(names.map((name) => answer(type, name)));
                    return answers.filter((a): a is Extract<MetaItemAnswer, { kind: 'serve' }> => a?.kind === 'serve');
                };

                // The whole-type lists that NAME candidates: the object list
                // through the read gate's own source (its execution face, which
                // carries every field), the view and page lists through the
                // protocol's list read with the same env-scoped request.
                const objectList = async () => metaReadGate.metaItemsArray(
                    await this.metaListSource(p, environmentId).listMetaItems('object'),
                );
                const listOf = async (type: 'view' | 'page') => metaReadGate.metaItemsArray(
                    await p.getMetaItems?.({ type, ...(environmentId ? { environmentId } : {}) } as GetMetaItemsRequest),
                );

                type Served = Extract<MetaItemAnswer, { kind: 'serve' }>;
                type Built =
                    | { kind: 'refused'; app: Extract<MetaItemAnswer, { kind: 'refuse' }> | undefined }
                    | { kind: 'bundle'; app: Served; objects: Served[]; views: Served[]; pages: Served[]; dashboards: Served[] };
                const built = await measureServerTiming('meta', async (): Promise<Built> => {
                    const app = await answer('app', appId);
                    if (app?.kind === 'refuse') return { kind: 'refused', app };
                    if (!app || app.kind !== 'serve') return { kind: 'refused', app: undefined };

                    const reach = appNavigationReach((app.envelope as { item?: unknown } | null)?.item);
                    const inbound = inboundRelationObjects(await objectList(), reach.objects);
                    const objects = await members('object', [...reach.objects, ...inbound]);
                    const served = new Set(objects.map((o) => String((o.envelope as { name?: unknown }).name)));

                    const viewNames = [...reach.views];
                    for (const view of await listOf('view')) {
                        const bound = deriveViewContainerObject(view);
                        if (bound !== undefined && served.has(bound)) addOnce(viewNames, nameOf(view?.name));
                    }
                    const pageNames = [...reach.pages];
                    for (const page of await listOf('page')) {
                        const bound = nameOf(page?.object);
                        if (bound !== undefined && served.has(bound)) addOnce(pageNames, nameOf(page?.name));
                    }
                    const [views, pages, dashboards] = await Promise.all([
                        members('view', viewNames),
                        members('page', pageNames),
                        members('dashboard', reach.dashboards),
                    ]);
                    return { kind: 'bundle', app, objects, views, pages, dashboards };
                }, 'Metadata reads');

                if (built.kind === 'refused') {
                    if (built.app) this.sendMetaReadRefusal(res, built.app.refusal);
                    else sendMetaItemAbsent(res);
                    return;
                }

                const { app, objects, views, pages, dashboards } = built;
                const body = {
                    app: app.envelope,
                    objects: objects.map((m) => m.envelope),
                    views: views.map((m) => m.envelope),
                    pages: pages.map((m) => m.envelope),
                    dashboards: dashboards.map((m) => m.envelope),
                };
                res.header('Vary', 'Accept-Language');
                // [ADR-0106 D6 tier 2] A member served unmasked was issued no
                // validator; its posture is the whole bundle's.
                const undetermined = [app, ...objects, ...views, ...pages, ...dashboards]
                    .find((m) => m.etag === undefined)?.cacheControl;
                sendMetaRepresentation(req, res, body, metaRepresentationCaching(body, undetermined), metadata.enableCache !== false);
            } catch (error: any) {
                if (error instanceof BundleMemberFault) {
                    sendFieldVisibilityFault(res, error.object);
                    return;
                }
                if (thrownAnswerIsBareNotFound(error)) {
                    sendMetaItemAbsent(res);
                    return;
                }
                handleRouteError(res, error);
            }
        },
        metadata: {
            summary: 'App metadata bundle: the app and the objects, views, pages and dashboards its navigation reaches, each as its own item read answers it, in one request',
            tags: ['metadata'],
        },
    });
}
