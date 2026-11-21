// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import type { ISeedLoaderService } from './seed-loader-service';
import type {
  SeedLoaderRequestParsed,
  SeedLoaderResultParsed,
  ObjectDependencyGraphParsed,
} from '../data/seed-loader.zod';
import type { Seed } from '../data/seed.zod';

describe('Seed Loader Service Contract', () => {
  it('should allow a minimal implementation with required methods', () => {
    const service: ISeedLoaderService = {
      load: async (_request: SeedLoaderRequestParsed): Promise<SeedLoaderResultParsed> => {
        return {
          success: true,
          dryRun: false,
          dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
          results: [],
          errors: [],
          summary: {
            objectsProcessed: 0,
            totalRecords: 0,
            totalInserted: 0,
            totalUpdated: 0,
            totalSkipped: 0,
            totalErrored: 0,
            totalReferencesResolved: 0,
            totalReferencesDeferred: 0,
            totalReferencesDropped: 0,
            totalSummariesStale: 0,
            circularDependencyCount: 0,
            durationMs: 0,
          },
        };
      },
      buildDependencyGraph: async (_objectNames: string[]): Promise<ObjectDependencyGraphParsed> => {
        return { nodes: [], insertOrder: [], circularDependencies: [] };
      },
      validate: async (_datasets: Seed[]): Promise<SeedLoaderResultParsed> => {
        return {
          success: true,
          dryRun: true,
          dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
          results: [],
          errors: [],
          summary: {
            objectsProcessed: 0,
            totalRecords: 0,
            totalInserted: 0,
            totalUpdated: 0,
            totalSkipped: 0,
            totalErrored: 0,
            totalReferencesResolved: 0,
            totalReferencesDeferred: 0,
            totalReferencesDropped: 0,
            totalSummariesStale: 0,
            circularDependencyCount: 0,
            durationMs: 0,
          },
        };
      },
    };

    expect(typeof service.load).toBe('function');
    expect(typeof service.buildDependencyGraph).toBe('function');
    expect(typeof service.validate).toBe('function');
  });

  it('should return a valid result from load()', async () => {
    const service: ISeedLoaderService = {
      load: async (request) => ({
        success: true,
        dryRun: request.config.dryRun,
        dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
        results: [],
        errors: [],
        summary: {
          objectsProcessed: request.seeds.length,
          totalRecords: request.seeds.reduce((sum, d) => sum + d.records.length, 0),
          totalInserted: 0,
          totalUpdated: 0,
          totalSkipped: 0,
          totalErrored: 0,
          totalReferencesResolved: 0,
          totalReferencesDeferred: 0,
          totalReferencesDropped: 0,
          totalSummariesStale: 0,
          circularDependencyCount: 0,
          durationMs: 42,
        },
      }),
      buildDependencyGraph: async () => ({ nodes: [], insertOrder: [], circularDependencies: [] }),
      validate: async () => ({
        success: true,
        dryRun: true,
        dependencyGraph: { nodes: [], insertOrder: [], circularDependencies: [] },
        results: [],
        errors: [],
        summary: {
          objectsProcessed: 0, totalRecords: 0, totalInserted: 0, totalUpdated: 0,
          totalSkipped: 0, totalErrored: 0, totalReferencesResolved: 0,
          totalReferencesDeferred: 0, totalReferencesDropped: 0, totalSummariesStale: 0,
          circularDependencyCount: 0, durationMs: 0,
        },
      }),
    };

    const result = await service.load({
      seeds: [
        { object: 'account', externalId: 'name', mode: 'upsert', env: ['prod', 'dev', 'test'], records: [{ name: 'Acme' }] },
      ],
      config: {
        dryRun: false, haltOnError: false, multiPass: true,
        defaultMode: 'upsert', batchSize: 1000, transaction: false,
      },
    });

    expect(result.success).toBe(true);
    expect(result.dryRun).toBe(false);
    expect(result.summary.objectsProcessed).toBe(1);
    expect(result.summary.totalRecords).toBe(1);
  });

  it('should return a dependency graph from buildDependencyGraph()', async () => {
    const service: ISeedLoaderService = {
      load: async () => ({} as any),
      buildDependencyGraph: async (objectNames) => ({
        nodes: objectNames.map(name => ({
          object: name,
          dependsOn: [],
          references: [],
        })),
        insertOrder: objectNames,
        circularDependencies: [],
      }),
      validate: async () => ({} as any),
    };

    const graph = await service.buildDependencyGraph(['account', 'contact']);

    expect(graph.nodes).toHaveLength(2);
    expect(graph.insertOrder).toEqual(['account', 'contact']);
    expect(graph.circularDependencies).toEqual([]);
  });
});
