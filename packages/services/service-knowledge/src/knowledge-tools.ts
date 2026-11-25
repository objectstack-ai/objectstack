// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AIToolDefinition, IKnowledgeService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';

/**
 * The knowledge AI tool, `search_knowledge`, defined once with one executor
 * (ADR-0149 D2).
 *
 * ## One definition, every door
 *
 * {@link getKnowledgeToolDefinitions} is the tool's `AIToolDefinition`: its
 * name (the one `PLATFORM_TOOLS_BY_PACKAGE['service-ai']` lists), the
 * description the model reads and the JSON Schema of its arguments.
 * {@link createKnowledgeTools} binds the executor to a knowledge service. The
 * MCP door registers the definition as handed over and calls
 * `searchKnowledge` with the principal it binds; an in-product registry
 * registers the same definition and delegates to the same executor. Neither
 * owns a copy of the shape or of the executor.
 *
 * ## Only AI-exposed sources (`aiExposed`)
 *
 * `KnowledgeSource.aiExposed` says whether `search_knowledge` may expose a
 * source to an AI agent (default `true`). The tool enforces it HERE, in its
 * executor, for every call: the sources it searches are the registered
 * sources whose `aiExposed` is not `false`, and a `sourceIds` entry naming
 * any other id, an unexposed source included, is refused `NOT_FOUND` with the
 * same sentence an unknown id gets, so the refusal never tells an agent that a
 * withheld source exists. `IKnowledgeService.search` itself keeps searching
 * an explicitly named source whatever its `aiExposed`: that service also
 * serves the platform's own callers, which are not agents, and `aiExposed`
 * governs what the AGENT tool may expose.
 *
 * ## No second gate, none bypassed (ADR-0090 D10)
 *
 * Every call reaches data only through `IKnowledgeService.search` with the
 * caller's `ExecutionContext`, which re-checks each object-source hit against
 * the caller's row-level security and drops object-source hits when no
 * identity is passed. The executor adds no permission of its own and removes
 * none: a delegated agent's context reads what its delegating person reads.
 */

/** The knowledge search tool's name: the one the `service-ai` group of the platform tool registry lists. */
export const SEARCH_KNOWLEDGE_TOOL_NAME = 'search_knowledge';

/** The most hits one `search_knowledge` answer carries; its definition states it. */
export const SEARCH_KNOWLEDGE_MAX_TOP_K = 20;

/** The hits one `search_knowledge` answer carries when the call names no `topK`. */
export const SEARCH_KNOWLEDGE_DEFAULT_TOP_K = 5;

/** The arguments `search_knowledge` takes, as its definition's JSON Schema declares them. */
export interface SearchKnowledgeInput {
  query: string;
  sourceIds?: string[];
  topK?: number;
}

/** One searchable source, as a `search_knowledge` answer names it. */
export interface SearchKnowledgeSourceSummary {
  id: string;
  label: string;
  description?: string;
}

/** One hit of a `search_knowledge` answer. */
export interface SearchKnowledgeHit {
  /** The source the hit came from. */
  sourceId: string;
  /** The document the hit is part of. */
  documentId: string;
  /** The document's title, where the source gives one. */
  title?: string;
  /** The passage that matched. */
  snippet: string;
  /** Relevance, higher is better. */
  score: number;
  /** The record the passage was indexed from, for an object source: read it with the record tools. */
  record?: { object: string; id: string };
}

/**
 * A source that could not be searched for this call (ADR-0161 K7, rule 5):
 * its index needs a rebuild, or is being rebuilt, or its store refused for
 * another coded reason. Its passages are missing from `hits` — not absent
 * from the source.
 */
export interface SearchKnowledgeRefusedSource {
  sourceId: string;
  /** The refusal's ADR-0112 code, e.g. `KNOWLEDGE_REBUILD_REQUIRED`. */
  code: string;
  /** What the store said. */
  message: string;
}

/** A `search_knowledge` answer. */
export interface SearchKnowledgeOutput {
  /** The passages, most relevant first, at most `topK`. */
  hits: SearchKnowledgeHit[];
  /** Every source this tool may search; `sourceIds` takes their `id`s. */
  sources: SearchKnowledgeSourceSummary[];
  /**
   * The searched sources that refused this call, each with its code; absent
   * when none did. When every searched source refuses, the call itself is
   * refused with the first refusal's code.
   */
  refused?: SearchKnowledgeRefusedSource[];
}

/** The executor {@link createKnowledgeTools} binds. */
export interface KnowledgeTools {
  /** The tool's `AIToolDefinition` ({@link getKnowledgeToolDefinitions}). */
  readonly definitions: readonly AIToolDefinition[];
  /**
   * Run one `search_knowledge` call AS `context`. Refuses, by throwing an
   * ADR-0112 coded error (`code` and `status`), malformed arguments
   * (`VALIDATION_ERROR`, 400) and a `sourceIds` entry that names no source
   * this tool may search (`NOT_FOUND`, 404).
   */
  searchKnowledge(input: unknown, context?: ExecutionContext): Promise<SearchKnowledgeOutput>;
}

