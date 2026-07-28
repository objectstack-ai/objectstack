// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Canonical registry of PLATFORM-PROVIDED AI tool names (issue #3820, ADR-0109).
 *
 * A skill legitimately references tools its stack does not declare: the
 * executable tool set is RUNTIME-REGISTERED by the cloud AI runtime
 * (`../cloud/service-ai` for the `ask` data product, `service-ai-studio` for
 * the `build` authoring product), not read from `stack.tools`. Until this
 * module existed, no static check could tell `describe_object` (real,
 * registered at boot) from `forecast_revenue` (fictional — the HotCRM audit's
 * "11 tools with no definitions", shipping through `validate`/`lint` clean).
 *
 * Structure mirrors {@link PLATFORM_PROVIDED_OBJECT_NAMES} exactly: the
 * contract package owns the curated list; the OWNING packages carry
 * conformance tests asserting the list matches what they actually register.
 * The tools live in the separate `cloud` repository, so — like
 * `CLOUD_PROVIDED_OBJECT_NAMES` — the conformance half of the contract lives
 * there (`service-ai` / `service-ai-studio` test suites), not here.
 *
 * ADR-0109's authoring model makes this list the load-bearing half of
 * reference integrity for `skill.tools[]`: the DEFAULT third-party path
 * declares no tool records at all — a skill names either a platform tool
 * (this registry) or an auto-materialised action tool (the
 * {@link PLATFORM_TOOL_FAMILY_PREFIXES} families, e.g. `action_<name>` from
 * the stack's own declarative actions).
 *
 * Maintenance contract: registering a new tool in a cloud AI package means
 * adding its name here. The owning package's conformance test fails
 * otherwise — an out-of-date registry is worse than no registry, because
 * consumers now trust it.
 */

/**
 * Statically-named tools registered by the cloud AI runtime, grouped by
 * owning package. Each group is the exact set that package registers.
 */
export const PLATFORM_TOOLS_BY_PACKAGE: Readonly<Record<string, readonly string[]>> = {
  /**
   * `@objectstack/service-ai` (cloud) — the `ask` data product's shared
   * data/knowledge/visualization tools.
   */
  'service-ai': [
    'aggregate_data',
    'get_record',
    'query_data',
    'query_records',
    'search_knowledge',
    'visualize_data',
  ],
  /**
   * `@objectstack/service-ai-studio` (cloud) — the shared schema-reader pair
   * (`describe_object`/`list_objects`) plus the `build` authoring product's
   * metadata/blueprint/package/verify tools.
   */
  'service-ai-studio': [
    'add_field',
    'apply_blueprint',
    'apply_edit',
    'create_metadata',
    'create_object',
    'create_package',
    'create_seed',
    'delete_field',
    'describe_metadata',
    'describe_object',
    'get_active_package',
    'get_metadata_schema',
    'get_package',
    'list_metadata',
    'list_objects',
    'list_packages',
    'modify_field',
    'propose_blueprint',
    'set_active_package',
    'suggest_builder',
    'todo_write',
    'update_metadata',
    'validate_expression',
    'verify_build',
  ],
} as const;

/**
 * Every statically-named platform tool, for fast membership checks in lint
 * rules and cross-reference validation.
 */
export const PLATFORM_PROVIDED_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.values(PLATFORM_TOOLS_BY_PACKAGE).flat(),
);

/**
 * Name prefixes of tool FAMILIES the runtime materialises dynamically — names
 * that are real without being statically enumerable. Today that is exactly
 * one family: `action_<name>`, one tool per declarative Action
 * (`service-ai`'s action-tools generator; the built-in `actions_executor`
 * skill subscribes via the `action_*` wildcard).
 *
 * A `skill.tools[]` entry under one of these prefixes resolves against the
 * stack's own actions (`action_` + the action's name), not this registry.
 */
export const PLATFORM_TOOL_FAMILY_PREFIXES: readonly string[] = ['action_'];

/**
 * Is `name` a KNOWN platform-provided tool (statically registered by a cloud
 * AI package)?
 *
 * `false` does NOT mean fictional on its own: the name may be a materialised
 * family member (check {@link PLATFORM_TOOL_FAMILY_PREFIXES} against the
 * stack's actions) or contributed by a third-party runtime plugin the
 * registry cannot know about — the reason the R7 lint rule reports misses at
 * ADVISORY severity (ADR-0078 ratchet).
 */
export function isPlatformProvidedToolName(name: string): boolean {
  return PLATFORM_PROVIDED_TOOL_NAMES.has(name);
}
