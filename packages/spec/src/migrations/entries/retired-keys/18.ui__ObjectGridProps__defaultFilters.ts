// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11509 (v18, ruling A-narrow, sub-question 1) — `defaultFilters` on
// `object-grid` was the legacy second spelling of `filter`, read only when
// `filter` lowered to nothing; #19514 narrowed it to the rule array and left
// the removal to its own ruling, which this is. Retired in the shape
// `defaultSort`'s took (`ui/ObjectGridProps:defaultSort`, beside this entry):
// the D2 conversion `object-grid-default-filters-removed` moves the rules onto
// an empty `filter` and deletes the key beside a `filter` that has content.
export const entry = 'ui/ObjectGridProps:defaultFilters';
