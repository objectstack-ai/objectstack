// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { AnalyticsQuery, AnalyticsResult, AnalyticsStrategy, StrategyContext } from '@objectstack/spec/contracts';

/**
 * InMemoryStrategy — Priority 3
 *
 * Delegates to an existing `IAnalyticsService` instance that was registered
 * as a fallback (typically `MemoryAnalyticsService` from this package).
 *
 * This is the lowest-priority strategy, used in:
 * - `dev` / `test` environments
 * - Any runtime where the backing driver is in-memory
 */
export class InMemoryStrategy implements AnalyticsStrategy {
  readonly name = 'InMemoryStrategy';
  readonly priority = 30;

  canHandle(query: AnalyticsQuery, ctx: StrategyContext): boolean {
    if (!query.cube) return false;
    // Can handle when a fallback service exists
    if (ctx.fallbackService) return true;
    // Or when the driver is flagged as in-memory
    const caps = ctx.queryCapabilities(query.cube);
    return caps.inMemory;
  }

  async execute(query: AnalyticsQuery, ctx: StrategyContext): Promise<AnalyticsResult> {
    if (!ctx.fallbackService) {
      throw new Error(
        `[InMemoryStrategy] No fallback analytics service available for cube "${query.cube}". ` +
        'Register a MemoryAnalyticsService or configure a driver with analytics support.'
      );
    }
    return ctx.fallbackService.query(query);
  }

  async generateSql(query: AnalyticsQuery, ctx: StrategyContext): Promise<{ sql: string; params: unknown[] }> {
    if (ctx.fallbackService?.generateSql) {
      return ctx.fallbackService.generateSql(query);
    }
    return {
      sql: `-- InMemoryStrategy: SQL generation not supported for cube "${query.cube}"`,
      params: [],
    };
  }
}
