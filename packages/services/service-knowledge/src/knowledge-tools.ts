// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { AIToolDefinition, IKnowledgeService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { KnowledgeHit, KnowledgeSource, ObjectKnowledgeSource } from '@objectstack/spec/ai';
import { SEARCH_SCOPE_MAX_ENTRIES, SEARCH_SCOPE_MAX_IDS } from './knowledge-search-scope.js';

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
 * ## Scope, record granularity and grouping (ADR-0161 K9, rule 2)
 *
 * `scope`, `granularity` and `groupBy` enter here, in the one definition,
 * and are handed to `IKnowledgeService.search` as its options of the same
 * names; no transport adds an argument of its own. The executor holds each to
 * the bounds its definition states and refuses a malformed one
 * `VALIDATION_ERROR` naming it, before the service is asked: past the
 * service's own bounds, it refuses an empty scope or an entry with no ids (as
 * it refuses an empty `sourceIds`), an id, object or field name longer than
 * {@link SEARCH_KNOWLEDGE_MAX_NAME_LENGTH} or holding a NUL, and `groupBy`
 * with `granularity: 'chunk'`. Because the executor searches only exposed
 * sources, a scope entry or a `groupBy` field that only a withheld source
 * would answer gets the answer one no source answers: no hits.
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

/**
 * The most entries one `scope` argument holds, and the most ids one entry
 * holds: the bounds `IKnowledgeService.search` holds its `scope` option to
 * (`KnowledgeSearchOptions.scope`, `knowledge-search-scope.ts`), read from
 * there and stated in the definition.
 */
export const SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES: number = SEARCH_SCOPE_MAX_ENTRIES;
export const SEARCH_KNOWLEDGE_MAX_SCOPE_IDS: number = SEARCH_SCOPE_MAX_IDS;

/**
 * The longest object name, record id or field name the tool takes, in UTF-16
 * code units: the length the platform stores a record's id and its object's
 * name in (`sys_recycle_bin.record_id` / `object_name`, `maxLength: 255`).
 * A longer one names no record, object or field, so it is refused at the
 * door rather than carried into every adapter's query.
 */
export const SEARCH_KNOWLEDGE_MAX_NAME_LENGTH = 255;

/** What one hit of a `search_knowledge` answer stands for (`KnowledgeSearchOptions.granularity`). */
export type SearchKnowledgeGranularity = 'chunk' | 'record';

/** One entry of the `scope` argument: records of one object, by id. */
export interface SearchKnowledgeScopeEntry {
  object: string;
  ids: string[];
}

