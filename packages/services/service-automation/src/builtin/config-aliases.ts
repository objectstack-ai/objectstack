// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Deprecation shim for non-canonical flow-node `config` keys.
 *
 * `FlowNodeSchema.config` is an unconstrained `z.record(z.string(), z.unknown())`
 * (packages/spec/src/automation/flow.zod.ts), so the spec blesses *no* particular
 * key — the executor is the only thing that gives `config` a shape at runtime.
 * Historically several built-in executors quietly accepted a non-canonical alias
 * via `cfg.canonical ?? cfg.alias` (e.g. `object` for `objectName`, `filters` for
 * `filter`). That Postel's-law tolerance fossilizes the wrong shape into a
 * de-facto second contract and hides metadata-generation bugs: a flow authored
 * with the wrong key "just works" at runtime, so nothing ever flags it.
 *
 * The convergence (mirroring the `fields` / `fieldValues` decision) is to make
 * the canonical key the *single* contract and reject the wrong shape at
 * author/publish time:
 *   • the cloud `graph-lint` gate rejects the alias when a flow is published, and
 *   • the authoring sources (skills / example flows) only ever emit the canonical.
 *
 * graph-lint only runs at publish, so it cannot reach flows already stored in
 * prod that are never re-published. {@link readAliasedConfig} closes that gap for
 * the **deprecation window**: it keeps accepting the alias (so live flows keep
 * running) but emits a one-time `logger.warn` per alias steering the author to
 * the canonical key. Removal of the alias paths is tracked as a follow-up and
 * happens once the window has elapsed and graph-lint has been enforcing.
 *
 * The `filters` → `filter` alias has since been **retired from this shim** and
 * promoted into the ADR-0087 D2 conversion layer (`@objectstack/spec` conversion
 * `flow-node-crud-filter-alias`): it is rewritten to the canonical key **at
 * load** — including the runtime rehydration seam (`AutomationEngine.registerFlow`
 * runs the conversion before parse), which is exactly the stored-prod-flow gap
 * this shim describes above, now closed for `filters` by the conversion instead
 * of an executor fallback. So the CRUD executors read `cfg.filter` directly. That
 * is the PD #12 retirement path the ADR prescribes — a scattered consumer-side
 * fallback replaced by one declared, loud, tested, expiring conversion entry. The
 * remaining `object` → `objectName` alias is the next candidate to graduate.
 *
 * @see crud-nodes.ts for the remaining call site (`objectName`).
 */

/** One-time-warning ledger, keyed by `${nodeType}:${canonical}<-${alias}`. */
const warnedAliases = new Set<string>();

/** Test-only: clear the one-time-warning ledger so each test starts fresh. */
export function __resetAliasDeprecationWarnings(): void {
  warnedAliases.clear();
}

/**
 * Read a node-config value by its **canonical** key, tolerating deprecated
 * aliases for one deprecation window.
 *
 * Returns the value under `canonical` when present; otherwise the first present
 * `alias` (warning once), otherwise `undefined`. "Present" means `!= null`, so
 * the fall-through matches the `cfg.canonical ?? cfg.alias` semantics it replaces
 * — callers keep applying their own default (`?? {}` / `?? ''`).
 *
 * @deprecated The alias paths exist only to keep already-stored flows running.
 *   Author flows with the canonical key; the aliases will be removed.
 */
export function readAliasedConfig(
  cfg: Record<string, unknown>,
  nodeType: string,
  canonical: string,
  aliases: readonly string[],
  logger: { warn(message: string): void },
): unknown {
  if (cfg[canonical] != null) return cfg[canonical];
  for (const alias of aliases) {
    if (cfg[alias] != null) {
      const key = `${nodeType}:${canonical}<-${alias}`;
      if (!warnedAliases.has(key)) {
        warnedAliases.add(key);
        logger.warn(
          `[${nodeType}] config key '${alias}' is a deprecated alias of '${canonical}'. ` +
            `Rename it to '${canonical}' — the alias still works but is deprecated, rejected at ` +
            `publish time by graph-lint, and will be removed in a future release.`,
        );
      }
      return cfg[alias];
    }
  }
  return undefined;
}
