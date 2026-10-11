// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11509 (v18, ruling A-narrow) — `filter` on `element:number` was a flat second
// spelling of the node-level `dataSource.filter` binding (the element resolved `object` binding-first and AND-combined the two filters).
// In v18 an element binds data through `dataSource` only: one node, one
// door, one precedence. Sources are rewritten by the D2 conversion
// `element-flat-data-binding-to-data-source`; the judgment an upgrader
// still owes is the D3 entry `element-flat-data-binding-retired`.
export const entry = 'ui/ElementNumberProps:filter';
