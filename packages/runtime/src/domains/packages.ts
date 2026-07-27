// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/packages` domain — extracted dispatcher body (ADR-0076 D11 step ③,
 * PR-5). Package management: list/install/enable/disable, ADR-0033 draft
 * publish/discard, ADR-0067 commit history & rollback, ADR-0070 export /
 * orphan adoption / duplicate, and delete. Since D11 step ② (#3142) the
 * whole family flows through `dispatch()` (single pipeline), which this
 * extraction preserves — only the body's home changes.
 */

import { CoreServiceName } from '@objectstack/spec/system';
import { PLURAL_TO_SINGULAR } from '@objectstack/spec/shared';
import { setPackageDisabled } from '../package-state-store.js';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createPackagesDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/packages',
        handler: (req, context) =>
            handlePackagesRequest(deps, req.path.substring(9), req.method, req.body, req.query, context),
    };
}

/**
 * Handles Package Management requests
 * 
 * REST Endpoints:
 * - GET    /packages          → list all installed packages
 * - GET    /packages/:id      → get a specific package
 * - POST   /packages          → install a new package
 * - DELETE  /packages/:id      → uninstall a package
 * - PATCH  /packages/:id/enable  → enable a package
 * - PATCH  /packages/:id/disable → disable a package
 * - POST   /packages/:id/publish → publish a package (metadata snapshot)
 * - POST   /packages/:id/revert  → revert a package to last published state
 * 
 * Uses ObjectQL SchemaRegistry directly (via the 'objectql' service).
 */
