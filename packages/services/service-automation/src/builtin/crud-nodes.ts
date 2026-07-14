// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { PluginContext } from '@objectstack/core';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { AutomationEngine } from '../engine.js';
import { interpolate } from './template.js';
import { readAliasedConfig } from './config-aliases.js';
import { resolveRunDataContext } from '../runtime-identity.js';

/**
 * CRUD built-in nodes — `get_record` / `create_record` / `update_record` /
 * `delete_record`, wired to the runtime data layer (ObjectQL / IDataEngine).
 * Part of the platform baseline, so the core {@link AutomationServicePlugin}
 * seeds them directly (ADR-0018) rather than shipping a separate plugin.
 *
 * Each executor:
 *  1. Interpolates `{var}` / `{var.path}` / `{$User.*}` / `{NOW()}` tokens in
 *     `node.config` against the running flow's variable context.
 *  2. Calls the resolved data engine via `ctx.getService('data')`.
 *  3. Writes the result back to the variable context under `outputVariable`
 *     (or under `<nodeId>.id` / `<nodeId>.records` by default), so downstream
 *     nodes can reference fields like `{leadRecord.company}`.
 *
 * If no data engine is registered, executors degrade to a no-op success so
 * test environments without ObjectQL still complete the flow without errors.
 */
