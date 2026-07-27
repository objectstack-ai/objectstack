// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataProtocolPlugin — ADR-0076 Step 2 (#2462, cross-repo window).
 *
 * Owns what `ObjectQLPlugin` historically assembled inline: the
 * `ObjectStackProtocolImplementation` construction + `protocol` service
 * registration, the metadata-storage platform objects, and the lightweight
 * `analytics` fallback. Registering it NEXT TO `ObjectQLPlugin` (with
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
import { SERVICE_SELF_INFO_KEY, type ServiceSelfInfo } from '@objectstack/spec/api';
import {
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataCommitObject,
    SysMetadataAuditObject,
    SysViewDefinitionObject,
} from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

export interface MetadataProtocolPluginOptions {
    /**
     * Per-project scope (cloud per-env kernels). When set, `saveMetaItem`
     * stamps `environment_id` on new sys_metadata rows, `loadMetaFromDb`
     * filters by it, and the metadata-storage objects are NOT provisioned
     * locally (per-project kernels source metadata from the control plane).
     * Mirrors `ObjectQLPluginOptions.environmentId` — pass the same value.
     */
    environmentId?: string;
}

export function createMetadataProtocolPlugin(options: MetadataProtocolPluginOptions = {}): Plugin {
    const { environmentId } = options;
    return {
        name: 'com.objectstack.metadata.protocol',
        version: '1.0.0',
        dependencies: ['com.objectstack.engine.objectql'],

        init: async (ctx: PluginContext) => {
            const ql: any = ctx.getService('objectql');

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

            assembleMetadataProtocol(ctx, ql, environmentId);
        },
    };
}

/**
 * The ONE protocol assembly (ADR-0076 Step 2 PR-C): metadata-storage platform
 * objects + `ObjectStackProtocolImplementation` as the `protocol` service +
 * the D12 `degraded` analytics fallback. Called by
 * {@link createMetadataProtocolPlugin} (delegated mode) AND by
 * `ObjectQLPlugin`'s built-in convenience mode (`registerProtocol !== false`)
 * — single source, two mounts, identical result.
 *
 * @returns the protocol shim, so the engine-side caller can arm its
 * mutation-rebind subscription synchronously.
 */
export function assembleMetadataProtocol(
    ctx: PluginContext,
    ql: any,
    environmentId?: string,
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

            const protocolShim = new ObjectStackProtocolImplementation(
                ql,
                () => (ctx.getServices ? ctx.getServices() : new Map()),
                environmentId,
            );
            ctx.registerService('protocol', protocolShim);
            ctx.logger.info('Protocol service registered (MetadataProtocolPlugin)');

            // Lightweight `analytics` fallback mapped onto the protocol shim's
            // `analyticsQuery` — kept with the protocol assembly so `/analytics`
            // keeps answering on installs without service-analytics. Honest
            // capabilities (ADR-0076 D12): self-identifies as `degraded`;
            // AnalyticsServicePlugin replaces it (ctx.replaceService) with the
            // real engine.
            ctx.registerService('analytics', {
                [SERVICE_SELF_INFO_KEY]: {
                    status: 'degraded',
                    handlerReady: true,
                    message: 'Lightweight ObjectQL analytics fallback — install @objectstack/service-analytics for the full engine',
                } satisfies ServiceSelfInfo,
                // HttpDispatcher passes the raw POST body (AnalyticsQuery
                // shape); the shim's `analyticsQuery` expects the wrapped
                // `{ cube, query }` envelope and returns its own `{ success,
                // data }` — reshape in, unwrap out (one level), exactly as the
                // historical inline adapter did.
                query: async (body: any) => {
                    const envelope = body && typeof body === 'object' && 'query' in body && 'cube' in body
                        ? body
                        : { cube: body?.cube, query: body };
                    const result = await protocolShim.analyticsQuery(envelope);
                    if (result && typeof result === 'object' && 'success' in result && 'data' in result) {
                        return (result as any).data;
                    }
                    return result;
                },
                getMeta: async () => ({
                    cubes: [],
                    message: 'Analytics meta endpoint not implemented by ObjectQL adapter',
                }),
                generateSql: async (_body: any) => ({
                    sql: null,
                    message: 'Analytics SQL generation not implemented by ObjectQL adapter',
                }),
            });

    return protocolShim;
}
