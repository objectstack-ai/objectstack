// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Consumer-App rules — ADR-0019 D6 (purity) & D7 (capability-by-reference).
 *
 * P2 landing draft. These are **pure validators** that return a list of
 * human-readable violation strings (the same convention as
 * `validateNamespacePrefix` / `validateCrossReferences` in `stack.zod.ts`).
 * They do not throw and have no side effects, so callers choose the policy:
 *
 * - `defineStack()` currently wires them **warn-only** (non-breaking) because
 *   existing reference apps (`app-crm`, `app-showcase`) import JS action
 *   modules and would otherwise fail. See `docs/plans/p2-manifest-two-tier.md`.
 * - The Marketplace publish path (future) can treat the same violations as
 *   hard errors for consumer `type: app` listings.
 *
 * Scope of this draft: D6 flags code-bearing surfaces on a `type: app`
 * package; D7 checks that `requires` entries look like abstract capability
 * tokens (not paths, npm specs, or version-pinned package refs). The
 * namespace-set relaxation (D4) and the unified capability registry / install
 * gate (D7 runtime side, P4) are out of scope here.
 */

import type { ObjectStackManifest } from './manifest.zod';
import { isConsumerInstallable } from './plugin.zod';

/**
 * Manifest `contributes.*` keys that imply executable code (a JS/TS module
 * must be loaded to honor them). A consumer App (ADR-0019 D6) must ship none
 * of these — they belong to code-plane packages (driver/server/…).
 */
const CODE_BEARING_CONTRIBUTION_KEYS = [
  'drivers',     // storage/db driver registration → loads a module
  'actions',     // server actions → backed by imported functions
  'commands',    // CLI commands → resolved by importing the package module
  'functions',   // ObjectQL query functions → native implementation
  'fieldTypes',  // custom field widgets/handlers → code
  'kinds',       // new metadata kinds → a parser/handler module
] as const;

/**
 * D6 — Consumer-App purity.
 *
 * When `manifest.type` is a consumer-installable unit (`app`), the package
 * must contain no executable code and no runtime-plugin / `PluginSource`
 * reference. "Code" here means a reference to an external runtime module; the
 * platform's own declarative expression languages (formula, ObjectQL, flow /
 * approval / validation expressions, agent prompt + declarative tool bindings)
 * are NOT code and are allowed.
 *
 * This validator inspects the manifest only. `stack`-level code surfaces
 * (`plugins` / `devPlugins`) are passed separately so the same function can be
 * reused by both `defineStack` and the Marketplace publish path.
 *
 * @returns one violation string per offending surface (empty = pure).
 */
export function validateConsumerAppPurity(
  manifest: ObjectStackManifest | undefined,
  stackCodeSurfaces?: {
    /** Count of runtime `plugins` declared on the stack definition. */
    pluginCount?: number;
    /** Count of `devPlugins` declared on the stack definition. */
    devPluginCount?: number;
  },
): string[] {
  const errors: string[] = [];
  if (!manifest || !isConsumerInstallable(manifest.type)) return errors;

  const contributes = (manifest.contributes ?? {}) as Record<string, unknown>;
  for (const key of CODE_BEARING_CONTRIBUTION_KEYS) {
    const v = contributes[key];
    if (Array.isArray(v) && v.length > 0) {
      errors.push(
        `Consumer App '${manifest.id}' (type: app) declares code-bearing 'contributes.${key}'. ` +
          `Move it to a code-plane package (driver/server/…) and reference its capability via 'requires' (ADR-0019 D6/D7).`,
      );
    }
  }

  // capability.provides means this package implements a service for others —
  // that is a code-plane concern, not a consumer App.
  const provides = manifest.capabilities?.provides;
  if (Array.isArray(provides) && provides.length > 0) {
    errors.push(
      `Consumer App '${manifest.id}' (type: app) declares 'capabilities.provides'. ` +
        `Providing a capability is a code-plane role; a consumer App only 'requires' capabilities (ADR-0019 D6/D7).`,
    );
  }

  // extensions[].implementation is a module path → code.
  const extImpls = manifest.capabilities?.extensions;
  if (Array.isArray(extImpls) && extImpls.length > 0) {
    errors.push(
      `Consumer App '${manifest.id}' (type: app) declares 'capabilities.extensions' (module implementations). ` +
        `These are code-plane contributions (ADR-0019 D6).`,
    );
  }

  if ((stackCodeSurfaces?.pluginCount ?? 0) > 0) {
    errors.push(
      `Consumer App '${manifest.id}' (type: app) bundles ${stackCodeSurfaces!.pluginCount} runtime 'plugins'. ` +
        `A consumer App must be pure metadata; runtime plugins are code-plane (ADR-0019 D6).`,
    );
  }
  if ((stackCodeSurfaces?.devPluginCount ?? 0) > 0) {
    errors.push(
      `Consumer App '${manifest.id}' (type: app) bundles ${stackCodeSurfaces!.devPluginCount} 'devPlugins' (code-plane) (ADR-0019 D6).`,
    );
  }

  return errors;
}

/**
 * Shape of a valid abstract capability token (ADR-0019 D7).
 * Lowercase identifier, optionally dotted (e.g. `sql`, `sys.sql`, `blob.s3`).
 * Deliberately rejects paths, npm specs, and version pins.
 */
const CAPABILITY_TOKEN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$/;

/**
 * D7 — capability-by-reference shape.
 *
 * `stack.requires` must list **abstract capability tokens**, never a concrete
 * package, path, npm spec, or version-pinned reference. The runtime resolves
 * tokens → providers (today via the closed `CAPABILITY_PROVIDERS` table in
 * `runtime/src/cloud/capability-loader.ts`; P4 opens this into a registry).
 *
 * @returns one violation string per malformed token (empty = all valid).
 */
export function validateRequiresShape(requires: readonly string[] | undefined): string[] {
  const errors: string[] = [];
  if (!requires) return errors;
  for (const tok of requires) {
    if (typeof tok !== 'string' || !CAPABILITY_TOKEN.test(tok)) {
      errors.push(
        `'requires' entry '${tok}' is not an abstract capability token. ` +
          `Use a name like 'sql' or 'sys.sql' — not a path, npm spec, or version-pinned package ref (ADR-0019 D7).`,
      );
    }
  }
  return errors;
}

export { isConsumerInstallable, CONSUMER_INSTALLABLE_TYPES } from './plugin.zod';