export function registerCrudNodes(engine: AutomationEngine, ctx: PluginContext): void {
        const getData = (): IDataEngine | undefined => {
            try {
                return ctx.getService<IDataEngine>('data') ?? ctx.getService<IDataEngine>('objectql');
            } catch {
                return undefined;
            }
        };

        // ── get_record ────────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'get_record',
            descriptor: defineActionDescriptor({
                type: 'get_record', version: '1.0.0', name: 'Get Records',
                description: 'Query records from an object.',
                icon: 'search', category: 'data', source: 'builtin',
            }),
            async execute(node, variables, context) {
                const cfg = (node.config ?? {}) as Record<string, unknown>;
                const objectName = String(readAliasedConfig(cfg, 'get_record', 'objectName', ['object'], ctx.logger) ?? '');
                if (!objectName) return { success: false, error: 'get_record: objectName required' };

                // `filters` → `filter` is now handled at load by the ADR-0087 D2
                // conversion layer ('flow-node-crud-filter-alias'), so the executor
                // reads the canonical key directly (PD #12 fallback retired).
                const filter = interpolate(cfg.filter ?? {}, variables, context) as Record<string, unknown>;
                const fields = cfg.fields as string[] | undefined;
                const limit = typeof cfg.limit === 'number' ? cfg.limit : undefined;
                const outputVariable = cfg.outputVariable as string | undefined;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[get_record] no data engine; skipping ${objectName}`);
                    return { success: true, output: { records: [], object: objectName } };
                }

                // #1888 — honor flow.runAs: read under the run's effective identity
                // (system → RLS-bypassing; user → the triggering user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    if (limit && limit > 1) {
                        const records = await data.find(objectName, { where: filter, fields, limit, context: dataCtx });
                        if (outputVariable) variables.set(outputVariable, records);
                        return { success: true, output: { records, object: objectName } };
                    }
                    const record = await data.findOne(objectName, { where: filter, fields, context: dataCtx });
                    if (outputVariable) variables.set(outputVariable, record);
                    return { success: true, output: { record, id: record?.id, object: objectName } };
                } catch (err) {
                    return { success: false, error: `get_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        // ── create_record ─────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'create_record',
            descriptor: defineActionDescriptor({
                type: 'create_record', version: '1.0.0', name: 'Create Record',
                description: 'Insert a new record into an object.',
                icon: 'plus-circle', category: 'data', source: 'builtin',
            }),
            async execute(node, variables, context) {
                const cfg = (node.config ?? {}) as Record<string, unknown>;
                const objectName = String(readAliasedConfig(cfg, 'create_record', 'objectName', ['object'], ctx.logger) ?? '');
                if (!objectName) return { success: false, error: 'create_record: objectName required' };

                const fields = interpolate(cfg.fields ?? {}, variables, context) as Record<string, unknown>;
                const outputVariable = cfg.outputVariable as string | undefined;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[create_record] no data engine; skipping ${objectName}`);
                    const mockId = `mock-${objectName}-${Date.now()}`;
                    if (outputVariable) variables.set(outputVariable, { id: mockId });
                    return { success: true, output: { id: mockId, object: objectName } };
                }

                // #1888 — honor flow.runAs (system → RLS-bypassing; user → trigger user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    const created = await data.insert(objectName, fields, { context: dataCtx });
                    const createdRecord = Array.isArray(created) ? created[0] : created;
                    const insertedId =
                        createdRecord && typeof createdRecord === 'object'
                            ? (createdRecord as Record<string, unknown>).id
                            : createdRecord;
                    if (outputVariable) {
                        // #1873 — expose the created RECORD so later nodes can reference
                        // `{var.id}` (and other fields), not just the bare id string. When the
                        // driver returns a bare id, wrap it as `{ id }` so `{var.id}` still works.
                        variables.set(
                            outputVariable,
                            createdRecord && typeof createdRecord === 'object' ? createdRecord : { id: insertedId },
                        );
                    }
                    return { success: true, output: { id: insertedId, record: createdRecord, object: objectName } };
                } catch (err) {
                    return { success: false, error: `create_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        // ── update_record ─────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'update_record',
            descriptor: defineActionDescriptor({
                type: 'update_record', version: '1.0.0', name: 'Update Records',
                description: 'Update records matching a filter.',
                icon: 'edit', category: 'data', source: 'builtin',
            }),
            async execute(node, variables, context) {
                const cfg = (node.config ?? {}) as Record<string, unknown>;
                const objectName = String(readAliasedConfig(cfg, 'update_record', 'objectName', ['object'], ctx.logger) ?? '');
                if (!objectName) return { success: false, error: 'update_record: objectName required' };

                // `filters` → `filter` converted at load (ADR-0087 D2); read canonical.
                const filter = interpolate(cfg.filter ?? {}, variables, context) as Record<string, unknown>;
                // `fields` is the single canonical write-map key — no alias (the wrong key
                // `fieldValues` is corrected at the authoring source + rejected by graph-lint).
                const fields = interpolate(cfg.fields ?? {}, variables, context) as Record<string, unknown>;

                const data = getData();
                if (!data) {
                    ctx.logger.warn(`[update_record] no data engine; skipping ${objectName}`);
                    return { success: true };
                }

                // #1888 — honor flow.runAs (system → RLS-bypassing; user → trigger user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    const result = await data.update(objectName, fields, { where: filter, context: dataCtx });
                    return { success: true, output: { result, object: objectName } };
                } catch (err) {
                    return { success: false, error: `update_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        // ── delete_record ─────────────────────────────────────
        engine.registerNodeExecutor({
            type: 'delete_record',
            descriptor: defineActionDescriptor({
                type: 'delete_record', version: '1.0.0', name: 'Delete Records',
                description: 'Delete records matching a filter.',
                icon: 'trash', category: 'data', source: 'builtin',
            }),
            async execute(node, variables, context) {
                const cfg = (node.config ?? {}) as Record<string, unknown>;
                const objectName = String(readAliasedConfig(cfg, 'delete_record', 'objectName', ['object'], ctx.logger) ?? '');
                if (!objectName) return { success: false, error: 'delete_record: objectName required' };

                // `filters` → `filter` converted at load (ADR-0087 D2); read canonical.
                const filter = interpolate(cfg.filter ?? {}, variables, context) as Record<string, unknown>;

                const data = getData();
                if (!data) return { success: true };

                // #1888 — honor flow.runAs (system → RLS-bypassing; user → trigger user).
                const dataCtx = resolveRunDataContext(context);
                try {
                    const result = await data.delete(objectName, { where: filter, context: dataCtx });
                    return { success: true, output: { result, object: objectName } };
                } catch (err) {
                    return { success: false, error: `delete_record(${objectName}) failed: ${(err as Error).message}` };
                }
            },
        });

        ctx.logger.info('[CRUD Nodes] 4 built-in node executors registered (data-backed)');
}
