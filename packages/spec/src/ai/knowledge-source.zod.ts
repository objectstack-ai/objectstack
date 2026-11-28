// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ROUTER_ADDRESSABLE_NAME_MESSAGE, ROUTER_ADDRESSABLE_NAME_PATTERN } from '../kernel/address-grammar';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { lazySchema } from '../shared/lazy-schema';
import { enumWithRetiredValues, retiredKey } from '../shared/retired-key';
import { strictObject } from '../shared/strict-object';

/**
 * Knowledge Source — the governed metadata type `knowledge_source`
 * (ADR-0161 K4): what the knowledge service indexes, from which object, and
 * through which adapter.
 *
 * One schema for every door (ADR-0005, ADR-0161 K4 point 3): a
 * `*.knowledge-source.ts` file in a package, a save through Studio or MCP,
 * and a registration in code all parse with {@link KnowledgeSourceSchema}.
 *
 * See `content/docs/protocol/knowledge.mdx` for the design.
 */

/** What silently happened to an undeclared key before the shapes below were closed. */
const DROPPED_BEFORE_19 =
  'Before @objectstack/spec 19 the parse dropped a key this shape does not declare, so it changed nothing.';

/** The sentence every tombstone below ends with (`shared/retired-key-migrate-sentence.test.ts` pins its shape). */
const MIGRATE_18 =
  'Run `os migrate meta --from 18` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * What the author of a registration in code does, said in every prescription
 * below that names the command. Every source written against 18 is such a
 * registration: no stack could hold `knowledgeSources` before this type, and
 * `os migrate meta` replays its conversions over a stack's collections, never
 * over a plugin's options or a `registerSource` call. It stands before the
 * `os migrate meta` sentence, which stays the last one of its prescription.
 */
const CODE_DOOR_18 =
  'A source registered in code (`KnowledgeServicePlugin({ sources })`, `registerSource`) is in no stack collection, '
  + 'so `os migrate meta` lists no edit for it: make this edit in the registration itself. ';

/**
 * The prescription for `source.kind: 'file'` and `'http'`, and for the four
 * keys those two arms carried (ADR-0161 K4, point 1): the arms had no reader.
 */
const NON_OBJECT_ARM_RETIRED =
  'The `file` and `http` shapes of `knowledge_source.source` were removed in @objectstack/spec 19.0.0 (ADR-0161 K4) — '
  + 'nothing read `prefix`, `mimeTypes`, `urls` or `userAgent`: such a source was never ingested by the platform, '
  + 'and its hits skipped the permission re-read. A knowledge source indexes the records of one object: write '
  + '`source: { kind: \'object\', object, content }`. A corpus that lives outside the platform has no form in this '
  + 'version; it returns as a designed arm with the adapter that parses it. '
  + 'This edit left `os migrate meta` with no rewrite: the two shapes have no mapping, so the source is rewritten by hand.';

/** Refresh strategies for a knowledge source. */
export const KnowledgeRefreshPolicySchema = lazySchema(() => strictObject(
  { surface: 'this refresh policy', history: DROPPED_BEFORE_19 },
  {
    /**
     * Keep the index in step with record events (insert, update, delete) and
     * guard hard deletes. `false` hands the index to an external indexer:
     * the service neither syncs nor builds the source.
     */
    onRecordChange: z.boolean().default(true).optional()
      .describe('Sync the index from record events (default true); false leaves the index to an external indexer'),
    /**
     * [ADR-0161 K6] Retired: the slot was parsed and reached no engine.
     */
    cron: retiredKey(
      '`knowledge_source.refresh.cron` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6) — '
      + 'it was parsed and reached no engine: nothing ever scheduled a reindex from it. Delete the key. '
      + 'To rebuild on a schedule, call `reindexSource` from a flow or a job; keeping the index correct between '
      + 'events is the service\'s reconcile pass. '
      + CODE_DOOR_18
      + MIGRATE_18,
    ),
  },
));