export async function handlePackagesRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    const m = method.toUpperCase();
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // Try to get SchemaRegistry from the ObjectQL service
    const qlService = await deps.getObjectQL();
    const registry = qlService?.registry;

    // If no registry available, return 503
    if (!registry) {
        return { handled: true, response: deps.error('Package service not available', 503) };
    }

    try {
        // GET /packages → list packages
        if (parts.length === 0 && m === 'GET') {
            let packages = registry.getAllPackages();
            // Apply optional filters
            if (query?.status) {
                packages = packages.filter((p: any) => p.status === query.status);
            }
            if (query?.type) {
                packages = packages.filter((p: any) => p.manifest?.type === query.type);
            }
            return { handled: true, response: deps.success({ packages, total: packages.length }) };
        }

        // POST /packages → install package.
        // Route through the canonical `protocol.installPackage` primitive so
        // the install lands in BOTH the in-memory registry (what this list/detail
        // reads) AND the durable `sys_packages` table. Fall back to the bare
        // registry write only when the protocol service/method is unavailable.
        if (parts.length === 0 && m === 'POST') {
            const manifest = body.manifest || body;
            const pkgId = typeof manifest?.id === 'string' ? manifest.id.trim() : '';
            // A package id is mandatory — without one the install cannot be keyed.
            if (!pkgId) {
                return { handled: true, response: deps.error('Package id is required', 400) };
            }
            // Duplicate-detection: POST /packages CREATES a package. If one with
            // this id already exists, silently overwriting it destroys the existing
            // manifest (name/version/…) with no warning — a data-loss footgun
            // surfaced in Studio package-create dogfooding. Reject with 409 Conflict
            // instead. Intentional upgrade / re-install flows opt back in with
            // `overwrite: true` (body) or `?overwrite=true`.
            const overwrite =
                body?.overwrite === true || query?.overwrite === 'true' || query?.overwrite === true;
            if (!overwrite && registry.getPackage(pkgId)) {
                return {
                    handled: true,
                    response: deps.error(`Package '${pkgId}' already exists`, 409),
                };
            }
            let pkg: any;
            const protocolSvc: any = await deps.resolveService('protocol').catch(() => null);
            if (protocolSvc && typeof protocolSvc.installPackage === 'function') {
                const out = await protocolSvc.installPackage({ manifest, settings: body.settings });
                pkg = out?.package ?? out;
            } else {
                pkg = registry.installPackage(manifest, body.settings);
            }
            const res = deps.success(pkg);
            res.status = 201;
            return { handled: true, response: res };
        }

        // PATCH /packages/:id/enable
        if (parts.length === 2 && parts[1] === 'enable' && m === 'PATCH') {
            const id = decodeURIComponent(parts[0]);
            const pkg = registry.enablePackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            try {
                setPackageDisabled(_context?.environmentId, id, false);
            } catch (err) {
                console.warn('[handlePackages] failed to persist enable state', { id, error: (err as Error)?.message });
            }
            return { handled: true, response: deps.success(pkg) };
        }

        // PATCH /packages/:id/disable
        if (parts.length === 2 && parts[1] === 'disable' && m === 'PATCH') {
            const id = decodeURIComponent(parts[0]);
            const pkg = registry.disablePackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            try {
                setPackageDisabled(_context?.environmentId, id, true);
            } catch (err) {
                console.warn('[handlePackages] failed to persist disable state', { id, error: (err as Error)?.message });
            }
            return { handled: true, response: deps.success(pkg) };
        }

        // POST /packages/:id/publish → publish package metadata
        if (parts.length === 2 && parts[1] === 'publish' && m === 'POST') {
            const id = decodeURIComponent(parts[0]);
            const metadataService = await deps.getService(CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).publishPackage === 'function') {
                const result = await (metadataService as any).publishPackage(id, body || {});
                return { handled: true, response: deps.success(result) };
            }
            return { handled: true, response: deps.error('Metadata service not available', 503) };
        }

        // POST /packages/:id/publish-drafts → promote every pending DRAFT
        // bound to the package to active in one shot ("publish whole app",
        // ADR-0033). Routes through protocol.publishPackageDrafts (which
        // reuses the per-item publish primitive) — no metadata service
        // dependency, unlike /publish above.
        if (parts.length === 2 && parts[1] === 'publish-drafts' && m === 'POST') {
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).publishPackageDrafts === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await (protocol as any).publishPackageDrafts({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
                    });
                    // Publishing a `seed` draft is what actually loads its
                    // rows. The objectql protocol now batch-applies seeds
                    // inside `publishPackageDrafts` itself (so EVERY publish
                    // path — incl. the per-ref REST publish — materializes
                    // data) and reports under `seedApplied`. Only fall back
                    // to the route-level apply for custom protocols that
                    // don't self-apply — never run both, or an externalId-less
                    // seed would double-insert.
                    if ((result as any)?.seedApplied === undefined) {
                        try {
                            const seedNames = ((result as any)?.published ?? [])
                                .filter((p: any) => p?.type === 'seed')
                                .map((p: any) => p.name as string);
                            if (seedNames.length > 0) {
                                (result as any).seedApplied = await applyPublishedSeeds(deps, 
                                    seedNames,
                                    organizationId,
                                    _context,
                                );
                            }
                        } catch (e: any) {
                            (result as any).seedApplied = { success: false, error: e?.message ?? 'seed apply failed' };
                        }
                    }
                    // ADR-0045: "Publish" makes the package live AND visible.
                    // A materialized (additive) build has no drafts left to
                    // promote — its app sits at `hidden: true` awaiting the
                    // visibility flip. Unhide every hidden app bound to this
                    // package so ONE publish verb serves both regimes (the
                    // caller never needs to know how the package was built).
                    // Best-effort: a custom protocol without the meta
                    // primitives keeps plain draft-publish semantics.
                    try {
                        if (
                            typeof (protocol as any).getMetaItems === 'function' &&
                            typeof (protocol as any).saveMetaItem === 'function'
                        ) {
                            const appsRes = await (protocol as any).getMetaItems({
                                type: 'app',
                                packageId: id,
                                ...(organizationId ? { organizationId } : {}),
                            });
                            const apps: any[] = Array.isArray(appsRes)
                                ? appsRes
                                : Array.isArray((appsRes as any)?.items) ? (appsRes as any).items : [];
                            const unhidden: string[] = [];
                            for (const app of apps) {
                                if (app && typeof app === 'object' && app.hidden === true && typeof app.name === 'string') {
                                    await (protocol as any).saveMetaItem({
                                        type: 'app',
                                        name: app.name,
                                        item: { ...app, hidden: false },
                                        packageId: id,
                                        ...(organizationId ? { organizationId } : {}),
                                        ...(body?.actor ? { actor: body.actor } : {}),
                                    });
                                    unhidden.push(app.name);
                                }
                            }
                            if (unhidden.length > 0) (result as any).unhiddenApps = unhidden;
                        }
                    } catch (e: any) {
                        (result as any).unhideError = e?.message ?? 'visibility flip failed';
                    }
                    // A publish promoted drafts to active (or unhid an additive
                    // app) at RUNTIME — but boot-cached consumers still hold the
                    // pre-publish view. The load-bearing one is the automation
                    // engine: a record-triggered flow authored + published in the
                    // Studio does NOT bind its trigger (record-change automations
                    // never fire) until the next restart. Announce
                    // 'metadata:reloaded' — the same signal a dev artifact reload
                    // fires (MetadataPlugin._reloadAndAnnounce) — so subscribers
                    // re-sync WITHOUT a restart. #2560 covers the cold-boot bind;
                    // this covers publish-while-running. `this.kernel.context` is
                    // the same handle the service resolver uses above. Best-effort:
                    // a subscriber failure must never fail the publish (the drafts
                    // are already live), so it rides the response instead.
                    try {
                        const changed = [
                            ...(((result as any)?.published ?? []) as Array<{ type: string; name: string }>)
                                .map((p) => `${p.type}/${p.name}`),
                            ...(((result as any)?.unhiddenApps ?? []) as string[]).map((n) => `app/${n}`),
                        ];
                        if (changed.length > 0) {
                            await deps.announceKernelEvent('metadata:reloaded', { changed });
                        }
                    } catch (e: any) {
                        (result as any).rebindError = e?.message ?? 'metadata:reloaded announce failed';
                    }
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    // Carry spec-validation `issues` (and the real 422 status —
                    // the protocol sets `.status`, not `.statusCode`) through to
                    // the publish surface so failures are field-anchored.
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Draft publishing not supported', 501) };
        }

        // POST /packages/:id/discard-drafts → drop every pending DRAFT bound
        // to the package, reverting it to its last published baseline
        // ("abandon all my changes"). NON-destructive: active metadata and
        // physical tables are untouched. Routes through the sys_metadata
        // path (no metadata-service dependency, unlike /revert below).
        if (parts.length === 2 && parts[1] === 'discard-drafts' && m === 'POST') {
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).discardPackageDrafts === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await (protocol as any).discardPackageDrafts({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
                    });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
                }
            }
            return { handled: true, response: deps.error('Draft discarding not supported', 501) };
        }

        // ── ADR-0067: package-scoped commit history & rollback ──────────

        // GET /packages/:id/commits → the commit timeline (newest-first).
        if (parts.length === 2 && parts[1] === 'commits' && m === 'GET') {
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).listCommits === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const commits = await (protocol as any).listCommits({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                    });
                    return { handled: true, response: deps.success({ commits }) };
                } catch (e: any) {
                    return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
                }
            }
            return { handled: true, response: deps.error('Commit history not supported', 501) };
        }

        // POST /packages/:id/commits/:commitId/revert → revert ONE commit
        // (ADR-0067). Created artifacts are soft-removed, edited ones are
        // restored to their pre-commit version; the revert is itself a commit.
        if (parts.length === 4 && parts[1] === 'commits' && parts[3] === 'revert' && m === 'POST') {
            const commitId = decodeURIComponent(parts[2]);
            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).revertCommit === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await (protocol as any).revertCommit({
                        commitId,
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
                    });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
                }
            }
            return { handled: true, response: deps.error('Commit revert not supported', 501) };
        }

        // POST /packages/:id/rollback  body { commitId } → roll the package
        // back THROUGH every commit newer than `commitId` (ADR-0067).
        if (parts.length === 2 && parts[1] === 'rollback' && m === 'POST') {
            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).rollbackToPackageCommit === 'function') {
                if (!body?.commitId) {
                    return { handled: true, response: deps.error('Body { commitId } is required', 400) };
                }
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const result = await (protocol as any).rollbackToPackageCommit({
                        commitId: String(body.commitId),
                        ...(organizationId ? { organizationId } : {}),
                        ...(body?.actor ? { actor: body.actor } : {}),
                    });
                    return { handled: true, response: deps.success(result) };
                } catch (e: any) {
                    return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
                }
            }
            return { handled: true, response: deps.error('Commit rollback not supported', 501) };
        }

        // POST /packages/:id/revert → revert package to last published state
        if (parts.length === 2 && parts[1] === 'revert' && m === 'POST') {
            const id = decodeURIComponent(parts[0]);
            const metadataService = await deps.getService(CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).revertPackage === 'function') {
                await (metadataService as any).revertPackage(id);
                return { handled: true, response: deps.success({ success: true }) };
            }
            return { handled: true, response: deps.error('Metadata service not available', 503) };
        }

        // GET /packages/:id/export → assemble a portable manifest from
        // sys_metadata overlay rows bound to this package (offline export).
        if (parts.length === 2 && parts[1] === 'export' && m === 'GET') {
            const id = decodeURIComponent(parts[0]);
            const manifest = await assemblePackageManifest(deps, id, registry, _context);
            if (!manifest) {
                return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            }
            return { handled: true, response: deps.success(manifest) };
        }

        // POST /packages/:id/adopt-orphans → bulk-rebind package-less (legacy
        // null / 'sys_metadata') metadata INTO this base (ADR-0070 D5 migration;
        // lets the env retire the "Local / Custom" scope once it has no orphans).
        if (parts.length === 2 && parts[1] === 'adopt-orphans' && m === 'POST') {
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService('protocol');
            if (!protocol || typeof (protocol as any).reassignOrphanedMetadata !== 'function') {
                return { handled: true, response: deps.error('Orphan adoption not supported', 501) };
            }
            try {
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                const result = await (protocol as any).reassignOrphanedMetadata({
                    targetPackageId: id,
                    ...(organizationId ? { organizationId } : {}),
                    ...(body?.actor ? { actor: body.actor } : {}),
                });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
            }
        }

        // POST /packages/:id/duplicate → clone this base into a NEW writable
        // package, re-namespacing objects + rewriting references (ADR-0070 D4
        // "duplicate base"). Body { targetPackageId, targetName?, targetNamespace? }.
        if (parts.length === 2 && parts[1] === 'duplicate' && m === 'POST') {
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService('protocol');
            if (!protocol || typeof (protocol as any).duplicatePackage !== 'function') {
                return { handled: true, response: deps.error('Package duplication not supported', 501) };
            }
            const targetPackageId = typeof body?.targetPackageId === 'string' ? body.targetPackageId.trim() : '';
            if (!targetPackageId) {
                return { handled: true, response: deps.error('Body { targetPackageId } is required', 400) };
            }
            try {
                const organizationId = await deps.resolveActiveOrganizationId(_context);
                const result = await (protocol as any).duplicatePackage({
                    sourcePackageId: id,
                    targetPackageId,
                    ...(typeof body?.targetName === 'string' ? { targetName: body.targetName } : {}),
                    ...(typeof body?.targetNamespace === 'string' ? { targetNamespace: body.targetNamespace } : {}),
                    ...(organizationId ? { organizationId } : {}),
                    ...(body?.actor ? { actor: body.actor } : {}),
                });
                return { handled: true, response: deps.success(result) };
            } catch (e: any) {
                return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
            }
        }

        // GET /packages/:id → get package
        if (parts.length === 1 && m === 'GET') {
            const id = decodeURIComponent(parts[0]);
            const pkg = registry.getPackage(id);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            return { handled: true, response: deps.success(pkg) };
        }

        // PATCH /packages/:id → edit the manifest (name / description /
        // version). A partial patch: only the fields present are changed;
        // lifecycle state (enabled / status / installedAt) is preserved.
        // `id` / `scope` / `type` are identity/structure and are NOT editable
        // here. Body accepts the fields flat or under a `manifest` wrapper.
        if (parts.length === 1 && m === 'PATCH') {
            const id = decodeURIComponent(parts[0]);
            const src = (body?.manifest && typeof body.manifest === 'object' ? body.manifest : body) ?? {};
            const patch: { name?: string; description?: string; version?: string } = {};
            if (typeof src.name === 'string') patch.name = src.name.trim();
            if (typeof src.description === 'string') patch.description = src.description;
            if (typeof src.version === 'string') patch.version = src.version.trim();

            if (patch.name !== undefined && patch.name === '') {
                return { handled: true, response: deps.error('name must not be empty', 400) };
            }
            if (patch.version !== undefined && !/^\d+\.\d+\.\d+$/.test(patch.version)) {
                return { handled: true, response: deps.error('version must be semantic (e.g. 1.0.0)', 400) };
            }
            if (patch.name === undefined && patch.description === undefined && patch.version === undefined) {
                return { handled: true, response: deps.error('Body { name?, description?, version? } — nothing to update', 400) };
            }

            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).updatePackage === 'function') {
                try {
                    const updated = await (protocol as any).updatePackage({ packageId: id, patch });
                    return { handled: true, response: deps.success((updated as any)?.package ?? updated) };
                } catch (e: any) {
                    return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
                }
            }
            // Fallback: no protocol service — in-memory registry only.
            const pkg = registry.updatePackageManifest(id, patch);
            if (!pkg) return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            return { handled: true, response: deps.success(pkg) };
        }

        // DELETE /packages/:id → delete the package. Unregisters it from the
        // in-memory registry AND removes its persisted sys_metadata rows
        // (active + draft), tearing down each object's physical table by
        // default. `?keepData=true` preserves object tables (metadata-only
        // delete). Use case: "I don't want this package anymore."
        if (parts.length === 1 && m === 'DELETE') {
            const id = decodeURIComponent(parts[0]);
            const registryRemoved = registry.uninstallPackage(id);

            // Persisted removal (AI/runtime packages live in sys_metadata, not
            // just the in-memory registry — the registry uninstall alone would
            // leave the rows and tables behind).
            let persisted: unknown = undefined;
            const protocol = await deps.resolveService('protocol');
            if (protocol && typeof (protocol as any).deletePackage === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const keepData = query?.keepData === 'true' || query?.keepData === '1';
                    persisted = await (protocol as any).deletePackage({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                        ...(keepData ? { keepData: true } : {}),
                    });
                } catch (e: any) {
                    return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
                }
            }

            const deletedCount = (persisted as any)?.deletedCount ?? 0;
            if (!registryRemoved && deletedCount === 0) {
                return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            }
            return { handled: true, response: deps.success({ success: true, registryRemoved, persisted }) };
        }
    } catch (e: any) {
        return { handled: true, response: deps.error(e.message, e.statusCode || 500) };
    }

    return { handled: false };
}

