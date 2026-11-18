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
 * consumers now trust it. A new name also needs its `chatbot.tool.<name>`
 * label in every pack under `ui/packages/i18n/src/locales/` — the ui
 * plugin-chatbot label-parity tests read this registry.
 *
 * Tools the MCP door in THIS repository registers (`@objectstack/mcp`) are not
 * cloud registrations, so they never join {@link PLATFORM_TOOLS_BY_PACKAGE}:
 * a group there is the exact set one cloud package registers, and the MCP
 * bridge reads {@link PLATFORM_PROVIDED_TOOL_NAMES} to annotate the tools it
 * bridges from the cloud runtime. The door's file pair has its own constant,
 * {@link MCP_FILE_TOOL_NAMES}, which the `skill.tools[]` lint rule resolves
 * against beside this registry for a skill offered over MCP.
 */

/**
 * Statically-named tools registered by the cloud AI runtime, grouped by
 * owning package. Each group is the exact set that package registers.
 */
export const PLATFORM_TOOLS_BY_PACKAGE: Readonly<Record<string, readonly string[]>> = {
  /**
   * `@objectstack/service-ai` (cloud) — the `ask` data product's shared
   * data/knowledge/visualization tools, the package-doc pair that reads the
   * installed packages' `doc` items behind the `/meta/doc` audience gate
   * (cloud#3335), and the dataset pair (cloud#4551): `list_datasets` reads
   * the installed datasets and the metrics each defines, and `query_dataset`
   * answers a question through one governed metric instead of an ad-hoc
   * aggregate. Their names and shapes are declared once in
   * `../../ai/dataset-tools.zod` (ADR-0149 D2), which MCP registers too.
   */
  'service-ai': [
    'aggregate_data',
    'get_record',
    'list_datasets',
    'query_data',
    'query_dataset',
    'query_records',
    'read_package_doc',
    'search_knowledge',
    'search_package_docs',
    'visualize_data',
  ],
  /**
   * `@objectstack/service-ai-studio` (cloud) — the shared schema-reader pair
   * (`describe_object`/`list_objects`), the `build` authoring product's
   * metadata/blueprint/package/verify tools, the chat agents' hand-off
   * signals (`suggest_builder`, `open_record`), which write nothing, and the
   * two record-write proposals (`create_record`, `update_record`) and the
   * sample-data cleanup (`remove_sample_data`), which write ONE record or the
   * seeded rows only after the user confirms a card and as that user
   * (cloud#3565; they replaced `draft_record`), and the package removal
   * (`delete_package`), which only stages the removal of a package built in
   * the environment — a person confirms before anything is deleted
   * (cloud#3656), and the `ask` agent's read-only `get_record_history`, which
   * reads one record's change history the user may see so a chat can undo the
   * last edit — the restore itself still goes through a confirm card
   * (cloud#4347).
   */
  'service-ai-studio': [
    'add_field',
    'apply_blueprint',
    'apply_edit',
    'create_metadata',
    'create_object',
    'create_package',
    'create_record',
    'create_seed',
    'delete_field',
    'delete_package',
    'describe_metadata',
    'describe_object',
    'get_active_package',
    'get_authoring_rules',
    'get_metadata_schema',
    'get_package',
    'get_record_history',
    'list_metadata',
    'list_objects',
    'list_packages',
    'load_tools',
    'modify_field',
    'open_record',
    'propose_blueprint',
    'remove_sample_data',
    'set_active_package',
    'suggest_builder',
    'test_flow',
    'todo_write',
    'toggle_flow',
    'update_metadata',
    'update_record',
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
 * The file tools the MCP door registers (`registerFileTools` in
 * `@objectstack/mcp`): `read_file` reads a file a record carries, and
 * `create_upload_link` mints a single-use link to upload a file onto a record.
 * No cloud AI package registers either, so neither is in
 * {@link PLATFORM_PROVIDED_TOOL_NAMES}; a skill bound to them is served over
 * MCP, and the `skill.tools[]` lint rule resolves both names from this list
 * for a skill offered there. An in-product turn runs without them, so a skill
 * kept out of MCP (`mcpPrompt: false`) naming either is still reported.
 *
 * Maintenance contract: this is the exact set `registerFileTools` registers on
 * a bridge carrying every file member. `@objectstack/mcp` carries the
 * conformance test that holds the two equal, so a file tool added to or
 * renamed at the door fails there until this list follows it.
 */
export const MCP_FILE_TOOL_NAMES: readonly string[] = ['create_upload_link', 'read_file'];

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
