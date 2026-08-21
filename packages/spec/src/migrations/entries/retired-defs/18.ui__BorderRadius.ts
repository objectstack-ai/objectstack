// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10485 — `ui/BorderRadius` (the border-radius scale sub-block) left with `ui/Theme`:
// its ONLY consumer was the retired `ThemeSchema` (the #3950 rule — an
// exported value schema with no consumer reads as a capability). See
// `18.ui__Theme.ts` for the retirement record and the ruling.
export const entry = 'ui/BorderRadius';
