// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/metadata — Metadata Storage Objects
 *
 * `sys_metadata` + `sys_metadata_history` are the canonical, single-source-of-truth
 * storage substrate for ALL metadata customisations (see ADR 0005). The previously
 * shipped per-type projection objects (`sys_object`, `sys_view`, `sys_flow`,
 * `sys_agent`, `sys_tool`) were removed in 2026-05 — they duplicated Zod schemas
 * from `@objectstack/spec` and the projection pipeline they fed has been removed
 * along with them. Out-of-box metadata lives in the compiled artifact (loaded by
 * `SchemaRegistry`); customer overrides live in `sys_metadata` as JSON.
 */

export { SysMetadataObject, SysMetadataObject as SysMetadata } from './sys-metadata.object.js';
export { SysMetadataHistoryObject } from './sys-metadata-history.object.js';