/** The arguments `search_knowledge` takes, as its definition's JSON Schema declares them. */
export interface SearchKnowledgeInput {
  query: string;
  sourceIds?: string[];
  topK?: number;
  /** Search only inside these records, or inside the children of these parent records (ADR-0161 K8, item 17). */
  scope?: SearchKnowledgeScopeEntry[];
  /** One hit per passage (`chunk`, the default) or per record (`record`) (ADR-0161 K1). */
  granularity?: SearchKnowledgeGranularity;
  /** One hit per value of this metadata field instead of per record; implies `granularity: 'record'`. */
  groupBy?: string;
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
  /** The headings the passage sits under, outermost first, where its document has headings. */
  headingPath?: string[];
  /**
   * Under `groupBy`: the value of that field the hit's record holds — the
   * group the hit stands for — as the index stores it (a string, a number, a
   * list for a `multiple` lookup). Absent on a hit of a `file` / `http`
   * source, which answers under `groupBy` one hit per document.
   */
  groupValue?: unknown;
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
  /**
   * The hits, most relevant first, at most `topK`: passages, or one per
   * record under `granularity: 'record'`, or one per group under `groupBy`.
   * No count of what the permission re-check or the scope removed, and
   * nothing derived from one (ADR-0161 K9, rule 6).
   */
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
   * (`VALIDATION_ERROR`, 400, naming the argument) and a `sourceIds` entry
   * that names no source this tool may search (`NOT_FOUND`, 404). A caller's
   * string a refusal repeats is quoted and cut to 64 characters.
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
  + 'searched rather than that it holds nothing. '
  + 'To find which records match rather than which passages (which policies, not which clauses), send '
  + '`granularity: "record"`: one hit per record, its best passage, and `topK` counts records. To group by a '
  + 'field the source indexes with its passages instead (one hit per policy for a search over clauses, say), send '
  + '`groupBy` with that field\'s name: one hit per value, which the hit carries as `groupValue` (the value as the '
  + 'index stores it: a string, a number or a list). A source of indexed records that does not index that field '
  + 'answers nothing for that search; a file or web source still answers, one hit per document and with no '
  + '`groupValue`. To look inside records you already know (one '
  + 'policy, say), send `scope`: a list of `{ object, ids }` entries, at most '
  + `${SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES} entries of at most ${SEARCH_KNOWLEDGE_MAX_SCOPE_IDS} ids. An entry naming `
  + 'the object a source indexes searches those records\' passages; an entry naming a parent object searches the '
  + 'passages of records that link to those parents (the clauses of a policy). A hit carries `headingPath`, the '
  + 'headings its passage sits under, where its document has headings.';

/** A caller's id or name, as the definition bounds it. */
const NAME_SCHEMA = Object.freeze({ type: 'string', minLength: 1, maxLength: SEARCH_KNOWLEDGE_MAX_NAME_LENGTH });

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
      description: `At most this many hits (default ${SEARCH_KNOWLEDGE_DEFAULT_TOP_K}): passages, or records or groups under \`granularity: "record"\` or \`groupBy\``,
    },
    scope: {
      type: 'array',
      minItems: 1,
      maxItems: SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES,
      items: {
        type: 'object',
        properties: {
          object: { ...NAME_SCHEMA, description: 'The object the records belong to: the indexed object, or a parent it links to' },
          ids: {
            type: 'array',
            minItems: 1,
            maxItems: SEARCH_KNOWLEDGE_MAX_SCOPE_IDS,
            items: NAME_SCHEMA,
            description: 'The records\' ids',
          },
        },
        required: ['object', 'ids'],
        additionalProperties: false,
      },
      description: 'Only inside these records (any entry); omit to search everything',
    },
    granularity: {
      type: 'string',
      enum: ['chunk', 'record'],
      description: 'One hit per passage (`chunk`, the default) or per record (`record`)',
    },
    groupBy: {
      ...NAME_SCHEMA,
      description: 'One hit per value of this indexed field instead of per record; not with `granularity: "chunk"`',
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

const INPUT_KEYS: ReadonlySet<string> = new Set(['query', 'sourceIds', 'topK', 'scope', 'granularity', 'groupBy']);
const SCOPE_ENTRY_KEYS: ReadonlySet<string> = new Set(['object', 'ids']);

/**
 * A caller's string as a refusal repeats it: JSON-quoted, so a control
 * character reads as its escape and never as a raw byte, and cut to 64
 * characters, so a long argument never comes back whole.
 */
function quoted(value: string): string {
  return JSON.stringify(value.length > 64 ? `${value.slice(0, 64)}…` : value);
}

/** At most five caller strings, quoted, then how many more there were. */
function quotedList(values: readonly string[]): string {
  const shown = values.slice(0, 5).map(quoted).join(', ');
  return values.length > 5 ? `${shown} and ${values.length - 5} more` : shown;
}

/**
 * Whether `value` is an id or name the tool takes: a non-empty string of at
 * most {@link SEARCH_KNOWLEDGE_MAX_NAME_LENGTH} characters with no NUL. A NUL
 * names no record, object or field, and a SQL store refuses the statement
 * that carries one, so it is refused here rather than answered as a failed
 * search of every source the scope reaches.
 */
function isName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= SEARCH_KNOWLEDGE_MAX_NAME_LENGTH
    && !value.includes('\u0000');
}

const NAME_RULE = `a non-empty string of at most ${SEARCH_KNOWLEDGE_MAX_NAME_LENGTH} characters, with no NUL character`;

