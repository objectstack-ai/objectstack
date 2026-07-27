// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// MOVED: SeedLoaderService now lives in @objectstack/objectql so the protocol's
// `publishMetaItem` can materialize published `seed` metadata into rows on EVERY
// publish path (per-ref REST publish, package publish-drafts, dispatcher) —
// packages/rest cannot depend on runtime (runtime → rest), and objectql is the
// layer that owns both the engine and the publish primitive. This shim keeps
// the historical runtime import path working.
export { SeedLoaderService } from '@objectstack/metadata-protocol';
