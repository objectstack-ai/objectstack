// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Strategy pattern types — re-exported from @objectstack/spec/contracts
 * for convenience. The canonical definitions live in the spec package.
 *
 * [#4538] `DriverCapabilities` → `AnalyticsDriverCapabilities`: the old name
 * belonged to the data domain's driver feature-flag record
 * (`DriverCapabilitiesSchema` — every `IDataDriver.supports`); the analytics
 * execution-path trio was renamed with its spec declaration.
 */
export type {
  AnalyticsStrategy,
  StrategyContext,
  AnalyticsDriverCapabilities,
} from '@objectstack/spec/contracts';
