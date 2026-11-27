// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { KnowledgeSource } from '@objectstack/spec/ai';

/**
 * [ADR-0161 K4] A knowledge source — which records the knowledge service
 * indexes for retrieval, and which of their fields become searchable text.
 *
 * `showcase_task_notes` indexes every task that is not done: the text of
 * `title` and `notes` is the document body, and `status` and `priority` are
 * kept beside each passage so a search can filter on them. The knowledge
 * service loads this item at boot, runs its first build, and keeps the index
 * in step with the tasks as they change; `search_knowledge` over MCP then
 * answers from it, as the caller — a task the caller may not read is not
 * returned.
 *
 * `content` lists its fields by name: what is listed is what leaves the row
 * store for the index (and, with a real embedder, for the embedding
 * provider). A field added to the task later is not indexed until it is
 * added here.
 *
 * `adapter: 'memory'` names the in-memory reference store mounted in
 * objectstack.config.ts — deterministic, no embedder, rebuilt at each boot.
 * A real deployment names a persistent store (`'turso'`, `'pgvector'`).
 */
export const ShowcaseTaskNotesKnowledge: KnowledgeSource = {
  name: 'showcase_task_notes',
  label: 'Task notes',
  description: 'Titles and notes of open tasks, searchable by meaning.',
  adapter: 'memory',
  source: {
    kind: 'object',
    object: 'showcase_task',
    content: ['title', 'notes'],
    metadataFields: ['status', 'priority'],
    where: { status: { $ne: 'done' } },
  },
};
