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
import * as actionExec from '../action-execution.js';
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
        const protocol = await deps.resolveService('protocol');
        if (protocol && typeof protocol.getMetaTypes === 'function') {
            try {
                const result = await protocol.getMetaTypes({});
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                console.warn('[HttpDispatcher] protocol.getMetaTypes() failed:', e?.message);
            }
        }
        // PRIORITY 2: MetadataService fallback (types only, no entries)
        const metadataService = await deps.resolveService('metadata', _context.environmentId);
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
        const qlService = await deps.getObjectQL();
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
        const metadataService = await deps.getService(CoreServiceName.enum.metadata);
        if (metadataService && typeof (metadataService as any).getPublished === 'function') {
            const data = await (metadataService as any).getPublished(type, name);
            if (data === undefined) return { handled: true, response: deps.error('Not found', 404) };
            return { handled: true, response: deps.success(data) };
        }
        // Fallback — try MetadataService via resolveService
        const metaSvc = await deps.resolveService('metadata', _context.environmentId);
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
            // Try to get the protocol service directly
            const protocol = await deps.resolveService('protocol');

            if (protocol && typeof protocol.saveMetaItem === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
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
            const metaSvc = await deps.resolveService('metadata', _context.environmentId);
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
                const protocol = await deps.resolveService('protocol') as any;
                const scopedEnv = typeof protocol?.getProjectId === 'function'
                    ? protocol.getProjectId()
                    : protocol?.environmentId;
                const scoped = scopedEnv !== undefined;

                if (scoped && typeof protocol.getMetaItem === 'function') {
                    try {
                        const organizationId = await deps.resolveActiveOrganizationId(_context);
                        const data = await protocol.getMetaItem({ type: 'object', name, organizationId });
                        // Protocol returns `{ type, name, item }` — only
                        // treat the lookup as a hit when item is present.
                        if (data && (data.item ?? data)) {
                            return { handled: true, response: deps.success(data) };
                        }
                    } catch { /* fall through to registry / 404 */ }
                }

                const qlService = await deps.getObjectQL();
                if (qlService?.registry) {
                    const data = qlService.registry.getObject(name);
                    if (data) return { handled: true, response: deps.success(data) };
                }

                // Last-ditch protocol attempt for unscoped kernels whose
                // registry missed (e.g. object persisted to DB but not
                // yet hydrated). Skip when we already tried above.
                if (!scoped && protocol && typeof protocol.getMetaItem === 'function') {
                    try {
                        const organizationId = await deps.resolveActiveOrganizationId(_context);
                        const data = await protocol.getMetaItem({ type: 'object', name, organizationId });
                        if (data && (data.item ?? data)) {
                            return { handled: true, response: deps.success(data) };
                        }
                    } catch { /* fall through to 404 */ }
                }
                return { handled: true, response: deps.error('Not found', 404) };
            }

            // Normalize plural URL paths to singular registry type names
            const singularType = pluralToSingular(type);

            // Try Protocol Service First (Preferred)
            const protocol = await deps.resolveService('protocol');
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
            const metaSvc = await deps.resolveService('metadata', _context.environmentId);
            if (metaSvc && typeof (metaSvc as any).getItem === 'function') {
                try {
                    // ADR-0048 — thread `?package=` so single-item resolution is
                    // package-scoped (prefer-local), matching list resolution.
                    const data = await (metaSvc as any).getItem(singularType, name, packageId);
                    if (data) return { handled: true, response: deps.success(data) };
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
        const protocol = await deps.resolveService('protocol');
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

    // GET /metadata/:type (List items of type) OR /metadata/:objectName (Legacy)
    if (parts.length === 1) {
        const typeOrName = parts[0];
        // Extract optional package filter from query string
        const packageId = query?.package || undefined;

        // Try protocol service first for any type
        const protocol = await deps.resolveService('protocol');
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
                    return { handled: true, response: deps.success(slimDocList(typeOrName, data, query)) };
                }
            } catch {
                // Protocol doesn't know this type, fall through
            }
        }

        // Try MetadataService directly for runtime-registered metadata (agents, tools, etc.)
        const metadataService = await deps.getService(CoreServiceName.enum.metadata);
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
        const qlService = await deps.getObjectQL();
        if (qlService?.registry) {
            if (typeOrName === 'objects') {
                const objs = qlService.registry.getAllObjects(packageId);
                return { handled: true, response: deps.success({ type: 'object', items: objs }) };
            }
            // Try listing items of the given type
            const items = qlService.registry.listItems?.(typeOrName, packageId);
            if (items && items.length > 0) {
                return { handled: true, response: deps.success({ type: typeOrName, items }) };
            }
            // Legacy: treat as object name
            const obj = qlService.registry.getObject(typeOrName);
            if (obj) return { handled: true, response: deps.success(obj) };
        }
        return { handled: true, response: deps.error('Not found', 404) };
    }

    // GET /metadata — return available metadata types
    if (parts.length === 0) {
        // Prefer protocol service for the rich `entries` array (with
        // JSON Schemas etc); fall back to MetadataService types-only.
        const protocol = await deps.resolveService('protocol');
        if (protocol && typeof protocol.getMetaTypes === 'function') {
            try {
                const result = await protocol.getMetaTypes({});
                return { handled: true, response: deps.success(result) };
            } catch { /* fall through */ }
        }
        const metadataService = await deps.resolveService('metadata', _context.environmentId);
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
