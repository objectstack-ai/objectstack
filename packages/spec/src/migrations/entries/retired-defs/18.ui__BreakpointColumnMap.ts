// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11027 — `ui/BreakpointColumnMap` (breakpoint → grid column count, 1-12)
// left with `ui/ResponsiveConfig`: its ONLY consumer was the retired
// `ResponsiveConfigSchema.columns` (the #3950 rule — an exported value schema
// with no consumer reads as a capability). See `18.ui__ResponsiveConfig.ts`
// for the retirement record and the measurement.
export const entry = 'ui/BreakpointColumnMap';