/**
 * Assemble a portable, offline-installable package manifest from the
 * `sys_metadata` overlay rows bound to `packageId`.
 *
 * The resulting shape mirrors what `marketplace-install-local` →
 * `manifestService.register()` → `engine.registerApp()` consumes:
 *   `{ id, name, version, objects:[…], views:[…], flows:[…], … }`
 * where each category key is the PLURAL manifest name and its value is
 * an array of clean metadata bodies (provenance decorations stripped).
 *
 * Only the metadata categories that `registerApp` can actually consume
 * are exported. `datasources` and `emailTemplates` are intentionally
 * excluded (not registered by the import path). `tools` / `skills` ARE
 * round-tripped: they are registered by `registerApp` on import and
 * surfaced by `getMetaItems('tool' | 'skill')` on export.
 *
 * @returns the manifest object, or `null` if the package id is unknown
 *          AND has no overlay-authored metadata.
 */
async function assemblePackageManifest(
deps: DomainHandlerDeps,
packageId: string,
registry: any,
context: HttpProtocolContext,
): Promise<Record<string, any> | null> {
    const protocol = await deps.resolveService('protocol');
    if (!protocol || typeof protocol.getMetaItems !== 'function') return null;

    const organizationId = await deps.resolveActiveOrganizationId(context);

    // Provenance / overlay-bookkeeping keys that must never leak into a
    // portable manifest. Stripped at top level only — nested field bodies
    // are left untouched.
    const PROVENANCE_KEYS = new Set([
        '_packageId', '_packageVersionId', '_provenance', '_state',
        '_version', '_organizationId', '_source', '_id', '_rowId',
    ]);
    const clean = (item: any) => {
        if (!item || typeof item !== 'object') return item;
        const out: Record<string, any> = {};
        for (const [k, v] of Object.entries(item)) {
            if (k.startsWith('_') || PROVENANCE_KEYS.has(k)) continue;
            out[k] = v;
        }
        return out;
    };

    // Categories the local-install register path understands. Excludes
    // datasources / emailTemplates (not consumed by registerApp).
    const exportPluralKeys = Object.keys(PLURAL_TO_SINGULAR).filter(
        (k) => k !== 'datasources' && k !== 'emailTemplates',
    );

    const manifest: Record<string, any> = {};
    let total = 0;
    for (const plural of exportPluralKeys) {
        const singular = PLURAL_TO_SINGULAR[plural];
        let items: any[] = [];
        try {
            // getMetaItems applies the packageId filter at the
            // registry/overlay query level, so the returned items are
            // already scoped to this package — no client-side re-filter.
            const res = await protocol.getMetaItems({ type: singular, packageId, organizationId });
            items = Array.isArray(res?.items) ? res.items : [];
        } catch {
            // Unknown/unsupported type for this runtime — skip.
            continue;
        }
        if (items.length === 0) continue;
        manifest[plural] = items.map(clean);
        total += items.length;
    }

    const pkg = (() => {
        try { return registry?.getPackage?.(packageId); } catch { return undefined; }
    })();

    if (total === 0 && !pkg) return null;

    manifest.id = packageId;
    manifest.name = pkg?.manifest?.name ?? pkg?.name ?? packageId;
    manifest.version = pkg?.manifest?.version ?? pkg?.version ?? '1.0.0';
    if (pkg?.manifest?.label ?? pkg?.label) {
        manifest.label = pkg?.manifest?.label ?? pkg?.label;
    }
    return manifest;
}

