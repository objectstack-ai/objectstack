// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createRequire } from 'node:module';
import path from 'node:path';
import {
  classifyRequiredCapability,
  RETIRED_PLATFORM_CAPABILITY_GUIDANCE,
  type CapabilityClassification,
} from '@objectstack/spec/kernel';

/**
 * Installable-provider preflight (framework#3366).
 *
 * A capability listed in `requires: [...]` is fail-fast at `serve` time when its
 * provider package is missing — but the generic "not installed, add it to your
 * dependencies" advice is un-followable when the provider has **no installable
 * version in the current edition** (e.g. `ai` → `@objectstack/service-ai`, which
 * went cloud-only in 11.3.0 / ADR-0025). Neither `os validate` nor `os build`
 * caught it, because neither resolves providers or boots the runtime.
 *
 * This module resolves each declared capability's provider the same way `serve`
 * loads it and classifies the result via the spec-owned
 * {@link classifyRequiredCapability}, so a shift-left gate (`os build` /
 * `os validate`) and the `serve` boot error read identically.
 */

// ── Provider resolution ─────────────────────────────────────────────────────

/** True when `err` is a "module not exported / not found" resolution failure. */
function isResolveMiss(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  // A package that IS installed but whose `exports` map doesn't expose the bare
  // entry under the `require` condition (import-only) still counts as installed.
  return code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED';
}

/**
 * Build an `isInstalled(pkg)` predicate that resolves a provider package the way
 * `os serve` actually loads it (`importFromHost`): first from the HOST APP's
 * dir — a locally-linked service or an enterprise plugin the app installed — then
 * from the CLI's own module graph, where the framework `@objectstack/*` providers
 * live as dependencies (serve's bare-import fallback). Resolution never
 * imports/executes the package, so it is cheap and side-effect-free.
 */
export function makeProviderResolver(projectDir: string): (pkg: string) => boolean {
  // Anchoring on `<dir>/package.json` only sets the resolution base — the file
  // itself need not exist (Node walks up node_modules from that directory).
  const hostRequire = createRequire(path.join(projectDir, 'package.json'));
  const cliRequire = createRequire(import.meta.url);
  const resolvableFrom = (req: NodeRequire, pkg: string): boolean => {
    try {
      req.resolve(pkg);
      return true;
    } catch (err) {
      return !isResolveMiss(err);
    }
  };
  return (pkg: string) => resolvableFrom(hostRequire, pkg) || resolvableFrom(cliRequire, pkg);
}

// ── Message rendering ────────────────────────────────────────────────────────

/**
 * The one-line, actionable message for a classified capability. Shared by the
 * build/validate preflight and the serve boot error so both read identically.
 * Only `installable` / `unavailable` / `unknown` produce a message; `ok` is
 * satisfied and never surfaced.
 */
export function renderCapabilityMessage(c: CapabilityClassification): string {
  const p = c.provider;
  switch (c.status) {
    case 'installable': {
      const pkg = p!.package!;
      if (p!.edition === 'enterprise') {
        const note = p!.note ? ` (${p!.note})` : '';
        return (
          `Capability "${c.token}" is provided by ${pkg}${note}. ` +
          `Run \`pnpm add ${pkg}\` and add it to \`plugins[]\`, or remove "${c.token}" from \`requires\`.`
        );
      }
      return (
        `Capability "${c.token}" requires ${pkg}, which is not installed. ` +
        `Run \`pnpm add ${pkg}\`, or remove "${c.token}" from \`requires\`.`
      );
    }
    case 'unavailable': {
      const detail = p?.note ? ` (${p.note})` : '';
      const lead = p?.package
        ? `Capability "${c.token}" resolves to ${p.package}, which is not available in the open edition${detail}.`
        : `Capability "${c.token}" is provided only by a cloud runtime and has no open-edition provider${detail}.`;
      return (
        `${lead} ` +
        `Remove "${c.token}" from \`requires\`, or run under a cloud runtime that provides the "${c.token}" tier.`
      );
    }
    case 'unknown':
      // A RETIRED token is not a typo — the word used to be right — so it gets
      // its retirement prescription, the same text `defineStack` refuses it
      // with and `os serve` warns with, never "check for a typo".
      if (Object.prototype.hasOwnProperty.call(RETIRED_PLATFORM_CAPABILITY_GUIDANCE, c.token)) {
        return RETIRED_PLATFORM_CAPABILITY_GUIDANCE[c.token];
      }
      return `requires: "${c.token}" is not a known platform capability — check for a typo.`;
    case 'ok':
    default:
      return `Capability "${c.token}" is satisfied.`;
  }
}

// ── Preflight (build / validate) ─────────────────────────────────────────────

export interface CapabilityPreflightResult {
  /**
   * FATAL findings (`status: 'unavailable'`) — a declared capability whose
   * provider has no installable version in the active edition. Fails the build.
   */
  readonly errors: CapabilityClassification[];
  /**
   * Advisory findings — `installable` (absent but addable → `pnpm add` hint) and
   * `unknown` (a typo, or a retired token, which renders its retirement
   * prescription). Never fatal.
   */
  readonly warnings: CapabilityClassification[];
}

/**
 * Classify every DECLARED `requires` token (deduped) against the resolvable
 * providers. Only explicit declarations are checked — the platform's own
 * auto-injected convenience defaults (`ALWAYS_ON`, `mcp`, …) carry no "required"
 * intent, exactly as `serve` treats them.
 */
export function preflightRequiredCapabilities(opts: {
  requires: readonly unknown[];
  projectDir: string;
  /** Injectable for tests; defaults to on-disk `require.resolve` resolution. */
  isInstalled?: (pkg: string) => boolean;
}): CapabilityPreflightResult {
  const isInstalled = opts.isInstalled ?? makeProviderResolver(opts.projectDir);
  const errors: CapabilityClassification[] = [];
  const warnings: CapabilityClassification[] = [];
  const seen = new Set<string>();
  for (const token of opts.requires) {
    if (typeof token !== 'string' || seen.has(token)) continue;
    seen.add(token);
    const c = classifyRequiredCapability(token, isInstalled);
    if (c.status === 'unavailable') errors.push(c);
    else if (c.status === 'installable' || c.status === 'unknown') warnings.push(c);
  }
  return { errors, warnings };
}

/**
 * The fatal one-line message `os serve` throws when a DECLARED capability's
 * provider import fails as module-not-found. The package is already confirmed
 * absent at the throw site, so classification runs against a `false` resolver —
 * yielding the same `installable` / `unavailable` wording the build preflight
 * prints, so boot and preflight read identically (framework#3366).
 */
export function missingProviderMessage(token: string): string {
  return renderCapabilityMessage(classifyRequiredCapability(token, () => false));
}
