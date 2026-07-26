// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * platform-objects/integration — External Integration Platform Objects
 *
 * **Empty since ADR-0029 (K2.a).** `sys_webhook` moved to its owner,
 * `@objectstack/plugin-webhooks`, so the plugin ships its data model and
 * behavior as one unit. Import the schema from
 * `@objectstack/plugin-webhooks/schema` instead.
 *
 * The subpath (`@objectstack/plugin-webhooks/integration`) is retained as an
 * empty barrel to avoid churning the package `exports` map / tsup entries
 * during the incremental decomposition; it can be removed once the
 * decomposition completes (ADR-0029 K4).
 */

export {};