/**
 * Apply just-published `seed` metadata: load each seed's rows into its
 * target object so publishing a seed draft makes the data live (the runtime
 * counterpart to staging it). Reads each seed body via the protocol, then
 * runs the {@link SeedLoaderService} for the active org. Best-effort and
 * idempotent (upsert) — callers must never let this fail the publish.
 *
 * Lives at the runtime layer (not in the objectql publish primitive)
 * because the seed loader needs the data engine + metadata service, which
 * objectql cannot depend on without a layering cycle.
 */
async function applyPublishedSeeds(
deps: DomainHandlerDeps,
names: string[],
organizationId: string | undefined,
_context: HttpProtocolContext,
): Promise<{ success: boolean; inserted?: number; updated?: number; errors?: unknown[]; error?: string }> {
    const protocol: any = await deps.resolveService('protocol');
    const metadata: any = await deps.getService(CoreServiceName.enum.metadata);
    const ql: any = await deps.resolveService('objectql');
    if (!protocol || typeof protocol.getMetaItem !== 'function' || !ql || !metadata) {
        return { success: false, error: 'seed apply: required services unavailable' };
    }
    const datasets: any[] = [];
    const readErrors: string[] = [];
    for (const name of names) {
        // Read the just-published seed body. Try the active org first, then
        // fall back to an env-wide read — a workspace seed is often stored
        // org-wide (organization_id IS NULL), and resolving the wrong scope
        // here is what silently produced "0 rows loaded".
        const attempts = organizationId
            ? [{ type: 'seed', name, organizationId }, { type: 'seed', name }]
            : [{ type: 'seed', name }];
        let item: any;
        for (const args of attempts) {
            try {
                item = await protocol.getMetaItem(args);
                if (item) break;
            } catch (e) {
                readErrors.push(`read ${name}: ${(e as Error)?.message ?? String(e)}`);
            }
        }
        // protocol.getMetaItem (called directly, unlike the HTTP endpoint
        // which unwraps) returns a WRAPPER: `{ type, name, item, lock,
        // editable, … }` — the seed body (object/records) lives under
        // `.item`. Tolerate the wrapper (`.item`) plus the body-direct and
        // `.metadata`/`.body` shapes other protocols may return.
        const seed = item?.object && Array.isArray(item?.records)
            ? item
            : (item?.item ?? item?.metadata ?? item?.body);
        if (seed?.object && Array.isArray(seed?.records)) {
            datasets.push(seed);
        } else {
            readErrors.push(`seed "${name}" body unreadable (keys: ${item ? Object.keys(item).join(',') : 'none'})`);
        }
    }
    // Seeds were published but none could be read back → surface it (do NOT
    // report success with 0 rows, which hides the failure).
    if (datasets.length === 0) {
        return { success: false, inserted: 0, updated: 0, error: 'seed apply: no readable seed bodies', errors: readErrors };
    }

    const { SeedLoaderService } = await import('../seed-loader.js');
    const { SeedLoaderRequestSchema } = await import('@objectstack/spec/data');
    const loader = new SeedLoaderService(ql, metadata, deps.logger ?? console);
    const request = SeedLoaderRequestSchema.parse({
        seeds: datasets,
        config: {
            defaultMode: 'upsert',
            multiPass: true,
            ...(organizationId ? { organizationId } : {}),
        },
    });
    const r = await loader.load(request);
    return {
        success: r.success,
        inserted: r.summary.totalInserted,
        updated: r.summary.totalUpdated,
        errors: [...readErrors, ...(r.errors ?? [])],
    };
}
