// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createRequire } from 'node:module';
import path from 'node:path';
import { providesCapability } from '@objectstack/core';
import { createHostImporter, packageNameFromSpecifier } from '@objectstack/types/node';
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
 *
 * A finding a PACKAGE declared (see {@link preflightDeclaredCapabilities}) is
 * prefixed with that package, in the `package '<id>' — ` spelling the
 * per-package author-time rule pass puts on its findings. Without a package the
 * text is exactly what it was.
 */
export function renderCapabilityMessage(c: DeclaredCapabilityClassification): string {
  const text = renderTokenMessage(c);
  return c.package === undefined ? text : `package '${c.package}' — ${text}`;
}

/**
 * What an `enterprise`-edition capability's metadata does while no provider is
 * wired in, for the tokens whose effect has a concrete shape worth naming.
 *
 * WHICH tokens get a finding is never read from here: every token whose
 * registry row (`PLATFORM_CAPABILITY_PROVIDERS`) carries `edition: 'enterprise'`
 * gets one, and a token with no row here gets the generic sentence of
 * {@link enterpriseAbsenceConsequence}. This table only sharpens the
 * consequence. Every key is pinned to an enterprise-edition registry row in
 * `capability-preflight.test.ts`, so a row cannot outlive its token.
 */
export const ENTERPRISE_ABSENCE_CONSEQUENCE: Readonly<Record<string, string>> = Object.freeze({
  // The sharing layer fails CLOSED without the `hierarchy-scope-resolver`
  // service (`SharingService.resolveOwnerScopeIds`, ADR-0057): a hierarchy
  // scope never widens, and nothing logs it.
  'hierarchy-security':
    "the hierarchy scopes (`own_and_reports`, `unit`, `unit_and_below`) behave as owner-only",
});

/**
 * The consequence sentence for an `enterprise` token with no provider wired in.
 * It names the edition that enforces the token and what the open edition does
 * instead, and nothing else: no product pitch, one fact an author can act on.
 */
export function enterpriseAbsenceConsequence(token: string): string {
  const shape = Object.prototype.hasOwnProperty.call(ENTERPRISE_ABSENCE_CONSEQUENCE, token)
    ? ENTERPRISE_ABSENCE_CONSEQUENCE[token]
    : `nothing provides "${token}", and the metadata that relies on it is not enforced`;
  return `The enterprise edition enforces it; on the open edition ${shape}, and no log line says so.`;
}

