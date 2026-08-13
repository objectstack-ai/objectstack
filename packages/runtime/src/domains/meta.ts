// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/meta` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-10,
 * the terminal cut). The metadata read/write surface: type listing, item
 * CRUD (ADR-0033 draft-aware via the protocol service), the ADR-0046 doc
 * slimming, and org-scoped reads. The anonymous gate keys off the
 * anonymous-deny gate (unconditional since #3963).
 */

import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { pluralToSingular } from '@objectstack/spec/shared';
import { CoreServiceName } from '@objectstack/spec/system';
// [ADR-0106 / #3682] Metadata-plane FLS — the SAME projection the REST `/meta`
// exits run. Two dispatchers, one normalizer (`@objectstack/metadata-core`),
// because D5's "every schema-serving outlet" is only true if a future exit
// inherits the decision instead of re-deciding it.
import {
    ObjectSchemaMaskEvaluationError,
    applyObjectSchemaMask,
    isObjectSchemaMaskExempt,
    isObjectSchemaMaskingEnabled,
    resolveObjectSchemaMaskPosture,
    type ObjectSchemaMaskPosture,
} from '@objectstack/metadata-core';
import { organizationIdForMetaWrite } from '../meta-write-org-scope.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createMetaDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/meta',
        handler: (req, context) =>
            handleMetadataRequest(deps, req.path.substring(5), context, req.method, req.body, req.query),
    };
}

/**
 * ADR-0046: `doc` list responses omit `content` by default — manuals
 * are the one metadata payload that grows unbounded, and the list
 * surface only needs `name` + `label`. `?include=content` opts back in
 * (single-item GET /metadata/doc/:name always returns the full body).
 */
function slimDocList(type: string, data: any, query?: Record<string, string>): any {
    if (type !== 'doc' || query?.include === 'content') return data;
    const strip = (items: any[]) =>
        items.map((i) => {
            if (!i || typeof i !== 'object') return i;
            const { content: _content, ...rest } = i as Record<string, unknown>;
            return rest;
        });
    if (Array.isArray(data)) return strip(data);
    if (data && Array.isArray(data.items)) return { ...data, items: strip(data.items) };
    return data;
}

/**
 * [ADR-0106 D6 tier 3] The dispatcher's answer when the caller's field
 * visibility could not be evaluated: a 503, never the unmasked body and never
 * an empty-fields 200. Mirrors the REST layer's `sendFieldVisibilityFault`.
 */
function fieldVisibilityFault(deps: DomainHandlerDeps, objectName: string): HttpDispatcherResult {
    return {
        handled: true,
        response: deps.error(
            `Field visibility for object '${objectName}' could not be evaluated; the object schema is not being served.`,
            503,
        ),
    };
}

/**
 * [ADR-0106 D2/D4/D6/D7/D8] Build this request's object-schema masker — the
 * dispatcher-side twin of `RestServer.resolveObjectMasker`.
 *
 * Resolved once per request and asked per object name, so the `/metadata` list
 * read pays one context + service resolution for the whole page.
 */
async function resolveObjectMasker(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
): Promise<(objectName: string) => Promise<ObjectSchemaMaskPosture>> {
    const enabled = isObjectSchemaMaskingEnabled();
    if (!enabled) {
        const disabled: ObjectSchemaMaskPosture = { kind: 'passthrough', reason: 'disabled' };
        return async () => disabled;
    }
    const security = await deps.resolveService(context, 'security').catch(() => undefined);
    const execCtx = (context as any)?.executionContext;
    return (objectName: string) => resolveObjectSchemaMaskPosture({
        objectName,
        context: execCtx,
        security: security as any,
        enabled: true,
        telemetry: {
            warn: (message, meta) => {
                (globalThis as any).console?.warn?.(message, meta);
            },
        },
    });
}

/**
 * Project one served object schema, or report the D6 tier-3 fault.
 *
 * `'fault'` covers both the throw tier and the empty-projection case — see
 * `applyObjectSchemaMask`'s `emptied` for why an empty-fields 200 is not an
 * option the ADR leaves open.
 */
