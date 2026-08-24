// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11027 — `ui/ResponsiveConfig` (the per-breakpoint LAYOUT block: grid
// columns / visibility / display order on the Tailwind `xs…2xl` axis). Its
// last authorable carrier, `page.components[].responsive`, is tombstoned in
// this same major (ADR-0049 D2; the widget embed went in #4876, the view
// embed in #3896), and an exported value schema with no consumer reads as a
// capability (#3950 rule — the `PerformanceConfigSchema` precedent from the
// very same file). Measured before removal: zero callers of either objectui
// consumer implementation, zero authored instances in either repo. The live
// per-breakpoint channel is `responsiveStyles` (ADR-0065, `ResponsiveStyles`),
// which stays. The Tailwind-style layout vocabulary returns if and when a
// renderer implements it — in one change, with the engine (the #4834 rule).
export const entry = 'ui/ResponsiveConfig';