const SEARCH_KNOWLEDGE_DESCRIPTION =
  'Search the knowledge sources this app indexes (policies, manuals, articles, records indexed for retrieval) by '
  + 'meaning, and answer with the most relevant passages, each naming its source and, for an indexed record, the '
  + 'record it came from. Use it before answering a question the app\'s own documents or knowledge base should '
  + 'answer, and cite the passages you used. Send `query` as a short natural-language statement of what you are '
  + 'looking for. Omit `sourceIds` to search every source; every answer lists the sources this tool may search, '
  + 'and `sourceIds` takes their ids. `topK` caps the passages (default '
  + `${SEARCH_KNOWLEDGE_DEFAULT_TOP_K}, at most ${SEARCH_KNOWLEDGE_MAX_TOP_K}). Only passages the caller may read `
  + 'are returned: a passage indexed from a record the caller cannot read is dropped; on an OAuth connection, the '
  + 'person\'s own permissions decide, never more. No passage means nothing the caller may read matched: say so '
  + 'rather than answer from general knowledge. A source listed in `refused` could not be searched (its index is '
  + 'being rebuilt, for example): its passages are missing, not absent, so say that this source could not be '
  + 'searched rather than that it holds nothing.';

const SEARCH_KNOWLEDGE_PARAMETERS: Record<string, unknown> = Object.freeze({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      minLength: 1,
      description: 'What to look for, as a short natural-language statement',
    },
    sourceIds: {
      type: 'array',
      items: { type: 'string', minLength: 1 },
      minItems: 1,
      description: 'Only these sources (at least one), by the ids an answer lists in `sources`; omit to search every source',
    },
    topK: {
      type: 'integer',
      minimum: 1,
      maximum: SEARCH_KNOWLEDGE_MAX_TOP_K,
      description: `At most this many passages (default ${SEARCH_KNOWLEDGE_DEFAULT_TOP_K})`,
    },
  },
  required: ['query'],
  additionalProperties: false,
});

let cachedDefinitions: readonly AIToolDefinition[] | undefined;

/**
 * The knowledge tool's `AIToolDefinition`. Static: it depends on no host, so
 * a registry may list it before any executor is bound. Built on first call
 * and memoized.
 */
export function getKnowledgeToolDefinitions(): readonly AIToolDefinition[] {
  if (cachedDefinitions === undefined) {
    cachedDefinitions = Object.freeze([
      Object.freeze({
        name: SEARCH_KNOWLEDGE_TOOL_NAME,
        label: 'Search knowledge',
        description: SEARCH_KNOWLEDGE_DESCRIPTION,
        parameters: SEARCH_KNOWLEDGE_PARAMETERS,
      }),
    ]);
  }
  return cachedDefinitions;
}

/** An ADR-0112 coded refusal: `code` and `status` on the thrown error, the message the caller reads. */
export function refusal(code: 'VALIDATION_ERROR' | 'NOT_FOUND', status: 400 | 404, message: string): Error {
  return Object.assign(new Error(message), { code, status });
}

const INPUT_KEYS: ReadonlySet<string> = new Set(['query', 'sourceIds', 'topK']);

/** The call's arguments, or a `VALIDATION_ERROR` naming the first one that is wrong. */
function parseInput(input: unknown): SearchKnowledgeInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw refusal('VALIDATION_ERROR', 400, `${SEARCH_KNOWLEDGE_TOOL_NAME} takes an object with a \`query\` string.`);
  }
  const record = input as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !INPUT_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw refusal(
      'VALIDATION_ERROR',
      400,
      `${SEARCH_KNOWLEDGE_TOOL_NAME} does not take ${unknownKeys.map((k) => `\`${k}\``).join(', ')}; it takes `
        + '`query`, `sourceIds` and `topK`.',
    );
  }
  const query = typeof record.query === 'string' ? record.query.trim() : '';
  if (!query) {
    throw refusal('VALIDATION_ERROR', 400, `${SEARCH_KNOWLEDGE_TOOL_NAME} needs a non-empty \`query\` string.`);
  }
  const parsed: SearchKnowledgeInput = { query };
  if (record.sourceIds !== undefined) {
    if (!Array.isArray(record.sourceIds) || record.sourceIds.some((id) => typeof id !== 'string' || id.trim() === '')) {
      throw refusal('VALIDATION_ERROR', 400, '`sourceIds` is a list of source ids, as an answer lists them in `sources`.');
    }
    // An empty list names no source. Refused rather than read as "every
    // source" or as "none": searching nothing would answer no passage, which
    // this tool's description tells the model to report as "nothing matched".
    if (record.sourceIds.length === 0) {
      throw refusal(
        'VALIDATION_ERROR',
        400,
        '`sourceIds` names no source: omit it to search every source, or name at least one id an answer lists in `sources`.',
      );
    }
    parsed.sourceIds = [...new Set((record.sourceIds as string[]).map((id) => id.trim()))];
  }
  if (record.topK !== undefined) {
    const topK = record.topK;
    if (typeof topK !== 'number' || !Number.isInteger(topK) || topK < 1 || topK > SEARCH_KNOWLEDGE_MAX_TOP_K) {
      throw refusal('VALIDATION_ERROR', 400, `\`topK\` is a whole number from 1 to ${SEARCH_KNOWLEDGE_MAX_TOP_K}.`);
    }
    parsed.topK = topK;
  }
  return parsed;
}