/** The split strategies of the knowledge service's splitter (ADR-0161 K8, item 10). */
export const KnowledgeSplitStrategySchema = lazySchema(() => z.enum(['whole', 'recursive', 'markdown']));

/**
 * How the knowledge service cuts this source's documents into passages
 * (ADR-0161 K8, item 10). Read by the service's splitter, which hands the
 * passages to an adapter that declares `capabilities.chunks`; an adapter
 * that does not declare it receives whole documents and this key does not
 * apply to it.
 *
 * - `whole` — one passage per document. A document whose token estimate is
 *   over the embedder's input budget is removed from the index and reported,
 *   never truncated.
 * - `recursive` — cut at blank lines, then line breaks, then sentence ends
 *   (`。？！`, and `. ? !` only before whitespace or the end of the text), then
 *   semicolons, then characters, never inside a Markdown table or list item
 *   while it fits; adjacent short pieces are merged up to `minChars`.
 * - `markdown` — one section per heading; each passage carries its heading
 *   path, which counts toward its length and is embedded with it.
 *
 * The effective `maxChars` is the smaller of this value (or the settings
 * page's `knowledge.chunk_target`, or 800) and what fits in 80% of the
 * embedder's input limit by the shared token estimate.
 */
export const KnowledgeSplitSchema = lazySchema(() => strictObject(
  { surface: 'this split', history: DROPPED_BEFORE_19 },
  {
    /** Which splitter strategy cuts the documents. */
    strategy: KnowledgeSplitStrategySchema.describe('Split strategy: whole, recursive or markdown'),
    /**
     * Longest passage, in characters. Wins over the settings page's
     * `knowledge.chunk_target`; the embedder's input limit can lower it.
     * Not read by `whole`.
     */
    maxChars: z.number().int().positive().optional()
      .describe('Longest passage in characters; wins over the settings default, the embedder limit can lower it'),
    /**
     * Adjacent pieces shorter than this are merged, up to this length
     * (`recursive` and `markdown`). A value above the effective `maxChars`
     * reads as `maxChars`. @default 200
     */
    minChars: z.number().int().nonnegative().optional()
      .describe('Adjacent pieces shorter than this are merged up to it (default 200); a value above the effective maxChars reads as maxChars'),
  },
));

/**
 * What a source indexes: the records of one object (ADR-0161 K4, "Referencing
 * objects"). `kind` keeps one arm; the `file` and `http` arms retired with
 * their four keys (K4, point 1).
 */
