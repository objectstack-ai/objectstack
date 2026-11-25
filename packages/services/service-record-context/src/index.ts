// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/service-record-context` — the context-pack render service and
 * the `get_record_context` executor (ADR-0160 D3–D5).
 */

export {
  RECORD_CONTEXT_RELATED_MAX_ROWS,
  createRecordContextTools,
  executeGetRecordContext,
  getRecordContextToolDefinitions,
} from './record-context-tools.js';
export type { RecordContextTools } from './record-context-tools.js';
export type { RecordContextDoor } from './door.js';
export { RECORD_CONTEXT_BODY_MAX_CHARS, RECORD_CONTEXT_OUTLINE_MAX_ENTRIES } from './body-outline.js';
export {
  fieldMapOf,
  lookupTargetOf,
  parsedContextPacks,
  planObjectsOf,
  recordContextReadSet,
  resolveRelatedLink,
  selectContextPack,
} from './read-set.js';
export type {
  ContextPackSelection,
  RecordContextMetadataReads,
  RecordContextReadSetArgs,
} from './read-set.js';
export { RECORD_CONTEXT_SERVICE, RecordContextServicePlugin } from './plugin.js';
export type { RecordContextService } from './plugin.js';