async function maskObjectSchema(
    masker: (objectName: string) => Promise<ObjectSchemaMaskPosture>,
    objectName: string,
    document: any,
): Promise<{ ok: true; document: any } | { ok: false }> {
    let posture: ObjectSchemaMaskPosture;
    try {
        posture = await masker(objectName);
    } catch (error) {
        if (error instanceof ObjectSchemaMaskEvaluationError) return { ok: false };
        throw error;
    }
    const masked = applyObjectSchemaMask(document, posture);
    if (masked.emptied) return { ok: false };
    return { ok: true, document: masked.document };
}

/**
 * [ADR-0106 D5(2)] Project every object schema in a list answer.
 *
 * A no-op for any type but `object`/`objects`, and shape-preserving for both
 * list shapes the dispatcher hands around (a bare array and an
 * `{ type, items }` envelope). One unevaluable object fails the whole list —
 * serving the rest would leave a hole in the projection that no client can see.
 */
async function maskObjectSchemaList(
    deps: DomainHandlerDeps,
    context: HttpProtocolContext,
    typeOrName: string,
    data: any,
): Promise<{ ok: true; data: any } | { ok: false; object: string }> {
    if (pluralToSingular(typeOrName) !== 'object') return { ok: true, data };
    const list: any[] | null = Array.isArray(data)
        ? data
        : (data && Array.isArray(data.items) ? data.items : null);
    if (!list || list.length === 0) return { ok: true, data };

    const masker = await resolveObjectMasker(deps, context);
    const projected: any[] = [];
    for (const item of list) {
        const objectName = String(item?.name ?? '');
        const masked = await maskObjectSchema(masker, objectName, item);
        if (!masked.ok) return { ok: false, object: objectName };
        projected.push(masked.document);
    }
    return { ok: true, data: Array.isArray(data) ? projected : { ...data, items: projected } };
}

/**
 * Handles Metadata requests
 * Standard: /metadata/:type/:name
 * Fallback for backward compat: /metadata (all objects), /metadata/:objectName (get object)
 */
