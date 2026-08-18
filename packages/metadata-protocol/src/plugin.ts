// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataProtocolPlugin — ADR-0076 Step 2 (#2462, cross-repo window).
 *
 * Owns what `ObjectQLPlugin` historically assembled inline: the
 * `ObjectStackProtocolImplementation` construction + `protocol` service
 * registration and the metadata-storage platform objects. (The lightweight
 * `analytics` fallback that used to ride here was retired in #3891 — see
 * {@link assembleMetadataProtocol}.) Registering it NEXT TO `ObjectQLPlugin` (with
 * `registerProtocol: false` on the engine plugin) makes `@objectstack/objectql`
 * effectively protocol-free at boot-assembly level — the engine plugin keeps
 * only protocol CONSUMERS (DB hydration + authored hook/action rebind, both of
 * which resolve `getService('protocol')` lazily and degrade gracefully).
 *
 * Pattern follows plugin-security: named plugin + `dependencies` on the engine
 * + `ctx.getService('objectql')`.
 *
 * Assembly contract: exactly ONE of {this plugin, ObjectQLPlugin's built-in
 * assembly} may register `protocol` per kernel. `registerService` throws on
 * duplicates by design (see the kernel contract); this plugin turns that into
 * an actionable configuration message.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import type { IObjectQLEngine } from '@objectstack/spec/contracts';
import {
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataCommitObject,
    SysMetadataAuditObject,
    SysViewDefinitionObject,
} from '@objectstack/metadata-core';
import {
    ensureViewDefinitionActiveIndex,
    resolveIndexExec,
} from './migrations/view-definition-active-index.js';
import {
    ensureSysSettingIdentityIndex,
    resolveSysSettingIndexExec,
} from './migrations/sys-setting-identity-index.js';
import {
    backfillSeedTenancy,
    resolveSeedTenancySeam,
} from './migrations/seed-tenancy-backfill.js';
import { ObjectStackProtocolImplementation } from './protocol.js';
import type { MetadataAuthoringChannel } from './protocol.js';

export interface MetadataProtocolPluginOptions {
    /**
     * Per-project scope (cloud per-env kernels). When set, `saveMetaItem`
     * stamps `environment_id` on new sys_metadata rows, `loadMetaFromDb`
     * filters by it, and the metadata-storage objects are NOT provisioned
     * locally (per-project kernels source metadata from the control plane).
     * Mirrors `ObjectQLPluginOptions.environmentId` — pass the same value.
     */
    environmentId?: string;
    /**
     * [#6710] Which authoring channel this kernel's metadata writes arrive on.
     *
     * Leave unset on ANY kernel that serves `PUT /api/v1/meta/*` to end users
     * (Studio tenants, MCP/AI authors, self-hosted app servers): the default
     * `'environment'` runs the #4463 runtime authoring rules, which for those
     * authors is the only author-time gate that exists.
     *
     * Set `'package-author'` ONLY on the genuine control-plane assembly — the
     * kernel that installs packages on the platform's own behalf and is not an
     * author publishing into a live tenant. Stating it is a claim about what
     * this kernel IS; it is not a switch for making a red publish go away.
     *
     * Deliberately no env-var fallback (unlike `skipSchemaSync`): a deployment
     * must not be able to turn an end-user guardrail off from the outside. The
     * per-write escape hatch that DOES exist is
     * `OS_ALLOW_UNLINTED_METADATA_WRITES` (#4463 D4), which degrades the
     * refusal to a loud log instead of silencing it.
     */
    authoringChannel?: MetadataAuthoringChannel;
}

export function createMetadataProtocolPlugin(options: MetadataProtocolPluginOptions = {}): Plugin {
    const { environmentId, authoringChannel } = options;
    return {
        name: 'com.objectstack.metadata.protocol',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],

        init: async (ctx: PluginContext) => {
            const ql = ctx.getService<IObjectQLEngine>('objectql');

            // Assembly-conflict guard: the engine plugin's built-in assembly
            // (registerProtocol !== false) already registered `protocol`.
            // Fail with the fix instead of the kernel's generic duplicate
            // throw so the boot author knows which knob to turn.
            let already: unknown;
            try { already = ctx.getService('protocol'); } catch { /* not registered — good */ }
            if (already) {
                throw new Error(
                    '[MetadataProtocolPlugin] a `protocol` service is already registered — ' +
                    'pass `registerProtocol: false` to ObjectQLPlugin when mounting MetadataProtocolPlugin (ADR-0076 Step 2).',
                );
            }

            assembleMetadataProtocol(ctx, ql, environmentId, { authoringChannel });
        },
    };
}

