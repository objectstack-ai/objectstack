// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * Full-text search protocol
 * Supports Elasticsearch, Algolia, Meilisearch, Typesense
 */
import { lazySchema } from '../shared/lazy-schema';
export const SearchProviderSchema = lazySchema(() => z.enum([
  'elasticsearch',
  'algolia',
  'meilisearch',
  'typesense',
  'opensearch',
]).describe('Supported full-text search engine provider'));

export type SearchProvider = z.input<typeof SearchProviderSchema>;

export const AnalyzerConfigSchema = lazySchema(() => z.object({
  type: z.enum(['standard', 'simple', 'whitespace', 'keyword', 'pattern', 'language']).describe('Text analyzer type'),
  language: z.string().optional().describe('Language for language-specific analysis'),
  stopwords: z.array(z.string()).optional().describe('Custom stopwords to filter during analysis'),
  customFilters: z.array(z.string()).optional().describe('Additional token filter names to apply'),
}).describe('Text analyzer configuration for index tokenization and normalization'));

export type AnalyzerConfig = z.input<typeof AnalyzerConfigSchema>;

export const SearchIndexConfigSchema = lazySchema(() => z.object({
  indexName: z.string().describe('Name of the search index'),
  objectName: z.string().describe('Source ObjectQL object'),
  fields: z.array(z.object({
    name: z.string().describe('Field name to index'),
    type: z.enum(['text', 'keyword', 'number', 'date', 'boolean', 'geo']).describe('Index field data type'),
    analyzer: z.string().optional().describe('Named analyzer to use for this field'),
    searchable: z.boolean().default(true).describe('Include field in full-text search'),
    filterable: z.boolean().default(false).describe('Allow filtering on this field'),
    sortable: z.boolean().default(false).describe('Allow sorting by this field'),
    boost: z.number().default(1).describe('Relevance boost factor for this field'),
  })).describe('Fields to include in the search index'),
  replicas: z.number().default(1).describe('Number of index replicas for availability'),
  shards: z.number().default(1).describe('Number of index shards for distribution'),
}).describe('Search index definition mapping an ObjectQL object to a search engine index'));

export type SearchIndexConfig = z.input<typeof SearchIndexConfigSchema>;
/** Post-parse shape of {@link SearchIndexConfig} — defaults applied, transforms run (ADR-0122). */
export type SearchIndexConfigParsed = z.infer<typeof SearchIndexConfigSchema>;

export const FacetConfigSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name to generate facets from'),
  maxValues: z.number().default(10).describe('Maximum number of facet values to return'),
  sort: z.enum(['count', 'alpha']).default('count').describe('Facet value sort order'),
}).describe('Faceted search configuration for a single field'));

export type FacetConfig = z.input<typeof FacetConfigSchema>;
/** Post-parse shape of {@link FacetConfig} — defaults applied, transforms run (ADR-0122). */
export type FacetConfigParsed = z.infer<typeof FacetConfigSchema>;

export const SearchConfigSchema = lazySchema(() => z.object({
  provider: SearchProviderSchema.describe('Search engine backend provider'),
  indexes: z.array(SearchIndexConfigSchema).describe('Search index definitions'),
  analyzers: z.record(z.string(), AnalyzerConfigSchema).optional().describe('Named text analyzer configurations'),
  facets: z.array(FacetConfigSchema).optional().describe('Faceted search configurations'),
  typoTolerance: z.boolean().default(true).describe('Enable typo-tolerant search'),
  synonyms: z.record(z.string(), z.array(z.string())).optional().describe('Synonym mappings for search expansion'),
  ranking: z.array(z.enum(['typo', 'geo', 'words', 'filters', 'proximity', 'attribute', 'exact', 'custom'])).optional().describe('Custom ranking rule order'),
}).describe('Top-level full-text search engine configuration'));

export type SearchConfig = z.input<typeof SearchConfigSchema>;
/** Post-parse shape of {@link SearchConfig} — defaults applied, transforms run (ADR-0122). */
export type SearchConfigParsed = z.infer<typeof SearchConfigSchema>;