export async function handleMetadataRequest(deps: DomainHandlerDeps, path: string, _context: HttpProtocolContext, method?: string, body?: any, query?: any): Promise<HttpDispatcherResult> {
    // Defense-in-depth: the metadata catch-all must honour the same
    // anonymous-deny (#2567) as the REST `/meta` routes (which serve `/meta` on
    // the cloud runtime). Object/field schemas — SYSTEM-object schemas on a
    // tenant-less host — must not be readable by anonymous callers when the
    // an anonymous, non-system caller. Unconditional since #3963.
    {
        const ec: any = _context.executionContext;
        if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem })) {
            return {
                handled: true,
                response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
            };
        }
    }
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // GET /metadata/types
    if (parts[0] === 'types') {
        // PRIORITY 1: Try protocol service — it returns BOTH legacy
        // `types: string[]` AND the richer `entries` array (with
        // JSON Schemas, allowOrgOverride flags, domain, etc) needed by
        // the metadata admin UI. It internally also merges
        // MetadataService runtime types, so this path is strictly richer.
        const protocol = await deps.resolveService(_context, 'protocol');
        if (protocol && typeof protocol.getMetaTypes === 'function') {
            try {
                const result = await protocol.getMetaTypes({});
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                console.warn('[HttpDispatcher] protocol.getMetaTypes() failed:', e?.message);
            }
        }
        // PRIORITY 2: MetadataService fallback (types only, no entries)
        const metadataService = await deps.resolveService(_context, 'metadata', _context.environmentId);
        if (metadataService && typeof (metadataService as any).getRegisteredTypes === 'function') {
            try {
                const types = await (metadataService as any).getRegisteredTypes();
                return { handled: true, response: deps.success({ types }) };
            } catch (e: any) {
                console.warn('[HttpDispatcher] MetadataService.getRegisteredTypes() failed:', e.message);
            }
        }
        // Last resort: hardcoded defaults
        return { handled: true, response: deps.success({ types: ['object', 'app', 'plugin'] }) };
    }

    // GET /metadata/objects/:name/state/:field?from=:state
    // ADR-0020 D3.3 introspection: the legal next states declared by the
    // object's `state_machine` validation rule for `:field`. Lets UIs /
    // AI authors ask "from here, where can this record go?" instead of
    // hard-coding the transition table. Returns `next: null` when no FSM
    // governs the field, `next: []` for a declared dead-end state.
    if (parts.length === 4 && (parts[0] === 'objects' || parts[0] === 'object') && parts[2] === 'state' && (!method || method === 'GET')) {
        const name = parts[1];
        const field = parts[3];
        const from = query?.from !== undefined ? String(query.from) : undefined;
        const qlService = await deps.getObjectQL(_context);
        const schema = qlService?.registry?.getObject(name);
        if (!schema) return { handled: true, response: deps.error('Object not found', 404) };
        // Dynamic import (matches the runtime convention for @objectstack/objectql)
        // so the dispatcher module graph doesn't statically pull in the objectql barrel.
        const { legalNextStates } = await import('@objectstack/objectql');
        const next = from === undefined ? null : legalNextStates(schema, field, from);
        return { handled: true, response: deps.success({ object: name, field, from: from ?? null, next }) };
    }

    // GET /metadata/:type/:name(/:subname...)/published → get published version
    // Supports compound names like `lead/views/all_leads/published`.
    if (parts.length >= 3 && parts[parts.length - 1] === 'published' && (!method || method === 'GET')) {
        const type = parts[0];
        const name = parts.slice(1, -1).join('/');

        // [#8031] The AUTHORITATIVE published store is consulted first: the
        // `state:'active'` `sys_metadata` overlay row.
        //
        // Two publish lifecycles write to two different places, and this route
        // used to know only the older one:
        //
        //   - `MetadataManager.publishPackage` snapshots a body into the
        //     row-local `publishedDefinition` key of its own in-memory
        //     registry — the ADR-0016-era package publish, which is what
        //     `getPublished` below reads.
        //   - `publishPackageDrafts` / `promoteDraft` flips the artifact's
        //     `sys_metadata` row `state:'draft' → 'active'`. ADR-0027 (E)(5)
        //     defines sealing a publish as exactly that flip, and
        //     `SysMetadataRepository` names `'active'` "the published, live
        //     overlay". ADR-0033 §2 — the ADR this route cites — routes EVERY
        //     authoring write into that same ADR-0027 draft, so promoting it
        //     is what "published" means for anything authored at runtime.
        //
        // The dispatcher's own `POST /packages/:id/publish-drafts` comment
        // states that path has "no metadata service dependency", so the two
        // shared no store at all: an item published at runtime was absent from
        // the registry `getPublished` consults and this route answered 404 —
        // a false statement about an item that IS published.
        //
        // `getMetaItemLayered` is the narrow primitive on purpose. Its overlay
        // layer is a strict `state:'active'` lookup (org-scoped first, then
        // env-wide, ADR-0048 package preference) that never reads a draft, and
        // it reports that layer SEPARATELY from the code layer. So a null
        // overlay is positively "no runtime-published row" and falls through to
        // the untouched `getPublished` path below — which is what keeps a
        // code-published item resolving to the same bytes it always did. The
        // broader `getMetaItem` would not do: it folds the code layer into its
        // own answer, so this route could no longer tell the two stores apart.
        const protocol = await deps.resolveService(_context, 'protocol');
        if (protocol && typeof (protocol as any).getMetaItemLayered === 'function') {
            try {
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                const layered = await (protocol as any).getMetaItemLayered({
                    type,
                    name,
                    ...(organizationId ? { organizationId } : {}),
                });
                if (layered?.overlay !== undefined && layered?.overlay !== null) {
                    return { handled: true, response: deps.success(layered.overlay) };
                }
            } catch { /* fall through to the code/package snapshot below */ }
        }

        const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
        if (metadataService && typeof (metadataService as any).getPublished === 'function') {
            const data = await (metadataService as any).getPublished(type, name);
            if (data === undefined) return { handled: true, response: deps.error('Not found', 404) };
            return { handled: true, response: deps.success(data) };
        }
        // Fallback — try MetadataService via resolveService
        const metaSvc = await deps.resolveService(_context, 'metadata', _context.environmentId);
        if (metaSvc && typeof (metaSvc as any).getPublished === 'function') {
            try {
                const fallbackData = await (metaSvc as any).getPublished(type, name);
                if (fallbackData !== undefined) return { handled: true, response: deps.success(fallbackData) };
            } catch { /* fall through */ }
        }
        return { handled: true, response: deps.error('Not found', 404) };
    }

    // /metadata/:type/:name where :name may itself contain slashes
    // (e.g. /metadata/lead/views/all_leads → type='lead', name='views/all_leads').
    // Compound names are how the client expresses sub-resources of a type
    // (a view of an object, a flow under an automation, etc.) and the
    // metadata service treats the full string as the lookup key.
    if (parts.length >= 2) {
        const type = parts[0];
        const name = parts.slice(1).join('/');
        // Extract optional package filter from query string
        const packageId = query?.package || undefined;

        // PUT /metadata/:type/:name (Save)
        if (method === 'PUT' && body) {
            // [#7019] The SECOND TRANSPORT for the operation #6603 gated on the
            // REST side. Same `protocol.saveMetaItem`, same metadata, different
            // door — so a gate on only one of them is not a gate, it is a
            // detour sign. Mechanism copied from `POST /_migrate-stored` below
            // in this very file rather than reinvented.
            //
            // The read side of this dispatcher already runs the ADR-0106 mask
            // (`resolveObjectMasker` / `maskObjectSchema` above), which is
            // exactly the read/write asymmetry #6603 describes: a caller is
            // served an object schema with the fields they may not read removed
            // WHOLE, and sending that document straight back used to persist it
            // — deleting those fields. Refusing the write is the write-side
            // answer, here as there.
            //
            // Independently of masking: before this, any authenticated session
            // could clobber any metadata item through this transport.
            //
            // Gate FIRST — before the protocol service is resolved — so an
            // unauthorized caller cannot use the 501-vs-200 answer to probe
            // which kernels can save, and so nothing is written before the
            // refusal. `manage_metadata` is ADR-0066 D1's authoring capability;
            // engine self-invocation (`isSystem`) bypasses, matching
            // `actionPermissionError` and the migrate-stored gate below.
            const ec: any = _context.executionContext;
            if (!ec?.isSystem && !new Set<string>(ec?.systemPermissions ?? []).has('manage_metadata')) {
                return {
                    handled: true,
                    response: deps.error(
                        'Saving a metadata item requires the `manage_metadata` capability.',
                        403,
                    ),
                };
            }

            // Try to get the protocol service directly
            const protocol = await deps.resolveService(_context, 'protocol');

            if (protocol && typeof protocol.saveMetaItem === 'function') {
                try {
                    // [#7018 / the #6190 ruling, Option A] The session's active
                    // organization rides this write ONLY for types the registry
                    // declares `allowOrgOverride: true`. For every other type it
                    // is dropped and the write lands env-wide — byte-identical to
                    // what a no-active-org session already produces today.
                    //
                    // Threading it unconditionally is how the runtime minted rows
                    // boot never reads: `SysMetadataRepository.put` stamps
                    // `organization_id` for EVERY type, while `loadMetaFromDb`
                    // hydrates `organization_id IS NULL` only. See
                    // `../meta-write-org-scope.js` for why the predicate is the
                    // static registry flag and not `isOverlayAllowed`.
                    const activeOrganizationId = await deps.resolveActiveOrganizationId(_context);
                    const organizationId = organizationIdForMetaWrite(type, activeOrganizationId);
                    const result = await protocol.saveMetaItem({ type, name, item: body, organizationId, ...(packageId ? { packageId } : {}) });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    // Preserve the 422 + structured spec-validation `issues` so
                    // the Studio can point at the offending field, not just a
                    // generic banner (the old path hardcoded 400 + dropped them).
                    return { handled: true, response: deps.errorFromThrown(e, 400) };
                }
            }

            // Fallback: try MetadataService directly
            const metaSvc = await deps.resolveService(_context, 'metadata', _context.environmentId);
            if (metaSvc && typeof (metaSvc as any).saveItem === 'function') {
                try {
                    const data = await (metaSvc as any).saveItem(type, name, body);
                    return { handled: true, response: deps.success(data) };
                } catch (e: any) {
                    // 501 stays the FALLBACK (this branch is reached only when
                    // the protocol has no `saveMetaItem`, so "unsupported" is
                    // the honest default) — but a save that fails validation is
                    // a 400 the caller can fix, not a capability gap.
                    return { handled: true, response: deps.errorFromThrown(e, 501) };
                }
            }
            return { handled: true, response: deps.error('Save not supported', 501) };
        }

        try {
            // Try specific calls based on type
            if (type === 'objects' || type === 'object') {
                // Check whether the kernel is project-scoped. When it is,
                // the process-wide SchemaRegistry is unsafe to query
                // directly — it would return objects that other projects
                // wrote in this same process. Route through the Protocol
                // service (which filters sys_metadata by environment_id) in that
                // case, and fall back to the registry only for the
                // unscoped (single-kernel / control-plane) path.
                const protocol = await deps.resolveService(_context, 'protocol') as any;
                const scopedEnv = typeof protocol?.getProjectId === 'function'
                    ? protocol.getProjectId()
                    : protocol?.environmentId;
                const scoped = scopedEnv !== undefined;

                // [ADR-0106 D2/D5(3)] ONE posture for this caller × this object,
                // resolved before any lookup, applied to whichever of the three
                // lookups below answers. Resolving it per-lookup is how the
                // registry-backed path ends up unmasked while the protocol-backed
                // one is masked — two answers to one question, which is the
                // shape #6562 already records for a different dimension of this
                // very fan-out.
                const objectMasker = await resolveObjectMasker(deps, _context);

                if (scoped && typeof protocol.getMetaItem === 'function') {
                    try {
                        const organizationId = await deps.resolveActiveOrganizationId(_context);
                        const data = await protocol.getMetaItem({ type: 'object', name, organizationId });
                        // Protocol returns `{ type, name, item }` — only treat the
                        // lookup as a hit when `item` is really there. [#5563] The
                        // test used to be `data.item ?? data`, which is truthy for
                        // ANY truthy `data`: an item-less answer (what a metadata
                        // store outage resolves to) was served as a hit and the
                        // registry fallback below never ran. The guard now asks the
                        // question its own comment claims it asks.
                        if (data?.item != null) {
                            // The fault RETURNS from inside the try on purpose:
                            // a masking failure is not a lookup miss, and
                            // falling through to the registry below would answer
                            // with the very body the fault exists to withhold.
                            const masked = await maskObjectSchema(objectMasker, name, data.item);
                            if (!masked.ok) return fieldVisibilityFault(deps, name);
                            return { handled: true, response: deps.success({ ...data, item: masked.document }) };
                        }
                    } catch { /* fall through to registry / 404 */ }
                }

                const qlService = await deps.getObjectQL(_context);
                if (qlService?.registry) {
                    const data = qlService.registry.getObject(name);
                    // [#5563] The registry hands back the bare ObjectSchema, so this
                    // fallback used to answer a different body shape than the
                    // protocol branch above for the very same request. Wrap it in
                    // the declared `GetMetaItemResponseSchema` envelope — `type` and
                    // `name` come from the request, the same values the protocol
                    // would have echoed back.
                    if (data) {
                        const masked = await maskObjectSchema(objectMasker, name, data);
                        if (!masked.ok) return fieldVisibilityFault(deps, name);
                        return { handled: true, response: deps.success({ type: 'object', name, item: masked.document }) };
                    }
                }

                // Last-ditch protocol attempt for unscoped kernels whose
                // registry missed (e.g. object persisted to DB but not
                // yet hydrated). Skip when we already tried above.
                if (!scoped && protocol && typeof protocol.getMetaItem === 'function') {
                    try {
                        const organizationId = await deps.resolveActiveOrganizationId(_context);
                        const data = await protocol.getMetaItem({ type: 'object', name, organizationId });
                        if (data?.item != null) {
                            const masked = await maskObjectSchema(objectMasker, name, data.item);
                            if (!masked.ok) return fieldVisibilityFault(deps, name);
                            return { handled: true, response: deps.success({ ...data, item: masked.document }) };
                        }
                    } catch { /* fall through to 404 */ }
                }
                return { handled: true, response: deps.error('Not found', 404) };
            }

            // Normalize plural URL paths to singular registry type names
            const singularType = pluralToSingular(type);

            // Try Protocol Service First (Preferred)
            const protocol = await deps.resolveService(_context, 'protocol');
            if (protocol && typeof protocol.getMetaItem === 'function') {
                 try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    // ADR-0033 draft-overlay preview: `?preview=draft` makes the
                    // detail read prefer a pending draft (falling back to active).
                    // Admin gating is layered on top in a follow-up (step 2).
                    const previewDrafts = query?.preview === 'draft';
                    const data = await protocol.getMetaItem({ type: singularType, name, packageId, organizationId, previewDrafts });
                    return { handled: true, response: deps.success(data) };
                 } catch (e: any) {
                    // Protocol might throw if not found or not supported
                 }
            }

            // Try MetadataService for runtime-registered types
            const metaSvc = await deps.resolveService(_context, 'metadata', _context.environmentId);
            if (metaSvc && typeof (metaSvc as any).getItem === 'function') {
                try {
                    // ADR-0048 — thread `?package=` so single-item resolution is
                    // package-scoped (prefer-local), matching list resolution.
                    const data = await (metaSvc as any).getItem(singularType, name, packageId);
                    // [#5563] Same convergence as the object branch above: the
                    // MetadataService hands back the bare document, so wrap it in
                    // the declared envelope rather than letting which service
                    // answered decide the caller's parse.
                    if (data) return { handled: true, response: deps.success({ type: singularType, name, item: data }) };
                } catch { /* not found */ }
            }
            return { handled: true, response: deps.error('Not found', 404) };
        } catch (e: any) {
            // Fallback: treat first part as object name if only 1 part (handled below)
            // But here we are deep in 2 parts. Must be an error — 404 remains the
            // default, but an error carrying its own status keeps it.
            return { handled: true, response: deps.errorFromThrown(e, 404) };
        }
    }
    
    // GET /metadata/_drafts?packageId=&type=  (ADR-0033 pending-changes list)
    // Surfaces draft-state metadata the active-only `getMetaItems` list hides,
    // so the console can show what an AI authored but nobody published yet.
    // `_drafts` is intercepted before the generic `:type` handler below so it
    // is never mistaken for a metadata type name.
    if (parts.length === 1 && parts[0] === '_drafts' && (!method || method.toUpperCase() === 'GET')) {
        // [ADR-0106 D5(4) / #6599] The dispatcher face of the same authoring
        // gate the REST `/meta/_drafts` route carries. A pending object draft
        // ships its full `fields` map, so serving `listDrafts()` verbatim leaks
        // every hidden field's definition — the disclosure ADR-0106 closes on
        // every other `/meta` outlet. `_drafts` is authored-metadata, not a
        // general read, so it GATES per caller on the SAME D4 exemption
        // predicate (`isObjectSchemaMaskExempt`) the mask exits use — 403 for a
        // non-author — rather than masking per field. Gate FIRST, before the
        // protocol is resolved, so the 501-vs-200 answer cannot be used to probe
        // (same posture as `_migrate-stored` below). The runtime transport
        // derives the ADR-0112 code from the 403 status (`PERMISSION_DENIED`),
        // matching `_migrate-stored`'s next-door precedent rather than the REST
        // twin's `FORBIDDEN`.
        const ec: any = _context.executionContext;
        if (!isObjectSchemaMaskExempt(ec)) {
            return {
                handled: true,
                response: deps.error(
                    'Reading pending metadata drafts requires an authoring capability (studio.access, setup.access or manage_metadata).',
                    403,
                ),
            };
        }
        const protocol = await deps.resolveService(_context, 'protocol');
        if (protocol && typeof protocol.listDrafts === 'function') {
            try {
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                const data = await protocol.listDrafts({
                    packageId: query?.packageId || undefined,
                    type: query?.type || undefined,
                    organizationId,
                });
                return { handled: true, response: deps.success(data) };
            } catch (e: any) {
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }
        return { handled: true, response: deps.error('Draft listing not supported', 501) };
    }

    // POST /metadata/_migrate-stored  (#4327 / #4454 / #4498)
    //
    // The server-side entry point to the same canonicalization pass
    // `os migrate meta --stored` runs. It exists because the CLI form requires
    // shell access to the deployment's database, which a hosted operator does
    // not have — so on a managed deployment ADR-0087's stored-metadata chain
    // had no finish line at all, only the per-read conversion that never ends.
    //
    // Nothing about flows is threaded through here: `migrateStoredMetadata`
    // resolves the automation engine from the services registry (#4498), and a
    // server always has a live one — so this route covers flow rows by simply
    // running in the process that owns them.
    //
    // Body: `{ apply?: boolean, types?: string[] }`. **Preview by default** —
    // the same posture as the CLI: `apply` must be explicitly `true`, and a
    // caller who sends nothing gets a report and no writes.
    if (parts.length === 1 && parts[0] === '_migrate-stored' && method?.toUpperCase() === 'POST') {
        // This rewrites every eligible `sys_metadata` row in the deployment, so
        // unlike the single-item `PUT /metadata/:type/:name` next door it is
        // gated on an explicit capability rather than on being authenticated.
        // `manage_metadata` is the ADR-0066 D1 capability for authoring and
        // publishing metadata, which is exactly what a rewrite is; engine
        // self-invocation (`isSystem`) bypasses, matching `actionPermissionError`.
        const ec: any = _context.executionContext;
        if (!ec?.isSystem && !new Set<string>(ec?.systemPermissions ?? []).has('manage_metadata')) {
            return {
                handled: true,
                response: deps.error(
                    'Rewriting stored metadata requires the `manage_metadata` capability.',
                    403,
                ),
            };
        }

        const protocol = await deps.resolveService(_context, 'protocol');
        if (!protocol || typeof (protocol as any).migrateStoredMetadata !== 'function') {
            return { handled: true, response: deps.error('Stored-metadata migration not supported', 501) };
        }
        const types = Array.isArray(body?.types)
            ? body.types.filter((t: unknown): t is string => typeof t === 'string' && t.length > 0)
            : undefined;
        try {
            const report = await (protocol as any).migrateStoredMetadata({
                apply: body?.apply === true,
                ...(types && types.length > 0 ? { types } : {}),
                // Attributed to the caller, not to the route: this writes
                // history + audit rows, and "who ran the migration" is the
                // question those rows exist to answer.
                actor: ec?.userId ? `${ec.userId} (POST /metadata/_migrate-stored)` : 'POST /metadata/_migrate-stored',
            });
            return { handled: true, response: deps.success(report) };
        } catch (e: any) {
            return { handled: true, response: deps.errorFromThrown(e, 500) };
        }
    }

    // GET /metadata/:type (List items of type) OR /metadata/:objectName (Legacy)
    if (parts.length === 1) {
        const typeOrName = parts[0];
        // Extract optional package filter from query string
        const packageId = query?.package || undefined;

        // Try protocol service first for any type
        const protocol = await deps.resolveService(_context, 'protocol');
        if (protocol && typeof protocol.getMetaItems === 'function') {
            try {
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                // ADR-0033 draft-overlay preview: `?preview=draft` overlays
                // pending drafts on the active list so an (admin) reviewer can
                // render the console off drafts before publishing.
                const previewDrafts = query?.preview === 'draft';
                const data = await protocol.getMetaItems({ type: typeOrName, packageId, organizationId, previewDrafts });
                // Return any valid response from protocol (including empty items arrays)
                if (data && (data.items !== undefined || Array.isArray(data))) {
                    // [ADR-0106 D5(2)] The dispatcher's list read is the same
                    // outlet as REST's `GET /meta/object`, reached by a different
                    // door.
                    const projected = await maskObjectSchemaList(deps, _context, typeOrName, data);
                    if (!projected.ok) return fieldVisibilityFault(deps, projected.object);
                    return { handled: true, response: deps.success(slimDocList(typeOrName, projected.data, query)) };
                }
            } catch {
                // Protocol doesn't know this type, fall through
            }
        }

        // Try MetadataService directly for runtime-registered metadata (agents, tools, etc.)
        const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
        if (metadataService && typeof (metadataService as any).list === 'function') {
            try {
                let items = await (metadataService as any).list(typeOrName);
                // Respect package filter: MetadataService.list() returns ALL items,
                // so filter by _packageId when a specific package is requested.
                if (packageId && items && items.length > 0) {
                    items = items.filter((item: any) => item?._packageId === packageId);
                }
                if (items && items.length > 0) {
                    return { handled: true, response: deps.success({ type: typeOrName, items: slimDocList(typeOrName, items, query) }) };
                }
            } catch (e: any) {
                // MetadataService doesn't know this type or failed, continue to other fallbacks
                // Sanitize typeOrName to prevent log injection (CodeQL warning)
                const sanitizedType = String(typeOrName).replace(/[\r\n\t]/g, '');
                console.debug(`[HttpDispatcher] MetadataService.list() failed for type:`, sanitizedType, 'error:', e.message);
            }
        }

        // Try ObjectQL registry directly for object/type lookups
        const qlService = await deps.getObjectQL(_context);
        if (qlService?.registry) {
            if (typeOrName === 'objects') {
                const objs = qlService.registry.getAllObjects(packageId);
                const projected = await maskObjectSchemaList(deps, _context, 'object', { type: 'object', items: objs });
                if (!projected.ok) return fieldVisibilityFault(deps, projected.object);
                return { handled: true, response: deps.success(projected.data) };
            }
            // Try listing items of the given type
            const items = qlService.registry.listItems?.(typeOrName, packageId);
            if (items && items.length > 0) {
                return { handled: true, response: deps.success({ type: typeOrName, items }) };
            }
            // Legacy: treat as object name. [ADR-0106 D5(4)] A schema-bearing
            // exit reached by a one-segment path — masked like every other, so
            // the legacy spelling is not a way around the projection.
            const obj = qlService.registry.getObject(typeOrName);
            if (obj) {
                const masked = await maskObjectSchema(
                    await resolveObjectMasker(deps, _context), typeOrName, obj,
                );
                if (!masked.ok) return fieldVisibilityFault(deps, typeOrName);
                return { handled: true, response: deps.success(masked.document) };
            }
        }
        return { handled: true, response: deps.error('Not found', 404) };
    }

    // GET /metadata — return available metadata types
    if (parts.length === 0) {
        // Prefer protocol service for the rich `entries` array (with
        // JSON Schemas etc); fall back to MetadataService types-only.
        const protocol = await deps.resolveService(_context, 'protocol');
        if (protocol && typeof protocol.getMetaTypes === 'function') {
            try {
                const result = await protocol.getMetaTypes({});
                return { handled: true, response: deps.success(result) };
            } catch { /* fall through */ }
        }
        const metadataService = await deps.resolveService(_context, 'metadata', _context.environmentId);
        if (metadataService && typeof (metadataService as any).getRegisteredTypes === 'function') {
            try {
                const types = await (metadataService as any).getRegisteredTypes();
                return { handled: true, response: deps.success({ types }) };
            } catch { /* fall through */ }
        }
        return { handled: true, response: deps.success({ types: ['object', 'app', 'plugin'] }) };
    }
    
    return { handled: false };
}
