// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Plugin, PluginContext } from '@objectstack/core';
import { createRecordContextTools, type RecordContextTools } from './record-context-tools.js';

/** The service name the record-context service registers under, and the name the MCP doors resolve. */
export const RECORD_CONTEXT_SERVICE = 'record-context' as const;

/**
 * The `record-context` service: what a host resolves to serve
 * `get_record_context` (ADR-0160 D5). Stateless — every call reads through a
 * door its host binds to the caller.
 */
export interface RecordContextService {
  recordContextTools(): RecordContextTools;
}

/**
 * `RecordContextServicePlugin` — registers the `record-context` service.
 *
 * A host that mounts it serves `get_record_context` on its MCP doors (both
 * resolve the service by structure, as they resolve the dataset and knowledge
 * executors); a host without it registers no `get_record_context`, and
 * nothing else changes (ADR-0160 D5). Composition is explicit, by either of
 * two doors: a stack declares `requires: ['record-context']`, which the CLI
 * expands to this plugin (`CAPABILITY_PROVIDERS` in `@objectstack/core`), or a
 * host that composes its own kernel mounts it in `plugins[]` and keeps that
 * instance when the token is declared too.
 *
 * @example
 * ```ts
 * // An app that ships only metadata: the token mounts the plugin.
 * export default defineStack({
 *   // …
 *   requires: ['record-context'],
 *   aiContexts: [policyDocumentPack],
 * });
 * ```
 *
 * @example
 * ```ts
 * // A host that composes its own kernel.
 * import { RecordContextServicePlugin } from '@objectstack/service-record-context';
 *
 * export default defineStack({
 *   // …
 *   aiContexts: [policyDocumentPack],
 *   plugins: [new RecordContextServicePlugin()],
 * });
 * ```
 */
export class RecordContextServicePlugin implements Plugin {
  name = 'com.objectstack.service.record-context';
  version = '0.1.0';
  type = 'standard' as const;

  async init(ctx: PluginContext): Promise<void> {
    const tools = createRecordContextTools();
    const service: RecordContextService = { recordContextTools: () => tools };
    ctx.registerService(RECORD_CONTEXT_SERVICE, service);
  }
}
