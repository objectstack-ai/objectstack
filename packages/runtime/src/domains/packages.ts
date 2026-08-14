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
// [#5320] A's mechanical half of the fork ruling: on export, view artifacts
// are PARTITIONED — containers travel in `views:`, expanded items a travelling
// container re-derives exactly are folded away (the import side's own
// expansion recreates them), and everything else (tenant-authored standalone
// ViewItems, flattened overlays, edited expanded items) travels under the
// declared `viewItems:` channel the registration loop ingests.
import { ASSEMBLED_VIEW_ITEMS_KEY, partitionAssembledViewArtifacts } from '@objectstack/spec/ui';
import {
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
// [#7033 / #7023] The read gate reuses the SAME "builder" capability set the
// object-schema mask exempts (ADR-0106 D4) — REFERENCED, never re-spelled, so
// the package-read cohort cannot drift from the metadata mask's exemption.
// [#7020] That constant became the DERIVED union (write gate ∪ read-only
// exemptions) when the maintainer ruled the two sets must not be hand-kept
// separately. This gate wants the read-only half specifically: its cohort was
// ruled on its own terms (#7033 / #7023) and pinned WRITE-only callers OUT
// (`packages/rest/src/package-envelope.conformance.test.ts`), so it names
// `OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES` — same value it read before,
// no re-ruling of the package cohort as a side effect of #7020.
import { OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES } from '@objectstack/metadata-core';
// [#7560] ADR-0070's read-only-package rule — the SAME predicate the metadata
// authoring path asks before refusing a write INTO a platform package
// (`saveMetaItem` → `WRITABLE_PACKAGE_REQUIRED`). Imported, never re-spelled:
// this defect existed precisely because the lifecycle routes had no copy of it,
// and a second copy would be the next place it drifts.
import { isWritablePackage } from '@objectstack/metadata-protocol';
// [#8443] ADR-0112's disclosure rule (#8086 / #8136 / #8333), and the DECLARED
// 422 that keeps the one quotable population quotable. Both imported from the
// producer for the reason the line above is: this door's seed-apply fallback is
// a second copy of `metadata-protocol`'s `applySeedBodies`, and a second
// private restatement of "when may a caught sentence be quoted" is where the
// two copies start answering differently.
import { clientFacingFailureText, seedRequestValidationError } from '@objectstack/metadata-protocol';
import { organizationIdForMetaWrite } from '../meta-write-org-scope.js';
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
 * ADR-0066 D1 WRITE gate for the `/packages` domain (#7033 / #7023).
 *
 * Every state-changing package route — install, enable/disable, publish,
 * publish-drafts, discard-drafts, the ADR-0067 commit revert / rollback /
 * revert family, adopt-orphans, duplicate, manifest PATCH and DELETE — demands
 * the same `manage_metadata` capability the sibling `/meta` writes carry:
 * #6603 gated the REST `PUT /meta/:type/:name` and #7019 its dispatcher
 * transport, and `POST /meta/_migrate-stored` gates on the same key. Promoting
 * a whole package's drafts to active, discarding them, deleting the package or
 * rolling it back are metadata-authoring writes of the same class, so they
 * carry the same capability. (The reason `manage_metadata` and not the D4 read
 * set: this is ADR-0066 D1's authoring capability; the maintainer's 2026-08-09
 * ruling — "whoever can write schema is who may manage packages" — mirrors
 * #6603's judgement verbatim. #7020 tracks whether the two sets should align.)
 *
 * Returns a 403 result to short-circuit on, or `null` to proceed. Engine
 * self-invocation (`isSystem`, never settable from the wire) bypasses, exactly
 * as the migrate-stored gate does. Callers MUST run this BEFORE resolving the
 * protocol/metadata service AND before mutating the registry, so (a) an
 * unauthorized caller cannot use the 501-vs-200 answer to fingerprint which
 * primitives the deployment supports, and (b) nothing is written or deleted
 * before the refusal — "delete first, refuse second" is the worst shape here.
 */
function requireManageMetadata(deps: DomainHandlerDeps, context: HttpProtocolContext): HttpDispatcherResult | null {
    const ec: any = context?.executionContext;
    if (!ec?.isSystem && !new Set<string>(ec?.systemPermissions ?? []).has('manage_metadata')) {
        return {
            handled: true,
            response: deps.error('Managing packages requires the `manage_metadata` capability.', 403),
        };
    }
    return null;
}

/**
 * ADR-0106 D4 READ gate for the `/packages` domain (#7033 / #7023).
 *
 * Package reads disclose authored metadata — the `GET /packages` id
 * ENUMERATION face (the first step of the survey's attack chain), the
 * `GET /packages/:id` detail, the `GET /packages/:id/commits` history and the
 * `GET /packages/:id/export` whole-package export (27 metadata types) — so each
 * requires one of the two "builder" capabilities the object-schema mask exempts
 * read-only ({@link OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES} =
 * `studio.access` / `setup.access`), or `isSystem`. The read cohort is not the
 * write cohort: an `organization_admin` holding `setup.access` (but not
 * `manage_metadata`) may inspect a package yet not publish or delete it, and a
 * write-only caller holding `manage_metadata` alone is refused these reads —
 * pinned in `packages/rest/src/package-envelope.conformance.test.ts`. (#7020
 * unified the object-schema MASK exemption with the write gate; it did not
 * re-rule this cohort, which is why this site names the read-only half.)
 *
 * Returns a 403 result to short-circuit on, or `null` to proceed. Callers MUST
 * run this BEFORE reading, so the answer never leaks the package inventory to a
 * caller outside the cohort.
 */
function requireReadCapability(deps: DomainHandlerDeps, context: HttpProtocolContext): HttpDispatcherResult | null {
    const ec: any = context?.executionContext;
    const held = new Set<string>(ec?.systemPermissions ?? []);
    if (!ec?.isSystem && !OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES.some((c) => held.has(c))) {
        return {
            handled: true,
            response: deps.error('Reading packages requires the `studio.access` or `setup.access` capability.', 403),
        };
    }
    return null;
}

/**
 * ADR-0070 READ-ONLY gate for the destructive `/packages` LIFECYCLE routes
 * (#7560).
 *
 * This is a **second, independent** check from the two gates above, on a
 * different axis, and collapsing the two is what produced the defect. #7033 /
 * PR #7083 decided *who may call* these routes — writes need `manage_metadata`,
 * reads the ADR-0106 D4 set, plus a domain-wide anonymous floor. This decides
 * *what the route may do once the caller is allowed*: an authorized admin could
 * still `PATCH /packages/<platform pkg>/disable` → 200 and
 * `DELETE /packages/<platform pkg>` → 200, and the package really left the
 * running registry listing. One API call took platform functionality out of a
 * live deployment; `DELETE` came back on restart (the packages are code-loaded),
 * `disable` did NOT — {@link setPackageDisabled} persists the disable to
 * `<OS_HOME>/package-state/<env>.json`, which the registry re-reads at boot, so
 * a disabled platform package stays disabled across restarts.
 *
 * The predicate is {@link isWritablePackage} from `@objectstack/metadata-protocol`
 * — the ADR-0070 rule the authoring path already enforces, referenced rather
 * than re-spelled. The refusal is that path's refusal too: `422` /
 * `WRITABLE_PACKAGE_REQUIRED`, the code registered for exactly this condition
 * ("the package is read-only — provided by code or an installed app"). No new
 * vocabulary is invented here; the sentence is lifecycle-specific because the
 * authoring one ("switch to a writable package in the package selector") names
 * a remedy that makes no sense for a delete.
 *
 * ⛔ Deliberately NOT caller-sensitive — there is no `isSystem` bypass, unlike
 * {@link requireManageMetadata}. Read-only is a property of the PACKAGE. Engine
 * self-invocation has no business uninstalling a code package over HTTP, and
 * internal teardown calls `registry.uninstallPackage` directly without passing
 * through any of these gates.
 *
 * Callers MUST run this BEFORE mutating — the same "delete first, refuse
 * second is the worst shape here" ordering the write gate records. Returns a
 * refusal result to short-circuit on, or `null` to proceed.
 *
 * A package id that resolves to nothing is treated as WRITABLE, so an unknown
 * id still falls through to the route's own 404 rather than being re-labelled
 * 422 (and so this gate never becomes an existence oracle of its own).
 */
function requireWritablePackage(
    deps: DomainHandlerDeps,
    engine: unknown,
    id: string,
    /** Verb for the message, e.g. `'disable'` / `'delete'`. */
    action: string,
): HttpDispatcherResult | null {
    if (isWritablePackage(engine, id)) return null;
    return {
        handled: true,
        response: deps.error(
            `[writable_package_required] Cannot ${action} package '${id}': it is read-only `
            + `(provided by code or an installed app). Packages the deployment ships are managed by `
            + `the deployment, not over this API — ${action} a package you own, or duplicate this one `
            + `into a writable base (POST /packages/${encodeURIComponent(id)}/duplicate) and change that.`,
            422,
            {
                code: 'WRITABLE_PACKAGE_REQUIRED',
                packageId: id,
                docs: 'docs/adr/0070-package-first-authoring.md',
            },
        ),
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
 *
 * **Error handling.** Every `catch` here goes through `deps.errorFromThrown(e,
 * 500)` — never `deps.error(e.message, …)`. Each of these routes calls into the
 * protocol service, whose errors carry their own HTTP status as `status` (the
 * codebase convention: `OBJECT_NOT_FOUND`, `RECORD_NOT_FOUND`, `CLONE_DISABLED`,
 * …), and can be a record `ValidationError` carrying `fields[]`. Hand-rolling
 * `e.statusCode || 500` saw neither — #3867 fixed exactly that read in
 * `errorResponseBase` and #3918 taught `errorFromThrown` the validation shape,
 * but these call sites bypassed both, so a deliberate 404 still rendered as a
 * 500 and `fields[]` was still dropped. Route new handlers through the shared
 * helper rather than re-deriving the status here.
 */
export async function handlePackagesRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, query: any, _context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    const m = method.toUpperCase();

    // [#7033 / #7023] Anonymous-deny floor for the WHOLE /packages domain.
    // The same ADR-0056 D2 baseline (#3963) its five sibling dispatcher domains
    // — /meta, /actions, /automation, /ai, /security — already carry and this
    // one lacked: a survey drove a credential-less caller (identity resolved to
    // `principalKind: 'guest'`) straight to a 200 on the destructive
    // discard-drafts and the whole-package export. FIRST statement, ahead of
    // the ObjectQL registry probe below, so an anonymous caller is answered 401
    // before the 503 "Package service not available" and cannot use the
    // 401-vs-503 difference to fingerprint whether the package service is
    // mounted (the same ordering rationale the /automation gate records).
    // `isSystem` (never settable from the wire) and CORS `OPTIONS` preflights
    // pass. Gating the DOMAIN rather than each route is what keeps a newly added
    // package route from arriving ungated.
    {
        const ec: any = _context?.executionContext;
        if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem, method: m })) {
            return {
                handled: true,
                response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
            };
        }
    }

    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    // Try to get SchemaRegistry from the ObjectQL service
    const qlService = await deps.getObjectQL(_context);
    const registry = qlService?.registry;

    // If no registry available, return 503
    if (!registry) {
        return { handled: true, response: deps.error('Package service not available', 503) };
    }

    try {
        // GET /packages → list packages
        if (parts.length === 0 && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
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
            const protocolSvc: any = await deps.resolveService(_context, 'protocol').catch(() => null);
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [#7560] ADR-0070: a platform package is not the operator's to
            // switch off. BEFORE `disablePackage`, and before
            // `setPackageDisabled` writes the choice to disk — a disable that
            // lands is not undone by a restart, it is REPLAYED by one.
            const readOnly = requireWritablePackage(deps, qlService, id, 'disable'); if (readOnly) return readOnly;
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService(_context, 'protocol');
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
                            // [#8443] ADR-0112: `seedApplied.error` rides on a
                            // **200** publish response as DATA, so no HTTP
                            // boundary's 5xx message withhold can reach it —
                            // the same argument #8333's P9 makes about this
                            // door's twin inside `metadata-protocol`, which
                            // this fallback is a second copy of. Measured on
                            // `origin/main` before the change: the loader's
                            // dependency-graph read (`metadata.getObject`) is
                            // unguarded, so a `sys_metadata` outage escaped
                            // `applyPublishedSeeds` and this catch answered
                            // `"error": "SQLITE_ERROR: no such table:
                            // sys_metadata"` on a 200.
                            //
                            // The rule is IMPORTED, never re-spelled: quote the
                            // caught sentence only when the error declared
                            // itself a 4xx client refusal. The other population
                            // this catch receives — a malformed seed body —
                            // declares itself 422 at the `safeParse` inside
                            // `applyPublishedSeeds`, so the author still gets
                            // the curated issue summary.
                            (deps.logger ?? console).warn(
                                `[handlePackages] seed apply failed: ${e?.message ?? e}`,
                            );
                            (result as any).seedApplied = {
                                success: false,
                                error: clientFacingFailureText(e, 'seed apply failed'),
                            };
                        }
                    }
                    // ADR-0045 §3: "Publish" makes the package live AND visible.
                    // A materialized (additive) build has no drafts left to
                    // promote — its app sits at `_unpublished: true` awaiting the
                    // visibility flip. Clear the gate on every unpublished app
                    // bound to this package so ONE publish verb serves both
                    // regimes (the caller never needs to know how the package was
                    // built). Best-effort: a custom protocol without the meta
                    // primitives keeps plain draft-publish semantics.
                    //
                    // ⛔ #4829 — the gate is `_unpublished`, the MACHINE-managed
                    // key, and this is the point that clears it. It used to be
                    // `hidden`, which also means "keep out of the App Switcher"
                    // to every author — so publishing a package silently rewrote
                    // a presentation choice, and the REST gate reading the same
                    // flag 404'd the built-in `account` app for every non-builder.
                    // `hidden` is now never read or written here.
                    //
                    // #5242 — `flipped` and its result assignment live OUTSIDE
                    // this try. A name is pushed only AFTER its `saveMetaItem`
                    // resolved, so at any moment the list is exactly "what is
                    // already flipped on disk". When app k of N throws, the k-1
                    // that DID persist are a fact the caller must be told about:
                    // accumulating inside the try and assigning after the loop
                    // discarded them with the stack, so the response claimed
                    // nothing happened for apps that had already changed state,
                    // and the 'metadata:reloaded' announce below — which reads
                    // `unhiddenApps` — skipped them too, leaving boot-cached
                    // consumers stale until the next restart.
                    //
                    // The RESPONSE field keeps its `unhiddenApps` / `unhideError`
                    // spelling deliberately and PERMANENTLY: it is a wire contract
                    // read by the objectui Publish button, and renaming it here —
                    // in a repo that cannot verify or update that consumer — would
                    // be a silent break of the exact kind #4829 is about. A
                    // lockstep rename was once planned to ride the objectui
                    // follow-up card, together; #6955 measured that "together" out
                    // rather than in — the server still emits these names and
                    // objectui reads neither field anywhere (zero grep hits
                    // repo-wide) — so the PM ratified "not at all" as option A:
                    // renaming a zero-reader diagnostic payload buys no capability
                    // (startup-scope discipline). If the vocabulary is ever worth
                    // tidying on its own merits, that is a standalone
                    // producer-side rename card (option B), not a rider on this
                    // one.
                    //
                    // [#7018 / the #6190 ruling, Option A] `app` declares
                    // `allowOrgOverride: false`, so this flip does NOT carry the
                    // session's active organization — it lands env-wide, on the
                    // very row boot hydrates and the App Switcher reads. An
                    // org-scoped flip was a phantom: the app looked published for
                    // the life of the process and went back to `_unpublished:
                    // true` on the next restart, because the env-wide row it left
                    // untouched is the only one cold boot loads. The READ above is
                    // left org-aware on purpose — a layered read is a superset,
                    // never a loss.
                    const flipped: string[] = [];
                    const flipOrganizationId = organizationIdForMetaWrite('app', organizationId);
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
                            for (const app of apps) {
                                if (app && typeof app === 'object' && app._unpublished === true && typeof app.name === 'string') {
                                    await (protocol as any).saveMetaItem({
                                        type: 'app',
                                        name: app.name,
                                        // `false`, not a delete: ADR-0045 §3 makes
                                        // publish/unpublish symmetric ("unpublish =
                                        // re-hide"), so the gate stays a two-state
                                        // flag rather than a key whose absence has
                                        // to be re-derived. Whatever `hidden` the
                                        // app carries is copied through untouched.
                                        item: { ...app, _unpublished: false },
                                        packageId: id,
                                        ...(flipOrganizationId ? { organizationId: flipOrganizationId } : {}),
                                        ...(body?.actor ? { actor: body.actor } : {}),
                                    });
                                    flipped.push(app.name);
                                }
                            }
                        }
                    } catch (e: any) {
                        // #4754 — ADR-0045's visibility flip is a metadata WRITE
                        // riding on someone else's success. The drafts are already
                        // promoted, so this route answers 200 either way, and
                        // `unhideError` lands in a response body no operator reads.
                        // That is the #4669 shape exactly: the write did not land,
                        // the runtime looks completely healthy, and the loss only
                        // surfaces later as "I published it but the app isn't
                        // there". So it is reported at `error` (AGENTS.md →
                        // "Degradation log levels"), not swallowed.
                        const logger = deps.logger ?? console;
                        // #5242 — a mid-loop failure leaves the package SPLIT: the
                        // apps already saved are visible, the rest are not. Name
                        // BOTH halves. The old wording asserted "every hidden app
                        // is still stored hidden", which is plainly false once any
                        // flip persisted, and it left the operator to infer
                        // "nothing changed" from a bare failure line.
                        const stillUnpublished = flipped.length > 0
                            ? `the flip stopped PARTWAY — ${flipped.length} app(s) DID flip and are stored published ` +
                              `(${flipped.join(', ')}; they are reported under \`unhiddenApps\` and were announced for ` +
                              `re-sync), while every REMAINING unpublished app bound to it`
                            : `every unpublished app bound to it`;
                        logger.error(
                            `[Packages] publish-drafts: the ADR-0045 visibility flip FAILED for package '${id}' — its drafts ARE ` +
                            `published and live, but ${stillUnpublished} is still STORED with \`_unpublished: true\`, so those ` +
                            `apps stay externally unobservable while the publish reports success. Nothing retries this flip. ` +
                            `Re-run POST /packages/${id}/publish-drafts once the cause below is resolved (it is idempotent), or ` +
                            `publish one app directly via PUT /meta/app/<name> with \`{"_unpublished": false}\`. Cause: ` +
                            `${e?.message ?? String(e)}`,
                        );
                        (result as any).unhideError = e?.message ?? 'visibility flip failed';
                    }
                    // Assigned on BOTH paths — clean completion and mid-loop
                    // failure alike. On the failure path it rides ALONGSIDE
                    // `unhideError`: together they say what did flip and that
                    // something did not, which is the honest report. It must
                    // stay ABOVE the announce block, which reads this field.
                    if (flipped.length > 0) (result as any).unhiddenApps = flipped;
                    // A publish promoted drafts to active (or published an additive
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
                            await deps.announceKernelEvent(_context, 'metadata:reloaded', { changed });
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService(_context, 'protocol');
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
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Draft discarding not supported', 501) };
        }

        // ── ADR-0067: package-scoped commit history & rollback ──────────

        // GET /packages/:id/commits → the commit timeline (newest-first).
        if (parts.length === 2 && parts[1] === 'commits' && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService(_context, 'protocol');
            if (protocol && typeof (protocol as any).listCommits === 'function') {
                try {
                    const organizationId = await deps.resolveActiveOrganizationId(_context);
                    const commits = await (protocol as any).listCommits({
                        packageId: id,
                        ...(organizationId ? { organizationId } : {}),
                    });
                    return { handled: true, response: deps.success({ commits }) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Commit history not supported', 501) };
        }

        // POST /packages/:id/commits/:commitId/revert → revert ONE commit
        // (ADR-0067). Created artifacts are soft-removed, edited ones are
        // restored to their pre-commit version; the revert is itself a commit.
        if (parts.length === 4 && parts[1] === 'commits' && parts[3] === 'revert' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const commitId = decodeURIComponent(parts[2]);
            const protocol = await deps.resolveService(_context, 'protocol');
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
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Commit revert not supported', 501) };
        }

        // POST /packages/:id/rollback  body { commitId } → roll the package
        // back THROUGH every commit newer than `commitId` (ADR-0067).
        if (parts.length === 2 && parts[1] === 'rollback' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const protocol = await deps.resolveService(_context, 'protocol');
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
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }
            return { handled: true, response: deps.error('Commit rollback not supported', 501) };
        }

        // POST /packages/:id/revert → revert package to last published state
        if (parts.length === 2 && parts[1] === 'revert' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const metadataService = await deps.getService(_context, CoreServiceName.enum.metadata);
            if (metadataService && typeof (metadataService as any).revertPackage === 'function') {
                await (metadataService as any).revertPackage(id);
                return { handled: true, response: deps.success({ success: true }) };
            }
            return { handled: true, response: deps.error('Metadata service not available', 503) };
        }

        // GET /packages/:id/export → assemble a portable manifest from
        // sys_metadata overlay rows bound to this package (offline export).
        if (parts.length === 2 && parts[1] === 'export' && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService(_context, 'protocol');
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
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }

        // POST /packages/:id/duplicate → clone this base into a NEW writable
        // package, re-namespacing objects + rewriting references (ADR-0070 D4
        // "duplicate base"). Body { targetPackageId, targetName?, targetNamespace? }.
        if (parts.length === 2 && parts[1] === 'duplicate' && m === 'POST') {
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            const protocol = await deps.resolveService(_context, 'protocol');
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
                return { handled: true, response: deps.errorFromThrown(e, 500) };
            }
        }

        // GET /packages/:id → get package
        if (parts.length === 1 && m === 'GET') {
            const denied = requireReadCapability(deps, _context); if (denied) return denied;
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
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

            const protocol = await deps.resolveService(_context, 'protocol');
            if (protocol && typeof (protocol as any).updatePackage === 'function') {
                try {
                    const updated = await (protocol as any).updatePackage({ packageId: id, patch });
                    return { handled: true, response: deps.success((updated as any)?.package ?? updated) };
                } catch (e: any) {
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
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
            const denied = requireManageMetadata(deps, _context); if (denied) return denied;
            const id = decodeURIComponent(parts[0]);
            // [#7560] ADR-0070: refuse BEFORE `uninstallPackage`, which is the
            // call that removed a platform package from the running registry
            // listing (and with it every object the package registers) until
            // the next restart.
            const readOnly = requireWritablePackage(deps, qlService, id, 'delete'); if (readOnly) return readOnly;
            const registryRemoved = registry.uninstallPackage(id);

            // Persisted removal (AI/runtime packages live in sys_metadata, not
            // just the in-memory registry — the registry uninstall alone would
            // leave the rows and tables behind).
            let persisted: unknown = undefined;
            const protocol = await deps.resolveService(_context, 'protocol');
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
                    return { handled: true, response: deps.errorFromThrown(e, 500) };
                }
            }

            const deletedCount = (persisted as any)?.deletedCount ?? 0;
            const failedCount = (persisted as any)?.failedCount ?? 0;

            // [#7557] A failed persistence used to ride inside a 200: this
            // handler stated `success: true` unconditionally and forwarded the
            // protocol's own `{ success: false, deletedCount: 0 }` underneath
            // it, so the status line and the payload disagreed and every caller
            // that checks the status (which is every caller that does not go
            // digging into `persisted`) recorded an uninstall that had not
            // happened.
            //
            // The failure rule is the one the REST twin of this route already
            // uses (`packages/rest/src/package-routes.ts`), stated the same way
            // on purpose — DELETE /packages/:id has TWO doors (this dispatcher
            // and the direct-mount REST registrar, which shadows it only when a
            // `package` service is registered), and two doors answering one
            // request differently is how this divergence arrived. Zero metadata
            // rows is still a successful uninstall — a runtime-registered
            // package that never published metadata has nothing in
            // `sys_metadata` — so only PER-ITEM failures make it a failure.
            //
            // Checked BEFORE the not-found test below, which asks
            // `deletedCount === 0`: an uninstall where every row failed to
            // delete also has `deletedCount === 0`, and answering "not found"
            // for a package whose rows are demonstrably present and demonstrably
            // stuck is the same lie one layer over.
            if (failedCount > 0) {
                return {
                    handled: true,
                    response: deps.error(
                        `Deleting ${id} left ${failedCount} item(s) behind.`,
                        400,
                        {
                            code: 'PACKAGE_DELETE_PARTIAL',
                            registryRemoved,
                            failed: (persisted as any)?.failed,
                            cleanups: (persisted as any)?.cleanups,
                        },
                    ),
                };
            }
            if (!registryRemoved && deletedCount === 0) {
                return { handled: true, response: deps.error(`Package '${id}' not found`, 404) };
            }
            return { handled: true, response: deps.success({ success: true, registryRemoved, persisted }) };
        }
    } catch (e: any) {
        return { handled: true, response: deps.errorFromThrown(e, 500) };
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
    const protocol = await deps.resolveService(context, 'protocol');
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
        // [#5320] `views` is partitioned rather than dumped: the registry's
        // ADR-0017 dual-read returns the container AND its expanded per-view
        // items, and the stack `views:` vocabulary (container-only) refuses the
        // expanded ones. Containers go to `views:`; expanded items the
        // container re-derives exactly are dropped (`folded` — the importing
        // loop's own expansion recreates them); the rest — standalone
        // ViewItems, overlays, edited expansions — go to `viewItems:`.
        if (plural === 'views') {
            const { views, viewItems } = partitionAssembledViewArtifacts(items.map(clean));
            if (views.length > 0) manifest[plural] = views;
            if (viewItems.length > 0) manifest[ASSEMBLED_VIEW_ITEMS_KEY] = viewItems;
            total += views.length + viewItems.length;
            continue;
        }
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
    // [#4127] `protocol` keeps its `any` — no written contract, so this is where
    // the ledger honestly ends. `metadata` and `ql` are both evidenced now,
    // `objectql` as of batch 3: it is the same instance the `data` slot holds.
    const protocol: any = await deps.resolveService(_context, 'protocol');
    const metadata = await deps.getService(_context, CoreServiceName.enum.metadata);
    const ql = await deps.resolveService(_context, 'objectql');
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
                // [#8443] The SAME rule as the catch at the door, applied to
                // the sibling key of the same field: `readErrors` becomes
                // `seedApplied.errors[]` on that 200 response, so it is a
                // client-facing payload too. Measured before the change: with
                // `sys_metadata` unreachable this read fails FIRST — before the
                // loader is ever constructed — and answered `"errors": ["read
                // project_seed: SQLITE_ERROR: no such table: sys_metadata"]`,
                // so fixing only the door's catch would have left the commonest
                // outage shape disclosing exactly as before. A DECLARED 4xx
                // refusal (`[item_locked]`, `[writable_package_required]`, …)
                // still reaches the author verbatim — that is the point of the
                // positive list.
                (deps.logger ?? console).warn(
                    `[applyPublishedSeeds] seed body read failed for "${name}": ${(e as Error)?.message ?? String(e)}`,
                );
                readErrors.push(`read ${name}: ${clientFacingFailureText(e, 'the reason is in the server log')}`);
            }
        }
        // protocol.getMetaItem returns a WRAPPER: `{ type, name, item, lock,
        // editable, … }` — the seed body (object/records) lives under
        // `.item`. ([#5563] The HTTP endpoint answers that same envelope now;
        // it used to unwrap on its default path, which is what the parenthetical
        // here used to say.) Tolerate the wrapper (`.item`) plus the
        // body-direct and `.metadata`/`.body` shapes other protocols may return.
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
    // [#8443] `safeParse`, not `parse` — the same producer-side declaration
    // #8333's P9 made next door, for the same reason. This catch's caller now
    // withholds anything undeclared, and a raw `ZodError` declares nothing, so
    // a malformed seed body would have been blanked to `seed apply failed`
    // (measured before the change, it arrived as a multi-line dump of zod
    // internals — authoring feedback, and the one population that must
    // survive). Declaring it 422 at its own producer is what keeps BOTH true:
    // the driver text is withheld and the author still learns which seed and
    // which key. The envelope is minted by `metadata-protocol`'s own helper, so
    // one authoring mistake cannot get two different envelopes depending on
    // which protocol served the publish.
    const parsedRequest = SeedLoaderRequestSchema.safeParse({
        seeds: datasets,
        config: {
            defaultMode: 'upsert',
            multiPass: true,
            ...(organizationId ? { organizationId } : {}),
        },
    });
    if (!parsedRequest.success) throw seedRequestValidationError(parsedRequest.error.issues);
    const r = await loader.load(parsedRequest.data);
    return {
        success: r.success,
        inserted: r.summary.totalInserted,
        updated: r.summary.totalUpdated,
        errors: [...readErrors, ...(r.errors ?? [])],
    };
}
