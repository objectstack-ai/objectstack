// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `@objectstack/metadata/stored-item-package` — how the package-slotted store
 * reads a stored or registered item: the package it carries
 * ({@link storedItemPackageId}: the stored envelope's `packageId`, flat or
 * under the publish envelope, else the body's `_packageId` stamp) and the
 * object an action binds ({@link boundObjectOf}). [#32365] The protocol's
 * bare action read judges the metadata service's answer by the same reading,
 * never a re-derived one. Its own entry for the reason `errors` has one: a
 * consumer that needs the two readers does not load the manager, the loaders
 * or their deps.
 */
export { storedItemPackageId, boundObjectOf } from './package-slotted-store.js';
