// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';
import { lazySchema } from '../shared/lazy-schema';
import { EmbeddingModelSchema, VectorStoreSchema } from './embedding.zod';

/**
 * Knowledge Source — declarative metadata describing what to index and
 * which adapter to use.
 *
 * A KnowledgeSource is the metadata-level equivalent of an
 * `IDataEngine` driver binding: it pairs a logical source description
 * (object/file/http) with the *id* of an `IKnowledgeAdapter` plugin
 * that will actually do the work. The adapter resolves the id at
 * runtime via `IKnowledgeService.registerAdapter`.
 *
 * See `content/docs/protocol/knowledge.mdx` for the full design.
 */

/** Refresh strategies for a knowledge source. */
export const KnowledgeRefreshPolicySchema = lazySchema(() => z.object({
  /**
   * Subscribe to ObjectQL `record.*` events for `object` sources.
   * Defaults to `true` for object sources; ignored for file/http.
   */
  onRecordChange: z.boolean().default(true).optional(),
  /**
   * Cron-dialect expression for a periodic full reindex. Optional.
   *
   * `CronExpressionInputSchema` — the shared cron-dialect input the other
   * cron-shaped fields carry (`api/export.zod.ts`, `automation/execution.zod.ts`,
   * `integration/connector.zod.ts`). A bare string is shorthand for
   * `{ dialect: 'cron', source }`; the parse enforces a non-empty string or an
   * expression envelope and normalizes to the envelope. It does NOT judge cron
   * syntax, and neither does anything downstream: this slot is parsed and
   * reaches no engine. `croner` judges a cron pattern only where a schedule is
   * wired (`CronSchedule.expression`, a different slot), and
   * `@objectstack/formula`'s registered `cron` engine has no caller outside
   * that package — so the syntax verdict belongs to whatever external
   * scheduler the author hands this value to, and the describe below promises
   * exactly what the parse enforces (ADR-0049 declared = enforced; #14825).
   *
   * `service-knowledge` does not schedule the cron itself — it merely
   * surfaces the value so an automation flow / external scheduler can
   * trigger `reindexSource`.
   */
  cron: CronExpressionInputSchema.optional().describe(
    'Cron-dialect expression for a periodic full reindex. A bare string is shorthand for '
    + '`{ dialect: \'cron\', source }`; the parse enforces a non-empty string or an expression '
    + 'envelope and normalizes to the envelope — cron syntax is not checked here, and no engine '
    + 'evaluates this slot: the verdict belongs to whatever external scheduler you hand the value to. '
    + '`service-knowledge` does not schedule it: the value is surfaced so an automation flow / '
    + 'external scheduler can trigger `reindexSource`.',
  ),
}));

/** Source backed by an ObjectQL object — each record becomes a document. */
export const ObjectKnowledgeSourceSchema = lazySchema(() => z.object({
  kind: z.literal('object'),
  /** Short object name (e.g. `task`, `kb_article`). */
  object: z.string().describe('Short object name to index'),
  /**
   * Fields to concatenate into the document body (in order).
   * `*` means "use every readable text field" (adapter / service decides).
   */
  contentFields: z.array(z.string()).min(1).describe('Fields contributing to document content'),
  /**
   * Extra fields to project into `metadata` for filtering at search
   * time (e.g. `status`, `owner_id`, `tags`).
   */
  metadataFields: z.array(z.string()).default([]).optional(),
  /**
   * Optional filter restricting which records are indexed.
   * Uses ObjectQL `where` syntax.
   */
  where: z.record(z.string(), z.unknown()).optional(),
}));

/** Source backed by a folder in `IStorageService`. */
export const FileKnowledgeSourceSchema = lazySchema(() => z.object({
  kind: z.literal('file'),
  /** Storage prefix to scan (e.g. `kb/handbooks/`). */
  prefix: z.string().describe('Storage prefix'),
  /** Optional MIME-type allow-list. Empty = all types. */
  mimeTypes: z.array(z.string()).default([]).optional(),
}));

/** Source backed by a list of remote URLs. */
export const HttpKnowledgeSourceSchema = lazySchema(() => z.object({
  kind: z.literal('http'),
  /** URLs to fetch. */
  urls: z.array(z.string().url()).min(1),
  /** Optional User-Agent header. */
  userAgent: z.string().optional(),
}));