export const ObjectKnowledgeSourceSchema = lazySchema(() => strictObject(
  {
    surface: 'this knowledge source\'s `source`',
    history: DROPPED_BEFORE_19,
    aliases: { fields: 'content', objectName: 'object', filter: 'where', metadata: 'metadataFields' },
    guidance: {
      prefix: NON_OBJECT_ARM_RETIRED,
      mimeTypes: NON_OBJECT_ARM_RETIRED,
      urls: NON_OBJECT_ARM_RETIRED,
      userAgent: NON_OBJECT_ARM_RETIRED,
    },
  },
  {
    kind: enumWithRetiredValues(['object'], { file: NON_OBJECT_ARM_RETIRED, http: NON_OBJECT_ARM_RETIRED })
      .describe('What the source indexes; `object` is the one kind'),
    /** Short object name (e.g. `task`, `kb_article`). */
    object: z.string().describe('Short object name to index'),
    /**
     * The fields whose text becomes the document body, in order (ADR-0161 K5).
     *
     * Embedding is egress: the text of every field listed here is sent to the
     * embedder and kept in an index outside the row store. So the list is
     * explicit — `'*'` is refused — and a field added to the object later does
     * not leave until an author adds it here. Credential-class and `internal`
     * fields are never indexed, even when named.
     */
    content: z.array(
      // A length and a pattern, not a `.refine()`: the published JSON Schema
      // then refuses the member too, so a document validated against the file
      // is not refused a release later by the parse. The length refuses the
      // empty string, which names no field and indexed nothing.
      z.string().min(1, {
        message:
          '`knowledge_source.source.content` lists field names: an empty string names no field, so nothing is '
          + 'indexed for that member. Remove the member, or write the name of the field whose text should be '
          + 'indexed, for example `content: [\'title\', \'body\']`.',
      }).regex(/^(?!\*$)/, {
        message:
          '`knowledge_source.source.content` lists field names: the `\'*\'` member was removed in @objectstack/spec '
          + '19.0.0 (ADR-0161 K5) — embedding is egress, and `\'*\'` sent every text field of the record to the '
          + 'embedder, including one added to the object later. List the fields whose text should be indexed, '
          + 'for example `content: [\'title\', \'body\']`. '
          + CODE_DOOR_18
          + 'Run `os migrate meta --from 18` to list the mechanical edits for the renamed-key case; `--write` applies the ones it can prove, and reports a wildcard member for you to replace by hand.',
      }),
    ).min(1).describe('Fields whose text is indexed, in order; every name is listed (no wildcard)'),
    /**
     * [ADR-0161 K6] Retired spelling of {@link content}.
     */
    contentFields: retiredKey(
      '`knowledge_source.source.contentFields` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6) — '
      + 'the key is spelled `content` now that a source is a metadata item; use `content`. '
      + 'Rename the key; the value (a list of field names) is unchanged, except that a `\'*\'` member is no longer '
      + 'accepted and is replaced by the field names it stood for. '
      + CODE_DOOR_18
      + MIGRATE_18,
    ),
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
    /**
     * How the knowledge service cuts this object's documents into passages
     * ({@link KnowledgeSplitSchema}). Omitted ⇒ `recursive` with the settings
     * page's `knowledge.chunk_target` (or 800) as `maxChars`.
     */
    split: KnowledgeSplitSchema.optional()
      .describe('How the service cuts this object\'s documents into passages; omitted means recursive'),
  },
));

/**
 * Canonical KnowledgeSource — the one schema of the governed metadata type
 * `knowledge_source` (ADR-0161 K4; ADR-0088's three clauses are answered
 * there).
 *
 * A source is an item with a lifecycle of its own: it ships in a package as a
 * `*.knowledge-source.ts` (or `.yml`) file under the stack's
 * `knowledgeSources` collection, and it is created or changed at run time
 * through Studio and MCP. The knowledge service reads the published items,
 * registers each one, builds and syncs its index, and reloads it when it
 * changes; removing the item drops its index. It takes no environment overlay
 * (ADR-0005).
 *
 * A source is identified by its package and its `name` (ADR-0150, addendum of
 * 2026-11-25): two packages may each ship a source of one name. Where the
 * name crosses the AI face — `search_knowledge`'s `sources` list and its
 * `sourceIds` argument — a package's source is spelled `NAMESPACE-NAME` and an
 * environment source keeps its bare name.
 *
 * Registration in code (`KnowledgeServicePlugin({ sources })`,
 * `IKnowledgeService.registerSource`) stays a door for this same schema and
 * parses with it.
 *
 * Authoring a source is an egress decision: its listed fields are sent to the
 * embedding provider on the first build. Creating or changing one at run time
 * needs the `manage_knowledge_sources` capability beside `manage_metadata`.
 *
 * Every key below has a reader; an undeclared key is refused, never dropped.
 */