/** The `scope` argument, or a `VALIDATION_ERROR` naming `scope` and what is wrong in it. */
function parseScope(scope: unknown): SearchKnowledgeScopeEntry[] {
  const refuse = (what: string): Error => refusal('VALIDATION_ERROR', 400, `\`scope\` ${what}`);
  if (!Array.isArray(scope)) throw refuse('is a list of { object, ids } entries.');
  // An empty scope, or an entry with no ids, names no record. Refused rather
  // than answered with no passage, which this tool's description tells the
  // model to report as "nothing matched" (as an empty `sourceIds` is).
  if (scope.length === 0) {
    throw refuse('names no record: omit it to search everything, or name at least one { object, ids } entry.');
  }
  if (scope.length > SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES) {
    throw refuse(`takes at most ${SEARCH_KNOWLEDGE_MAX_SCOPE_ENTRIES} entries, got ${scope.length}.`);
  }
  return scope.map((entry: unknown, i): SearchKnowledgeScopeEntry => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw refuse(`entry ${i} is not an object; each entry is { object, ids }.`);
    }
    const unknownKeys = Object.keys(entry).filter((key) => !SCOPE_ENTRY_KEYS.has(key));
    if (unknownKeys.length > 0) {
      throw refuse(`entry ${i} has ${quotedList(unknownKeys)}; an entry takes only \`object\` and \`ids\`.`);
    }
    const { object, ids } = entry as { object?: unknown; ids?: unknown };
    if (!isName(object)) throw refuse(`entry ${i} needs \`object\`, ${NAME_RULE}, naming an object.`);
    if (!Array.isArray(ids) || ids.length === 0) {
      throw refuse(`entry ${i} needs \`ids\`, a list of at least one record id of ${quoted(object)}.`);
    }
    if (ids.length > SEARCH_KNOWLEDGE_MAX_SCOPE_IDS) {
      throw refuse(`entry ${i} takes at most ${SEARCH_KNOWLEDGE_MAX_SCOPE_IDS} ids, got ${ids.length}.`);
    }
    const bad = ids.findIndex((id) => !isName(id));
    if (bad >= 0) throw refuse(`entry ${i} id ${bad} is not a record id: each id is ${NAME_RULE}.`);
    return { object, ids: [...(ids as string[])] };
  });
}

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
      `${SEARCH_KNOWLEDGE_TOOL_NAME} does not take ${quotedList(unknownKeys)}; it takes `
        + '`query`, `sourceIds`, `topK`, `scope`, `granularity` and `groupBy`.',
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
  if (record.scope !== undefined) parsed.scope = parseScope(record.scope);
  if (record.granularity !== undefined) {
    if (record.granularity !== 'chunk' && record.granularity !== 'record') {
      throw refusal('VALIDATION_ERROR', 400, '`granularity` is "chunk" (one hit per passage) or "record" (one hit per record).');
    }
    parsed.granularity = record.granularity;
  }
  if (record.groupBy !== undefined) {
    if (!isName(record.groupBy)) {
      throw refusal('VALIDATION_ERROR', 400, `\`groupBy\` names a field the source indexes: ${NAME_RULE}.`);
    }
    if (parsed.granularity === 'chunk') {
      throw refusal(
        'VALIDATION_ERROR',
        400,
        `\`groupBy\` ${quoted(record.groupBy)} answers one hit per group, so it does not combine with \`granularity: "chunk"\`: `
          + 'omit `granularity`, or send "record".',
      );
    }
    parsed.groupBy = record.groupBy;
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

/**
 * One hit as the answer carries it: a whitelist, member by member. Nothing
 * else of the service's hit reaches the agent — not its `chunkId`, not the
 * stored `docHash` the record-level freshness check compares, and not its
 * `metadata`, of which only the `groupBy` field's value is answered, and only
 * for an object source that lists that field (source admission holds every
 * listed field queryable by the caller, ADR-0161 K8).
 */
function hitOf(
  hit: KnowledgeHit,
  sources: ReadonlyMap<string, KnowledgeSource>,
  groupBy: string | undefined,
): SearchKnowledgeHit {
  const source = sources.get(hit.sourceId);
  const objSource = source?.source.kind === 'object' ? (source.source as ObjectKnowledgeSource) : undefined;
  const object = objSource?.object;
  const headingPath = Array.isArray(hit.headingPath) && hit.headingPath.every((h) => typeof h === 'string')
    ? [...hit.headingPath]
    : undefined;
  const groupValue = groupBy !== undefined && objSource?.metadataFields?.includes(groupBy)
    ? hit.metadata?.[groupBy]
    : undefined;
  return {
    sourceId: hit.sourceId,
    documentId: hit.documentId,
    ...(hit.title ? { title: hit.title } : {}),
    snippet: hit.snippet,
    score: hit.score,
    ...(object && hit.sourceRecordId ? { record: { object, id: hit.sourceRecordId } } : {}),
    ...(headingPath && headingPath.length > 0 ? { headingPath } : {}),
    ...(groupValue !== undefined && groupValue !== null ? { groupValue } : {}),
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
      const { query, sourceIds, topK, scope, granularity, groupBy } = parseInput(input);
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
            `No knowledge source this tool may search is named ${quotedList(unknown)}. `
              + (summaries.length > 0
                ? `Searchable sources: ${summaries.map((s) => JSON.stringify(s.id)).join(', ')}; omit \`sourceIds\` to search them all.`
                : 'No source is searchable here.'),
          );
        }
      }
      const targets = sourceIds ?? [...byId.keys()];
      if (targets.length === 0) return { hits: [], sources: summaries };
      // [ADR-0090 D10] As the caller: the service re-checks every object-source
      // hit against this context's row-level security.
      // [ADR-0161 K9, rule 3] `targets` are exposed sources only, so a `scope`
      // entry or a `groupBy` field that only a withheld source would answer is
      // answered as one no source answers: no hits, the same answer.
      const searchOpts = {
        sourceIds: targets,
        topK: topK ?? SEARCH_KNOWLEDGE_DEFAULT_TOP_K,
        ...(scope ? { scope } : {}),
        ...(granularity ? { granularity } : {}),
        ...(groupBy !== undefined ? { groupBy } : {}),
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
        hits: report.hits.filter((hit) => byId.has(hit.sourceId)).map((hit) => hitOf(hit, byId, groupBy)),
        sources: summaries,
        ...(refused.length > 0 ? { refused } : {}),
      };
    },
  };
}
