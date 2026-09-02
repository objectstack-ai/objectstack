// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { composeStacks } from '@objectstack/spec';

import coreStack from './src/packages/core/index.js';
import ordersStack from './src/packages/orders/index.js';

/**
 * A PROJECT of N packages, compiled into ONE release artifact (ADR-0130 D4).
 *
 * ## The authoring shape — there is only one, deliberately
 *
 * N ordinary `defineStack` packages, each legal on its own (each still under
 * ADR-0019's single-app rule), plus this project-level config composing them
 * with `manifest: 'preserve'`. ⛔ No second spelling exists and none should be
 * invented: `preserve` is the only thing that separates "one artifact carrying
 * N packages" from the pick-one composition every other `manifest` strategy
 * performs, which flattens N package identities down to one and is exactly the
 * loss ADR-0130 was written about.
 *
 * ## What `preserve` produces
 *
 * The composed stack the platform has always produced — every collection
 * flattened to the top level — PLUS `packages[]`, one entry per input stack,
 * each carrying that package ASSEMBLED (its manifest fields with the
 * collections it owns written over them). The flattened top level is what the
 * metadata service reads; `packages[]` is what `ObjectQL.registerApp`
 * registers, package by package, in dependency-topological order — which is
 * where per-package ownership comes from. Without the list, a two-package
 * artifact would install two package records owning nothing at all.
 *
 * ## Why the module is listed FIRST
 *
 * Deliberately backwards, and it is a property this fixture holds rather than
 * an accident: `orders` declares `dependencies: { 'com.example.multi.core' }`,
 * and the load path sorts `packages[]` through `resolvePluginOrder` — the
 * platform's ONE topological sorter (ADR-0130 D5, ADR-0116) — so `core`
 * registers first whatever slot it occupies here. An artifact that only worked
 * because someone put the packages in the right order would be the failure
 * ADR-0116 exists about, and it fails SILENTLY: nothing throws, the extension
 * simply does not take effect.
 *
 * The order also settles the ARTIFACT's own identity: `preserve` is additive,
 * so the singular `manifest` is still picked by the default `'last'` rule and
 * the artifact identifies as its consumer-facing App (ADR-0019 D1), not as one
 * of its modules.
 *
 * `os build` compiles this file into one `dist/objectstack.json`; `os dev`
 * boots the same shape straight from source.
 */
export default composeStacks([ordersStack, coreStack], { manifest: 'preserve' });
