// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Whether `os serve` auto-injects the AI service plugin for a config: the ONE
 * reading of that rule. `serve` calls it to decide what it loads; `os migrate
 * plan` / `apply` and the organization-ownership ceremony
 * (`composeServedPlatform`) call it to refuse a config whose AI plugin only
 * `serve` would mount (#31411, ruled B: the maintainer's 「以上都同意」).
 *
 * ⛔ Do not restate the rule anywhere else. A second copy is how the migrate
 * commands came to plan without the `ai_*` tables `serve` declares: they read
 * none of it.
 */

/** The headless AI service `serve` auto-injects. */
export const AI_SERVICE_PACKAGE = '@objectstack/service-ai';
/** AI Studio, which builds on the base service; declaring it implies the base. */
export const AI_STUDIO_PACKAGE = '@objectstack/service-ai-studio';

/** How `serve` loads an optional, separately-published service plugin. */
export type OptionalPluginLoad = 'required' | 'auto' | 'off';

/**
 * Load an optional service plugin by INTENT, never by package presence (#1597):
 *
 *  - the tier is the orthogonal DENY: `tierAllowed: false` ⇒ `off`, whatever
 *    the intent;
 *  - an explicit `requires: [...]` capability ⇒ `required` (a missing or
 *    crashing package is a hard boot error);
 *  - the package merely declared in the app's `package.json` ⇒ `auto`
 *    (best-effort);
 *  - otherwise ⇒ `off`, with no speculative import.
 */
export function resolveOptionalPluginLoad(opts: {
  tierAllowed: boolean;
  required: boolean;
  declared: boolean;
}): OptionalPluginLoad {
  if (!opts.tierAllowed) return 'off';
  if (opts.required) return 'required';
  if (opts.declared) return 'auto';
  return 'off';
}

/**
 * How `serve` loads the base AI service for a config, before it looks at the
 * config's own plugins ({@link mountsAiServicePlugin}):
 *
 *  - `requires: ['ai']` or `['ai-studio']` (Studio implies the base) ⇒ required;
 *  - the app's own `package.json` declares `@objectstack/service-ai` or
 *    `@objectstack/service-ai-studio` ⇒ auto;
 *  - the `ai` tier off ⇒ off, whatever the intent.
 *
 * `serve` then loads AI Studio only once the base loaded, so the base's answer
 * is the whole answer to "does `serve` auto-inject AI".
 */
export function resolveAiServiceLoad(input: {
  /** The `requires` tokens the stack declares (not the always-on slate). */
  declaredRequires: ReadonlySet<string>;
  /** Whether the boot's tiers include `ai`. */
  aiTierEnabled: boolean;
  /** Whether the served app's own `package.json` declares a package. */
  hostDeclaresDependency: (pkg: string) => boolean;
}): OptionalPluginLoad {
  return resolveOptionalPluginLoad({
    tierAllowed: input.aiTierEnabled,
    required: input.declaredRequires.has('ai') || input.declaredRequires.has('ai-studio'),
    declared: input.hostDeclaresDependency(AI_SERVICE_PACKAGE) || input.hostDeclaresDependency(AI_STUDIO_PACKAGE),
  });
}

/** Whether the config mounts the AI service plugin itself, read as `serve` reads it: by registered or class name. */
export function mountsAiServicePlugin(plugins: readonly unknown[]): boolean {
  return plugins.some((p) => {
    const plugin = p as { name?: unknown; constructor?: { name?: unknown } } | null | undefined;
    return plugin?.name === 'com.objectstack.service-ai' || plugin?.constructor?.name === 'AIServicePlugin';
  });
}

/**
 * Why the migrate commands refuse a config whose AI plugin only `serve` would
 * mount, and what the operator does instead.
 */
export function describeAiAutoInjectRefusal(load: Exclude<OptionalPluginLoad, 'off'>): string {
  const why = load === 'required'
    ? "the stack's `requires` names `ai` (or `ai-studio`)"
    : `the app's package.json declares ${AI_SERVICE_PACKAGE} (or ${AI_STUDIO_PACKAGE})`;
  return `\`os serve\` auto-injects the AI plugin (${AI_SERVICE_PACKAGE}) for this config — ${why} and the config `
    + 'mounts no AI plugin — and `os migrate` does not compose it, so this run would plan without the ai_* tables '
    + '`os serve` declares. Refused before planning. Remedy: mount the AI plugin explicitly in the config '
    + `(\`plugins: [new AIServicePlugin()]\`, imported from ${AI_SERVICE_PACKAGE}), then re-run.`;
}