/** Extra assembly inputs that are not row scope. Bag-shaped so the next one is additive. */
export interface AssembleMetadataProtocolOptions {
    /**
     * [#6710] See {@link MetadataProtocolPluginOptions.authoringChannel}.
     * Omitted ⇒ `'environment'` ⇒ the #4463 runtime authoring gate is active.
     */
    authoringChannel?: MetadataAuthoringChannel;
}

/**
 * The ONE protocol assembly (ADR-0076 Step 2 PR-C): metadata-storage platform
 * objects + `ObjectStackProtocolImplementation` as the `protocol` service.
 * Called by {@link createMetadataProtocolPlugin} (delegated mode) AND by
 * `ObjectQLPlugin`'s built-in convenience mode (`registerProtocol !== false`)
 * — single source, two mounts, identical result.
 *
 * The `analytics` slot is deliberately NOT filled here (#3891 / #3878,
 * superseding the ADR-0076 D10/D12 "preserve the fallback" stance): the
 * degraded shim dropped the caller's ExecutionContext (no RLS/tenant
 * predicates) and ignored the contract `where` filter, returning full-table
 * aggregates with a 200. An empty slot degrades honestly instead — the
 * dispatcher's `/analytics` domain answers 404 and discovery reports
 * `unavailable` until `AnalyticsServicePlugin` registers the real engine.
 *
 * @returns the protocol shim, so the engine-side caller can arm its
 * mutation-rebind subscription synchronously.
 */
