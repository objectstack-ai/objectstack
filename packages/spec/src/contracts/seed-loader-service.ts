// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  SeedLoaderRequestParsed,
  SeedLoaderResultParsed,
  SeedLoaderConfig,
  ObjectDependencyGraphParsed,
} from '../data/seed-loader.zod.js';

import type { Seed } from '../data/seed.zod.js';

/**
 * ISeedLoaderService — Metadata-driven Seed Data Loader Contract
 *
 * Responsible for loading seed/demo/config data with:
 * - Automatic lookup/master_detail reference resolution via externalId
 * - Topological dependency ordering (parents before children)
 * - Multi-pass loading for circular references
 * - Dry-run validation mode
 * - Actionable error reporting
 *
 * ## Architecture Alignment
 * - **Salesforce Data Loader**: External ID-based upsert with relationship resolution
 * - **ServiceNow**: Sys ID and display value mapping during import
 * - **Airtable**: Linked record resolution via display names
 *
 * Not a `CoreServiceName` member and not a registered runtime service slot
 * (no `SeedLoaderProtocol` export exists in data/seed-loader.zod.ts either —
 * the request/result shapes there are `SeedLoaderRequestSchema` /
 * `SeedLoaderResultSchema`). `metadata-protocol`'s `SeedLoaderService`
 * implements this contract directly, constructed rather than registered
 * via `ctx.registerService`.
 */
export interface ISeedLoaderService {
  /**
   * Load one or more datasets with full reference resolution and dependency ordering.
   *
   * The loader automatically:
   * 1. Filters datasets by environment if `config.env` is set
   * 2. Builds a dependency graph from object metadata (lookup/master_detail fields)
   * 3. Topologically sorts datasets so parent objects are inserted before children
   * 4. Resolves references via externalId, with multi-pass for circular dependencies
   *
   * @param request - Parsed SeedLoaderRequest (datasets + config)
   * @returns Structured result with per-object stats, errors, and summary
   */
  load(request: SeedLoaderRequestParsed): Promise<SeedLoaderResultParsed>;

  /**
   * Build the object dependency graph from metadata for the given object names.
   * Inspects lookup/master_detail fields to determine dependencies.
   *
   * @param objectNames - Object names to include in the graph
   * @returns Dependency graph with topological insert order and circular dependency detection
   */
  buildDependencyGraph(objectNames: string[]): Promise<ObjectDependencyGraphParsed>;

  /**
   * Validate datasets without writing any data (equivalent to config.dryRun = true).
   * Checks reference integrity and reports all broken references.
   *
   * @param datasets - Seeds to validate
   * @param config - Optional loader config overrides
   * @returns Structured result with validation errors (no data written)
   */
  validate(datasets: Seed[], config?: SeedLoaderConfig): Promise<SeedLoaderResultParsed>;
}