export const KnowledgeSourceKindSchema = lazySchema(() => z.discriminatedUnion('kind', [
  ObjectKnowledgeSourceSchema,
  FileKnowledgeSourceSchema,
  HttpKnowledgeSourceSchema,
]));

/**
 * Canonical KnowledgeSource — the shape of a **runtime registration**,
 * ⛔ not a governed metadata type.
 *
 * It is not stored as metadata, not versioned and not
 * environment-scoped: no knowledge-shaped entry exists in the governed
 * metadata-type registry (`listMetadataTypeSchemaTypes()`), and
 * `ObjectStackDefinitionSchema` carries no collection for it — so
 * `defineStack({ knowledgeSources: [...] })` is refused as an
 * unrecognized top-level key. `view`, `flow`, `skill`, `agent` and
 * `tool` are the types that do work that way; this one does not.
 *
 * A source reaches the runtime through code, for the life of the
 * process: `KnowledgeServicePlugin({ sources: [...] })` at kernel
 * wiring, or `IKnowledgeService.registerSource(source)` afterwards;
 * `listSources()` / `getSource()` read that in-memory registry back.
 * Retrieval is restricted at the knowledge-service/source level —
 * `search_knowledge` takes `sourceIds` — and an agent describes its
 * grounding in `instructions`.
 */
export const KnowledgeSourceSchema = lazySchema(() => z.object({
  /** Stable identifier. Snake_case. */
  id: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Snake_case source id'),
  /** Human-readable label. */
  label: z.string(),
  /** Optional description. */
  description: z.string().optional(),
  /**
   * Adapter id this source binds to (e.g. `'ragflow'`, `'memory'`).
   * Resolved at runtime by `IKnowledgeService.registerAdapter`.
   */
  adapter: z.string().describe('Adapter id'),
  /** Adapter-specific configuration (opaque to the service). */
  adapterConfig: z.record(z.string(), z.unknown()).default({}).optional(),
  /** What gets indexed. */
  source: KnowledgeSourceKindSchema,
  /**
   * Optional embedding model reference. Adapters that manage
   * embeddings internally (RAGFlow, Dify, Vectara) may ignore this.
   */
  embedding: EmbeddingModelSchema.optional(),
  /**
   * Optional vector store reference. Same caveat as `embedding` — many
   * adapters own their own backend.
   */
  vectorStore: VectorStoreSchema.optional(),
  /**
   * Refresh / sync configuration. Omitted ⇒ parses to `{}` — the runtime
   * default, stated here in words because the published input-shape JSON
   * Schema cannot carry it beside `cron`'s transform (#14825).
   */
  refresh: KnowledgeRefreshPolicySchema.default({}).optional().describe(
    'Refresh / sync configuration; omitted parses to `{}` (the runtime default — the published '
    + "input-shape JSON Schema cannot state it beside `cron`'s transform).",
  ),
  /** Whether `search_knowledge` may expose this source to AI agents. */
  aiExposed: z.boolean().default(true).optional(),
}));

export type KnowledgeRefreshPolicy = z.input<typeof KnowledgeRefreshPolicySchema>;
/** Post-parse shape of {@link KnowledgeRefreshPolicy} — defaults applied, transforms run (ADR-0122): `cron` is the `{ dialect: 'cron', source }` envelope. */
export type KnowledgeRefreshPolicyParsed = z.infer<typeof KnowledgeRefreshPolicySchema>;
export type ObjectKnowledgeSource = z.input<typeof ObjectKnowledgeSourceSchema>;
export type FileKnowledgeSource = z.input<typeof FileKnowledgeSourceSchema>;
export type HttpKnowledgeSource = z.input<typeof HttpKnowledgeSourceSchema>;
export type KnowledgeSourceKind = z.input<typeof KnowledgeSourceKindSchema>;
export type KnowledgeSource = z.input<typeof KnowledgeSourceSchema>;
/** Post-parse shape of {@link KnowledgeSource} — defaults applied, transforms run (ADR-0122): `refresh.cron` is the cron envelope. */
export type KnowledgeSourceParsed = z.infer<typeof KnowledgeSourceSchema>;
