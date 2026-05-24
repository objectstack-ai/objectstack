// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { IMetadataService } from '@objectstack/spec/contracts';

/**
 * SchemaRetriever — Keyword-based metadata retrieval for AI prompts.
 *
 * Given a free-text query (typically the user's last message), surfaces the
 * most relevant `object` definitions and renders a compact schema snippet
 * suitable for injection into the system prompt.
 *
 * v1 strategy is intentionally simple:
 * - Tokenise the query into lower-case alphanumeric terms
 * - Score each registered object by counting term hits against its name,
 *   label, field names, and field labels
 * - Return the top `limit` matches above the score threshold
 *
 * This does *not* use embeddings — for v1 the user-defined object catalogue
 * is small enough (< 1000 objects in practice) that a single linear scan
 * over already-cached metadata is faster than a vector round-trip and
 * eliminates the need for a vector store.
 *
 * Future versions can swap in {@link IAIService.embed} backed retrieval
 * behind the same `retrieve()` shape.
 *
 * @example
 * ```ts
 * const retriever = new SchemaRetriever(metadataService);
 * const hits = await retriever.retrieve('how many open tasks are due this week?');
 * const snippet = SchemaRetriever.renderSnippet(hits);
 * // snippet:
 * //   ## Schema context (auto-injected)
 * //   ### task — Project Task
 * //     - id: text
 * //     - title: text
 * //     - status: select(open|in_progress|done)
 * //     - due_date: date
 * ```
 */
export class SchemaRetriever {
  private readonly metadata: IMetadataService;
  private readonly options: Required<SchemaRetrieverOptions>;

  constructor(metadata: IMetadataService, options: SchemaRetrieverOptions = {}) {
    this.metadata = metadata;
    this.options = {
      limit: options.limit ?? 3,
      minScore: options.minScore ?? 1,
      maxFieldsPerObject: options.maxFieldsPerObject ?? 12,
    };
  }

  /**
   * Find object definitions whose name/label/fields match terms in the query.
   *
   * Returns matches sorted by score (descending) capped at `limit`. When
   * the query yields no matches, returns an empty array — callers may
   * fall back to a generic "describe what data exists" tool call.
   */
  async retrieve(query: string): Promise<SchemaHit[]> {
    const terms = tokenise(query);
    if (terms.length === 0) return [];

    const objects = await this.metadata.listObjects();
    const hits: SchemaHit[] = [];

    for (const raw of objects) {
      const obj = raw as ObjectShape;
      if (!obj?.name) continue;
      const score = scoreObject(obj, terms);
      if (score >= this.options.minScore) {
        hits.push({ object: obj, score });
      }
    }

    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, this.options.limit);
  }

  /**
   * Render hits as a compact Markdown schema snippet.
   *
   * Designed to be appended to the system message — every line carries
   * exactly the information a model needs to choose object/field names
   * for query construction.
   */
  static renderSnippet(hits: SchemaHit[], maxFieldsPerObject = 12): string {
    if (hits.length === 0) return '';
    const lines: string[] = ['## Schema context (auto-injected)'];
    for (const hit of hits) {
      const obj = hit.object;
      const label = obj.label ? ` — ${obj.label}` : '';
      lines.push(`### ${obj.name}${label}`);
      const fields = Object.entries(obj.fields ?? {}).slice(0, maxFieldsPerObject);
      for (const [name, field] of fields) {
        lines.push(`  - ${name}: ${describeField(field)}`);
      }
      const total = Object.keys(obj.fields ?? {}).length;
      if (total > fields.length) {
        lines.push(`  - …${total - fields.length} more field(s)`);
      }
    }
    return lines.join('\n');
  }
}

/** A scored retrieval result. */
export interface SchemaHit {
  object: ObjectShape;
  score: number;
}

/** Options for {@link SchemaRetriever}. */
export interface SchemaRetrieverOptions {
  /** Maximum number of objects to return (default: 3). */
  limit?: number;
  /** Minimum score required to include an object (default: 1). */
  minScore?: number;
  /** Maximum fields rendered per object in the snippet (default: 12). */
  maxFieldsPerObject?: number;
}

/** Minimal shape of an object definition we care about. */
export interface ObjectShape {
  name: string;
  label?: string;
  pluralLabel?: string;
  description?: string;
  fields?: Record<string, FieldShape>;
}

/** Minimal shape of a field definition. */
export interface FieldShape {
  type?: string;
  label?: string;
  options?: unknown;
  reference?: string;
}

// ── internal helpers ──────────────────────────────────────────────

/** Lower-case alphanumeric tokens of length ≥ 2 (English stop-words excluded). */
function tokenise(query: string): string[] {
  // Split on any non-alphanumeric (including underscores) so `todo_task`
  // tokenises to ['todo', 'task'] and matches snake_case object names.
  const raw = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return raw.filter(t => t.length >= 2 && !STOPWORDS.has(t));
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'are', 'has', 'have', 'had', 'was', 'were',
  'this', 'that', 'these', 'those', 'all', 'any', 'how', 'what', 'when', 'where',
  'who', 'why', 'which', 'show', 'list', 'find', 'get', 'count', 'of', 'in', 'on',
  'at', 'to', 'as', 'by', 'is', 'it', 'an', 'or', 'be', 'me',
]);

/**
 * Score an object by term hits.
 *
 * Weights: name match = 3, label match = 2, description match = 1,
 * field name match = 2, field label match = 1. A term may contribute at
 * most once per field source.
 */
function scoreObject(obj: ObjectShape, terms: string[]): number {
  let score = 0;
  const nameTokens = splitSnake(obj.name);
  const labelTokens = obj.label ? tokenise(obj.label) : [];
  const pluralTokens = obj.pluralLabel ? tokenise(obj.pluralLabel) : [];
  const descTokens = obj.description ? tokenise(obj.description) : [];

  for (const term of terms) {
    if (nameTokens.includes(term)) score += 3;
    else if (labelTokens.includes(term) || pluralTokens.includes(term)) score += 2;
    else if (descTokens.includes(term)) score += 1;
  }

  for (const [fieldName, field] of Object.entries(obj.fields ?? {})) {
    const fnTokens = splitSnake(fieldName);
    const flTokens = field.label ? tokenise(field.label) : [];
    for (const term of terms) {
      if (fnTokens.includes(term)) score += 2;
      else if (flTokens.includes(term)) score += 1;
    }
  }

  return score;
}

/** Split snake_case identifier into lower-case word tokens. */
function splitSnake(name: string): string[] {
  return name.toLowerCase().split('_').filter(Boolean);
}

/** Compact human-readable description of a field's type. */
function describeField(field: FieldShape): string {
  const t = field.type ?? 'unknown';
  if (t === 'lookup' && field.reference) return `lookup → ${field.reference}`;
  if (t === 'select' && Array.isArray(field.options)) {
    const values = field.options
      .map((o: unknown) =>
        typeof o === 'string' ? o : (o as { value?: string }).value,
      )
      .filter(Boolean)
      .slice(0, 6);
    return `select(${values.join('|')})`;
  }
  return t;
}
