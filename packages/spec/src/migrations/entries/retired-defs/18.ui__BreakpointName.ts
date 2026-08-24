// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11027 — `ui/BreakpointName` (the Tailwind-style `xs…2xl` breakpoint-name
// enum) left with `ui/ResponsiveConfig`: its only consumers were the retired
// `ResponsiveConfigSchema` (`breakpoint`, `hiddenOn`) and the two retired
// breakpoint maps' key sets (the #3950 rule — an exported value schema with
// no consumer reads as a capability). The surviving `ResponsiveStyles`
// vocabulary is the ADR-0065 max-width buckets (`large`/`medium`/`small`/
// `xsmall`), a different axis by design. See `18.ui__ResponsiveConfig.ts` for
// the retirement record and the measurement.
export const entry = 'ui/BreakpointName';