/** The sources `search_knowledge` may search: every registered source whose `aiExposed` is not `false`. */
function searchableSources(service: IKnowledgeService): KnowledgeSource[] {
  return service.listSources().filter((source) => source.aiExposed !== false);
}

function summarize(source: KnowledgeSource): SearchKnowledgeSourceSummary {
  return {
    id: source.id,
    label: source.label,
    ...(source.description ? { description: source.description } : {}),
  };
}

function hitOf(hit: KnowledgeHit, sources: ReadonlyMap<string, KnowledgeSource>): SearchKnowledgeHit {
  const source = sources.get(hit.sourceId);
  const object = source?.source.kind === 'object' ? (source.source as ObjectKnowledgeSource).object : undefined;
  return {
    sourceId: hit.sourceId,
    documentId: hit.documentId,
    ...(hit.title ? { title: hit.title } : {}),
    snippet: hit.snippet,
    score: hit.score,
    ...(object && hit.sourceRecordId ? { record: { object, id: hit.sourceRecordId } } : {}),
  };
}

/** A knowledge service that also answers the sources that refused a search (`KnowledgeService.searchWithRefusals`). */
interface RefusalReportingService {
  searchWithRefusals(
    query: string,
    opts: Parameters<IKnowledgeService['search']>[1],
  ): Promise<{ hits: KnowledgeHit[]; refused: Array<{ sourceId: string; code: string; message: string }> }>;
}

function hasRefusalReport(service: IKnowledgeService): service is IKnowledgeService & RefusalReportingService {
  return typeof (service as Partial<RefusalReportingService>).searchWithRefusals === 'function';
}

/**
 * Bind the `search_knowledge` executor to a knowledge service. The service is
 * read per call (`service` may be a getter), so the sources a call searches
 * are the ones registered when it runs.
 */
export function createKnowledgeTools(service: IKnowledgeService | (() => IKnowledgeService)): KnowledgeTools {
  const resolve = typeof service === 'function' ? service : () => service;
  return {
    definitions: getKnowledgeToolDefinitions(),
    async searchKnowledge(input, context) {
      const { query, sourceIds, topK } = parseInput(input);
      const knowledge = resolve();
      const searchable = searchableSources(knowledge);
      const byId = new Map(searchable.map((source) => [source.id, source] as const));
      const summaries = searchable.map(summarize);
      if (sourceIds) {
        const unknown = sourceIds.filter((id) => !byId.has(id));
        if (unknown.length > 0) {
          throw refusal(
            'NOT_FOUND',
            404,
            `No knowledge source this tool may search is named ${unknown.map((id) => `"${id}"`).join(', ')}. `
              + (summaries.length > 0
                ? `Searchable sources: ${summaries.map((s) => `"${s.id}"`).join(', ')}; omit \`sourceIds\` to search them all.`
                : 'No source is searchable here.'),
          );
        }
      }
      const targets = sourceIds ?? [...byId.keys()];
      if (targets.length === 0) return { hits: [], sources: summaries };
      // [ADR-0090 D10] As the caller: the service re-checks every object-source
      // hit against this context's row-level security.
      const searchOpts = {
        sourceIds: targets,
        topK: topK ?? SEARCH_KNOWLEDGE_DEFAULT_TOP_K,
        ...(context ? { executionContext: context } : {}),
      };
      // [ADR-0161 K7, rule 5] A refused source is named, never answered as
      // empty: the knowledge service's report carries the refusals beside the
      // hits; a service without it answers hits alone, as before.
      const report = hasRefusalReport(knowledge)
        ? await knowledge.searchWithRefusals(query, searchOpts)
        : { hits: await knowledge.search(query, searchOpts), refused: [] };
      const refused = report.refused
        .filter((r) => byId.has(r.sourceId))
        .map((r) => ({ sourceId: r.sourceId, code: r.code, message: r.message }));
      return {
        hits: report.hits.filter((hit) => byId.has(hit.sourceId)).map((hit) => hitOf(hit, byId)),
        sources: summaries,
        ...(refused.length > 0 ? { refused } : {}),
      };
    },
  };
}