export function assembleMetadataProtocol(
    ctx: PluginContext,
    ql: any,
    environmentId?: string,
    options: AssembleMetadataProtocolOptions = {},
): ObjectStackProtocolImplementation {
            // Metadata-storage platform objects (sys_metadata + history/audit
            // siblings + sys_view_definition). Same `environmentId === undefined`
            // gate as the historical assembly: platform / standalone kernels own
            // their local sys_metadata; per-project (cloud) kernels source
            // metadata from the control plane and must NOT provision these
            // tables locally. registerApp is idempotent — a MetadataPlugin that
            // also registers them is harmless.
            if (environmentId === undefined) {
                ql.registerApp({
                    id: 'com.objectstack.metadata-objects',
                    name: 'Metadata Platform Objects',
                    version: '1.0.0',
                    type: 'plugin',
                    scope: 'system',
                    objects: [
                        SysMetadataObject,
                        SysMetadataHistoryObject,
                        SysMetadataCommitObject,
                        SysMetadataAuditObject,
                        SysViewDefinitionObject,
                    ],
                });
            }

            // [#6710] The authoring channel is threaded here and NOWHERE else:
            // this function is the one seam BOTH mounts share (the delegated
            // MetadataProtocolPlugin and ObjectQLPlugin's built-in
            // `registerProtocol !== false` convenience mode), so a declaration
            // that lands here cannot be half-applied depending on how the host
            // chose to mount the protocol. `?? 'environment'` is the fail-safe
            // default restated at the seam — a caller reaching
            // `assembleMetadataProtocol` directly with no options bag gets the
            // gated channel, exactly like one that omits the plugin option.
            const protocolShim = new ObjectStackProtocolImplementation(
                ql,
                () => (ctx.getServices ? ctx.getServices() : new Map()),
                environmentId,
                options.authoringChannel ?? 'environment',
            );
            ctx.registerService('protocol', protocolShim);
            ctx.logger.info('Protocol service registered (MetadataProtocolPlugin)');

            // #5839 — `sys_view_definition`'s "unique among ACTIVE rows" was
            // never delivered by anything: the declaration's `partial` key was
            // DDL-inert (and is now retired, #5248 / #4943), and unlike
            // `sys_metadata` this table had no runtime migration behind it, so
            // an archived view kept occupying its (name, organization_id,
            // owner) slot and the user could not re-create a view they had
            // just thrown away. Same paradigm as the protocol's own
            // `ensureOverlayIndex`, armed from THIS assembly because this is
            // the one seam both mounts share (MetadataProtocolPlugin's
            // delegated mode AND ObjectQLPlugin's built-in
            // `registerProtocol !== false` convenience mode) — a hook on the
            // delegated plugin alone would miss the default mount entirely.
            //
            // Gated on `environmentId === undefined` for exactly the reason the
            // registerApp block above is: per-project (cloud) kernels do not
            // provision these tables locally, so there is no index of ours to
            // tighten there.
            //
            // Deferred to `kernel:ready` because the table has to EXIST first —
            // ObjectQLPlugin creates it in `start()` via `syncRegisteredSchemas`,
            // which runs after every plugin's `init()`.
            //
            // Wrapped so it can NEVER fail a bootstrap: `kernel:ready` handlers
            // propagate, and an index we could not tighten is not a reason to
            // refuse to boot. (`ensureOverlayIndex` gets this by wrapping its
            // whole body in a swallow-everything try/catch; the same guarantee,
            // stated once here, keeps the migration itself readable.)
            // #8629 rides the SAME seam and the same gate, for the same reasons
            // — `sys_setting`'s declared row identity
            // (`namespace, key, scope, user_id`) is NULL-distinct on `user_id`,
            // which is NULL on every row that is not `scope='user'`, so the
            // constraint is void on exactly the tenant and global layers.
            //
            // Two differences from its sibling, both handled inside the
            // migration rather than here: `sys_setting` is registered by the
            // OPTIONAL `service-settings`, so the table may legitimately not
            // exist on this kernel (probed for, and its absence is a silent
            // no-op); and the tightening can be REFUSED by existing duplicate
            // rows, which per the 2026-08-14 ruling leaves the previous index in
            // place and hands the operator the list — never a keep-one rule.
            //
            // Separate try/catch per migration, deliberately: they protect
            // different tables and one that could not be armed must not skip the
            // other.
            if (environmentId === undefined) {
                (ctx as any)?.hook?.('kernel:ready', async () => {
                    try {
                        await ensureViewDefinitionActiveIndex(resolveIndexExec(ql), ctx.logger);
                    } catch (e: unknown) {
                        ctx.logger.warn(
                            '[metadata-protocol] sys_view_definition active-row index migration skipped (#5839)',
                            { error: e instanceof Error ? e.message : String(e) },
                        );
                    }
                    try {
                        await ensureSysSettingIdentityIndex(resolveSysSettingIndexExec(ql), ctx.logger);
                    } catch (e: unknown) {
                        ctx.logger.warn(
                            '[metadata-protocol] sys_setting row-identity index migration skipped (#8629)',
                            { error: e instanceof Error ? e.message : String(e) },
                        );
                    }
                    // #8686 rides the same seam and the same gate, with one
                    // difference worth stating: its two siblings above tighten an
                    // INDEX, while this one moves stored ROWS. That is why it is
                    // guarded on the install being single-tenant and on there
                    // being exactly one organization to adopt — where the owner is
                    // not derivable it reports and changes nothing, per the
                    // 2026-08-15 ruling (shape 2, multi-tenant skips loudly).
                    //
                    // Boot is the right moment for the EXISTING-install half: the
                    // rows are already written and the split is already there. The
                    // FRESH-install half cannot be done here — at first boot no
                    // organization exists yet — and is handled at the first-admin
                    // handoff instead (see runtime's app-plugin).
                    try {
                        await backfillSeedTenancy(resolveSeedTenancySeam(ql), ctx.logger);
                    } catch (e: unknown) {
                        ctx.logger.warn(
                            '[metadata-protocol] seed/API tenancy backfill skipped (#8686)',
                            { error: e instanceof Error ? e.message : String(e) },
                        );
                    }
                });
            }

            // NO `analytics` fallback rides here anymore (#3891 / #3878). The
            // degraded shim this assembly used to register dropped the request's
            // ExecutionContext (aggregates ran without RLS/tenant predicates)
            // and ignored the contract filter field `where` — a 200 with wrong
            // numbers. The slot now stays empty: `/analytics/*` answers 404
            // (ROUTE_NOT_FOUND) and discovery reports the service unavailable
            // until @objectstack/service-analytics registers the real engine.

    return protocolShim;
}