export const KnowledgeSourceSchema = lazySchema(() => strictObject(
  {
    surface: 'this knowledge source',
    history: DROPPED_BEFORE_19,
    aliases: { title: 'label', object: 'source', exposed: 'aiExposed' },
  },
  {
    /**
     * The source's machine name. With the package that ships it, it
     * identifies the source; it is also what its index is keyed by.
     */
    name: z.string().regex(ROUTER_ADDRESSABLE_NAME_PATTERN, { message: ROUTER_ADDRESSABLE_NAME_MESSAGE })
      .describe('Source machine name (snake_case) — what search_knowledge lists and its sourceIds argument names'),
    /**
     * [ADR-0161 K6] Retired spelling of {@link name}.
     */
    id: retiredKey(
      '`knowledge_source.id` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6) — '
      + 'a knowledge source is a metadata item, and an item is identified by `name`; use `name`. '
      + 'Rename the key; the value is unchanged, so the source\'s index is found again and is not rebuilt. '
      + CODE_DOOR_18
      + MIGRATE_18,
    ),
    /** Human-readable label. */
    label: z.string(),
    /** Optional description. */
    description: z.string().optional(),
    /**
     * [ADR-0161 K4] Adapter id this source binds to (e.g. `'pgvector'`,
     * `'memory'`), as an adapter registered it
     * (`IKnowledgeService.registerAdapter`). Omitted ⇒ the deployment's
     * adapter: the store the runtime mounted beside the knowledge service
     * (`pgvector` on PostgreSQL, `turso` otherwise), else the only adapter
     * registered. With several registered and none the deployment's, an
     * omitted adapter is refused, naming the ones registered.
     */
    adapter: z.string().optional()
      .describe("Adapter id; omitted means the deployment's store (pgvector on PostgreSQL, turso otherwise), else the only adapter registered"),
    /**
     * [ADR-0161 K4, K6] Retired: no adapter reads per-source configuration.
     */
    adapterConfig: retiredKey(
      '`knowledge_source.adapterConfig` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6) — '
      + 'no adapter read it: its one reader was the retired RAGFlow adapter. Delete the key. '
      + 'An adapter takes its settings as options of the plugin that mounts it. '
      + CODE_DOOR_18
      + MIGRATE_18,
    ),
    /** What gets indexed. */
    source: ObjectKnowledgeSourceSchema,
    /**
     * [ADR-0161 K6] Retired: never read.
     */
    embedding: retiredKey(
      '`knowledge_source.embedding` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6) — '
      + 'it was never read: no service and no adapter chose a model from it. Delete the key. '
      + 'The embedder is configured once for the deployment, and every source is embedded by it. '
      + CODE_DOOR_18
      + MIGRATE_18,
    ),
    /**
     * [ADR-0161 K6] Retired: never read.
     */
    vectorStore: retiredKey(
      '`knowledge_source.vectorStore` was removed in @objectstack/spec 19.0.0 (ADR-0161 K6) — '
      + 'it was never read: no service and no adapter chose a store from it. Delete the key. '
      + 'The store is the adapter the deployment installs, named by `adapter`. '
      + CODE_DOOR_18
      + MIGRATE_18,
    ),
    /**
     * Refresh / sync configuration. Omitted ⇒ parses to `{}`.
     */
    refresh: KnowledgeRefreshPolicySchema.default({}).optional()
      .describe('Refresh / sync configuration; omitted parses to `{}`'),
    /** Whether `search_knowledge` may expose this source to AI agents. */
    aiExposed: z.boolean().default(true).optional(),
    ...MetadataProtectionFields,
  },
));

export type KnowledgeRefreshPolicy = z.input<typeof KnowledgeRefreshPolicySchema>;
/** Post-parse shape of {@link KnowledgeRefreshPolicy} — defaults applied (ADR-0122). */
export type KnowledgeRefreshPolicyParsed = z.infer<typeof KnowledgeRefreshPolicySchema>;
export type KnowledgeSplitStrategy = z.input<typeof KnowledgeSplitStrategySchema>;
/** Post-parse shape of {@link KnowledgeSplitStrategy} (ADR-0122). */
export type KnowledgeSplitStrategyParsed = z.infer<typeof KnowledgeSplitStrategySchema>;
export type KnowledgeSplit = z.input<typeof KnowledgeSplitSchema>;
/** Post-parse shape of {@link KnowledgeSplit} (ADR-0122). */
export type KnowledgeSplitParsed = z.infer<typeof KnowledgeSplitSchema>;
export type ObjectKnowledgeSource = z.input<typeof ObjectKnowledgeSourceSchema>;
export type KnowledgeSource = z.input<typeof KnowledgeSourceSchema>;
/** Post-parse shape of {@link KnowledgeSource} — defaults applied (ADR-0122). */
export type KnowledgeSourceParsed = z.infer<typeof KnowledgeSourceSchema>;