/** {@link renderCapabilityMessage} without the package prefix. */
function renderTokenMessage(c: DeclaredCapabilityClassification): string {
  const p = c.provider;
  if (c.wiring !== undefined && p?.package) {
    const note = p.note ? ` (${p.note})` : '';
    const found =
      c.wiring.state === 'unloadable'
        ? `${p.package} resolves here, but it could not be loaded to check \`plugins[]\` (${c.wiring.error})`
        : `${p.package} is installed, but no entry of \`plugins[]\` comes from it, and nothing mounts an enterprise provider on its own`;
    return (
      `Capability "${c.token}" is provided by ${p.package}${note}. ${found}. ` +
      `${enterpriseAbsenceConsequence(c.token)} ` +
      `Add its plugin to \`plugins[]\`, or remove "${c.token}" from \`requires\`.`
    );
  }
  switch (c.status) {
    case 'installable': {
      const pkg = p!.package!;
      if (p!.edition === 'enterprise') {
        const note = p!.note ? ` (${p!.note})` : '';
        return (
          `Capability "${c.token}" is provided by ${pkg}${note}, which is not installed. ` +
          `${enterpriseAbsenceConsequence(c.token)} ` +
          `Install ${pkg} and add its plugin to \`plugins[]\`, or remove "${c.token}" from \`requires\`.`
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
 * A classified capability, and the package whose `requires` declared it.
 * `package` is absent when the stack's own top level declared it.
 */
export interface DeclaredCapabilityClassification extends CapabilityClassification {
  readonly package?: string;
  /**
   * Set only by {@link preflightProviderWiring}: an `enterprise` token whose
   * provider package resolves (`status: 'ok'`) but which no `plugins[]` entry
   * provides (`unwired`), or whose package could not be loaded to tell
   * (`unloadable`). Nothing mounts an enterprise provider from `requires`, so
   * a resolvable package alone enforces nothing.
   */
  readonly wiring?: { readonly state: 'unwired' } | { readonly state: 'unloadable'; readonly error: string };
}

/** {@link CapabilityPreflightResult}, each finding attributed to where it was declared. */
export interface DeclaredCapabilityPreflightResult {
  readonly errors: DeclaredCapabilityClassification[];
  readonly warnings: DeclaredCapabilityClassification[];
}

/**
 * The `os validate` / `os build` preflight over every place a stack DECLARES
 * capabilities: its own top level, or each `packages[]` body.
 *
 * A multi-package `composeStacks(…, { manifest: 'preserve' })` artifact carries
 * `requires` once, inside the body of the package that declared it (ADR-0130
 * D4, 2026-09-22 addendum), and nothing at its top level. A preflight that read
 * only the top level read `[]` there, so a capability with no installable
 * provider passed both doors with exit 0, while the same token in one
 * `defineStack` exits 1.
 *
 * The resolution rule is `resolveStackCollection`'s (`stack-collections.ts`):
 * a top-level `requires` WINS whenever it is present. In the additive shape
 * that array already is the union of the bodies, and a single-package stack has
 * nothing else, so every stack that declares `requires` at its top level is
 * judged exactly as before, unattributed. The bodies are read only when the top
 * level does not carry the key, and each finding there names its package,
 * because a token is removed from the package that declared it. The same token
 * in two packages is reported once per package for that reason.
 *
 * @param opts.requires - The stack's top-level `requires`, as declared.
 * @param opts.packages - The stack's `packages[]` entries, as `artifactPackages`
 *   (`artifact-packages.ts`) names them. Passed in, never derived here: that
 *   module carries the one package-id rule, and importing it would load
 *   `@objectstack/lint` into `os serve`, which imports this module.
 */
export function preflightDeclaredCapabilities(opts: {
  requires: unknown;
  packages: ReadonlyArray<{ readonly id: string; readonly body: Record<string, unknown> }>;
  projectDir: string;
  /** Injectable for tests; defaults to on-disk `require.resolve` resolution. */
  isInstalled?: (pkg: string) => boolean;
}): DeclaredCapabilityPreflightResult {
  const isInstalled = opts.isInstalled ?? makeProviderResolver(opts.projectDir);
  if (Array.isArray(opts.requires) || opts.packages.length === 0) {
    return preflightRequiredCapabilities({
      requires: Array.isArray(opts.requires) ? opts.requires : [],
      projectDir: opts.projectDir,
      isInstalled,
    });
  }
  const errors: DeclaredCapabilityClassification[] = [];
  const warnings: DeclaredCapabilityClassification[] = [];
  for (const pkg of opts.packages) {
    const declared = pkg.body.requires;
    const result = preflightRequiredCapabilities({
      requires: Array.isArray(declared) ? declared : [],
      projectDir: opts.projectDir,
      isInstalled,
    });
    errors.push(...result.errors.map((c) => ({ ...c, package: pkg.id })));
    warnings.push(...result.warnings.map((c) => ({ ...c, package: pkg.id })));
  }
  return { errors, warnings };
}

// ── Wiring (enterprise providers are mounted from `plugins[]` only) ─────────

/** Loads a provider package's module the way the served app would reach it. */
export type ProviderModuleLoader = (pkg: string) => Promise<unknown>;

/**
 * The default {@link ProviderModuleLoader}: `serve`'s host-anchored importer
 * (`createHostImporter`, the app's own declaration first), falling back to
 * this package's module graph. Loading a module runs it, so this is only ever
 * called for a token whose package already resolved.
 */
export function makeProviderModuleLoader(projectDir: string): ProviderModuleLoader {
  return createHostImporter(projectDir, {
    fallbackImport: (specifier) => import(/* webpackIgnore: true */ specifier),
  });
}

/** Names of the functions a module exports (its classes), the identities `providesCapability` matches. */
function exportedFunctionNames(mod: unknown): string[] {
  const names = new Set<string>();
  const visit = (bag: unknown) => {
    if (!bag || (typeof bag !== 'object' && typeof bag !== 'function')) return;
    for (const value of Object.values(bag as Record<string, unknown>)) {
      if (typeof value === 'function' && value.name) names.add(value.name);
    }
  };
  visit(mod);
  visit((mod as { default?: unknown } | null | undefined)?.default);
  return [...names];
}

/**
 * The `enterprise` tokens a stack declares whose provider package RESOLVES,
 * but which no `plugins[]` entry provides.
 *
 * {@link preflightDeclaredCapabilities} asks only whether a token's package
 * can be resolved. For an `open` token that is the whole question, because
 * `os serve` mounts the provider from `requires` itself. For an `enterprise`
 * token it is not: no runtime in this repository mounts an enterprise provider
 * from `requires` (`serve`'s resolver has no row for one), so the app must wire
 * the plugin into `plugins[]`, and a package that resolves but is not wired
 * enforces nothing. Which tokens are `enterprise` is the registry's edition
 * tag, never a list here.
 *
 * A `plugins[]` entry provides the token when it is an instance whose class (or
 * `name`) is one the provider package exports, the exact identity match
 * `serve` uses (`providesCapability`), or a string entry naming that package.
 * A package that resolves but cannot be loaded is reported as such, never
 * read as wired.
 *
 * @param opts.plugins - The stack's top-level `plugins` (`plugins[]` is a
 *   host-level array; package bodies carry none).
 */
export async function preflightProviderWiring(opts: {
  requires: unknown;
  packages: ReadonlyArray<{ readonly id: string; readonly body: Record<string, unknown> }>;
  plugins: unknown;
  projectDir: string;
  /** Injectable for tests; defaults to on-disk `require.resolve` resolution. */
  isInstalled?: (pkg: string) => boolean;
  /** Injectable for tests; defaults to {@link makeProviderModuleLoader}. */
  loadModule?: ProviderModuleLoader;
}): Promise<DeclaredCapabilityClassification[]> {
  const isInstalled = opts.isInstalled ?? makeProviderResolver(opts.projectDir);
  const loadModule = opts.loadModule ?? makeProviderModuleLoader(opts.projectDir);
  const plugins = Array.isArray(opts.plugins) ? opts.plugins : [];

  // Same rule as `preflightDeclaredCapabilities`: a top-level `requires` wins;
  // otherwise each package body's, attributed to its package.
  const sources: Array<{ tokens: unknown[]; package?: string }> =
    Array.isArray(opts.requires) || opts.packages.length === 0
      ? [{ tokens: Array.isArray(opts.requires) ? opts.requires : [] }]
      : opts.packages.map((p) => ({
          tokens: Array.isArray(p.body.requires) ? (p.body.requires as unknown[]) : [],
          package: p.id,
        }));

  const verdicts = new Map<string, Promise<DeclaredCapabilityClassification['wiring'] | undefined>>();
  const judge = (pkg: string) => {
    let v = verdicts.get(pkg);
    if (!v) {
      v = (async () => {
        const named = plugins.some(
          (entry) => typeof entry === 'string' && packageNameFromSpecifier(entry) === pkg,
        );
        if (named) return undefined;
        let mod: unknown;
        try {
          mod = await loadModule(pkg);
        } catch (err) {
          return { state: 'unloadable' as const, error: err instanceof Error ? err.message : String(err) };
        }
        return providesCapability(plugins, exportedFunctionNames(mod)) ? undefined : { state: 'unwired' as const };
      })();
      verdicts.set(pkg, v);
    }
    return v;
  };

  const found: DeclaredCapabilityClassification[] = [];
  for (const source of sources) {
    const seen = new Set<string>();
    for (const token of source.tokens) {
      if (typeof token !== 'string' || seen.has(token)) continue;
      seen.add(token);
      const c = classifyRequiredCapability(token, isInstalled);
      if (c.status !== 'ok' || c.provider?.edition !== 'enterprise' || !c.provider.package) continue;
      const wiring = await judge(c.provider.package);
      if (wiring) found.push(source.package === undefined ? { ...c, wiring } : { ...c, package: source.package, wiring });
    }
  }
  return found;
}

/** One capability advisory as `os validate --json` and `os verify --json` carry it. */
export interface CapabilityAdvisory {
  readonly token: string;
  readonly message: string;
}

/**
 * Every capability finding for a stack, in one list: the resolution preflight's
 * errors and warnings, then the wiring findings. `os verify` reports all of
 * them as advisories (its exit code does not read them); `os serve` prints
 * them at start-up.
 */
export async function judgeDeclaredCapabilities(opts: {
  requires: unknown;
  packages: ReadonlyArray<{ readonly id: string; readonly body: Record<string, unknown> }>;
  plugins: unknown;
  projectDir: string;
  isInstalled?: (pkg: string) => boolean;
  loadModule?: ProviderModuleLoader;
}): Promise<{ errors: CapabilityAdvisory[]; warnings: CapabilityAdvisory[] }> {
  const isInstalled = opts.isInstalled ?? makeProviderResolver(opts.projectDir);
  const resolution = preflightDeclaredCapabilities({ ...opts, isInstalled });
  const wiring = await preflightProviderWiring({ ...opts, isInstalled });
  const advise = (c: DeclaredCapabilityClassification): CapabilityAdvisory => ({
    token: c.token,
    message: renderCapabilityMessage(c),
  });
  return {
    errors: resolution.errors.map(advise),
    warnings: [...resolution.warnings, ...wiring].map(advise),
  };
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
