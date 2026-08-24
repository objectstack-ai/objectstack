// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11027 — `ui/BreakpointOrderMap` (breakpoint → display order) left with
// `ui/ResponsiveConfig`: its ONLY consumer was the retired
// `ResponsiveConfigSchema.order` (the #3950 rule — an exported value schema
// with no consumer reads as a capability). See `18.ui__ResponsiveConfig.ts`
// for the retirement record and the measurement.
export const entry = 'ui/BreakpointOrderMap';
