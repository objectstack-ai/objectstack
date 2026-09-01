// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createRequire } from 'module';

import { checkProtocolCompat, type ProtocolHandshakeManifest } from '@objectstack/metadata-core';

/**
 * Protocol-version drift advisory.
 *
 * Surfaces the one thing an AI agent (or human) upgrading a third-party app
 * almost never finds on its own: the curated per-major migration guide. When
 * an app's declared compatibility range EXCLUDES the `@objectstack/spec`
 * actually installed in its `node_modules`, and the platform is the newer
 * side, the platform moved ahead of the app and there is breaking-change
 * guidance the author should read before proceeding. Every major from v12 on
 * is guaranteed a `content/docs/releases/v<major>.mdx` page (enforced by
 * `scripts/check-release-notes.mjs`), so the URL below never 404s.
 *
 * The check is advisory-only — it never fails a build/validate/doctor. It
 * exists so the release notes are discoverable at the exact moment of the
 * upgrade, instead of being reverse-engineered from per-package
 * `CHANGELOG.md` files.
 *
 * ## Which axis this reads, and why it is `engines.protocol`
 *
 * This advisory used to read `manifest.specVersion`. `ManifestSchema`
 * (`packages/spec/src/kernel/manifest.zod.ts`) declares no such member and is
 * not `.strict()`, so an authored `specVersion` was accepted and dropped with
 * nothing said — which made the advisory DEAD for stack configs: it could only
 * ever fire for a manifest carrying a key the schema does not offer. The axis
 * is now `manifest.engines.protocol` — declared (`PluginEnginesSchema`),
 * stamped by every scaffold and example, and genuinely enforced at boot
 * (`assertProtocolCompat`, raising `OS_PROTOCOL_INCOMPATIBLE`). `specVersion`
 * is retired from the stack config's CLI vocabulary; it keeps its meaning on
 * the unrelated marketplace TEMPLATE manifest
 * (`packages/spec/src/cloud/template-manifest.zod.ts`), which is a different
 * surface and is untouched.
 *
 * ## Why the range is judged by `checkProtocolCompat` and not re-parsed here
 *
 * `@objectstack/metadata-core`'s handshake is the platform's single reader of
 * that range: it owns the source priority (`engines.protocol` →
 * `engines.platform` → legacy `engine.objectstack`) and the range grammar. Its
 * own header records why `resolveDeclaredRange` was exported — "two readers of
 * `engines.protocol` with two priority orders would be the 'two opinions'
 * defect". A leading-integer parse of our own would be the third such opinion,
 * and it would disagree in exactly the cases that matter: `'>=15 <18'` targets
 * 15 but ADMITS 17, so a naive parse would advise an upgrade against a range
 * that already covers the installed platform. Delegating means the advisory
 * fires precisely when boot would refuse the app — which is what makes it
 * "guidance to read before proceeding" rather than noise.
 *
 * ## Why the installed *package* version is a sound runtime version to compare
 *
 * `PROTOCOL_VERSION` is held in lockstep with the `@objectstack/spec` package
 * major (`packages/spec/src/kernel/protocol-version.test.ts` fails on drift),
 * so the protocol major and the installed package major are the same integer.
 * Comparing against the version resolved from the APP's `node_modules` — not
 * the CLI's compiled-in constant — is deliberate: a globally linked CLI must
 * still report the platform the app actually installed. It also keeps the
 * `docs/releases/v<major>` URL correct, since release majors are package
 * majors.
 */

const RELEASES_BASE = 'https://objectstack.ai/docs/releases';

export interface ProtocolVersionGap {
  /** Major of the `@objectstack/spec` resolved from the app's node_modules. */
  installedMajor: number;
  /** Major the app's declared compatibility range targets. */
  declaredMajor: number;
  /** Full installed spec version (e.g. `17.2.0`). */
  installedVersion: string;
  /** Canonical migration guide for the installed major. */
  url: string;
  /** Ready-to-print one-line advisory. */
  message: string;
  /** Ready-to-print follow-up pointing at the guide. */
  hint: string;
}

/** Resolve the installed `@objectstack/spec` version from the app being operated on. */
function resolveInstalledSpecVersion(): string | null {
  try {
    // Resolve relative to the CWD (the app), not the CLI install, so a globally
    // linked CLI still reports the app's locked spec version. Fall back to the
    // CLI's own resolution if the app doesn't hoist spec to its root.
    const requireFromApp = createRequire(`${process.cwd()}/package.json`);
    const pkg = requireFromApp('@objectstack/spec/package.json') as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // ignore — try the CLI-relative resolution below
  }
  try {
    const requireFromCli = createRequire(import.meta.url);
    const pkg = requireFromCli('@objectstack/spec/package.json') as { version?: string };
    if (typeof pkg.version === 'string') return pkg.version;
  } catch {
    // ignore — spec not resolvable, no advisory
  }
  return null;
}

/** A field of the manifest slice, only if it is actually a string. */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Narrow an unvalidated config manifest to the slice the handshake reads.
 *
 * The commands that call this hand over a manifest that has NOT necessarily
 * been through `ManifestSchema` yet (`doctor` runs on `normalizeStackInput`
 * output typed `any`), so `engines.protocol` can be any JSON value at this
 * point. `resolveDeclaredRange` calls `.trim()` on it — a non-string would
 * throw, and an advisory that can throw is an advisory that changes what the
 * command REJECTS. Narrowing to `string | undefined` here keeps the failure
 * mode at "no advisory". This narrows types only; the range itself is still
 * interpreted exclusively by the handshake.
 */
function toHandshakeManifest(manifest: unknown): ProtocolHandshakeManifest | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const m = manifest as { id?: unknown; engines?: unknown; engine?: unknown };
  const engines = m.engines && typeof m.engines === 'object' ? (m.engines as Record<string, unknown>) : undefined;
  const engine = m.engine && typeof m.engine === 'object' ? (m.engine as Record<string, unknown>) : undefined;
  return {
    id: str(m.id),
    engines: engines ? { protocol: str(engines.protocol), platform: str(engines.platform) } : undefined,
    engine: engine ? { objectstack: str(engine.objectstack) } : undefined,
  };
}

/**
 * Compute a protocol-version drift advisory for the given app manifest, or
 * `null` when there is nothing to say: spec unresolvable, no compatibility
 * range declared, a range shape the handshake does not recognize, a range that
 * already admits the installed platform, or a range that targets a NEWER major
 * than the platform on disk (a stale/mismatched install — a different problem,
 * out of scope for release-note discoverability).
 */
export function checkProtocolVersionGap(
  manifest: unknown,
  /** Injectable for tests; defaults to the spec resolved from the app on disk. */
  installedVersion: string | null = resolveInstalledSpecVersion(),
): ProtocolVersionGap | null {
  if (!installedVersion) return null;
  const slice = toHandshakeManifest(manifest);
  if (!slice) return null;

  // The platform's own handshake decides compatibility. Anything other than a
  // positive incompatibility — `ok`, `no-range`, `unparsed-range` — is a case
  // the loader admits, so the advisory stays silent rather than second-guessing
  // it.
  const result = checkProtocolCompat(slice, installedVersion);
  if (result.status !== 'incompatible') return null;

  const declaredMajor = result.diagnostic.targetMajor;
  const installedMajor = result.runtimeMajor;
  if (declaredMajor === null) return null;
  // Only the upgrade case: the platform on disk is newer than the app targets.
  // This guard also covers an unreadable `installedVersion`, for which the
  // handshake reports `runtimeMajor: 0` — no non-negative declared major can be
  // below it, so a garbled version can never raise a false advisory.
  if (declaredMajor >= installedMajor) return null;

  const url = `${RELEASES_BASE}/v${installedMajor}`;
  // Name the key the range was actually read from. The handshake falls back to
  // `engines.platform` and legacy `engine.objectstack`, and an advisory that
  // told an author to bump `engines.protocol` when it had read `engine` would
  // be sending them to a key they never wrote.
  const source = result.source;
  return {
    installedMajor,
    declaredMajor,
    installedVersion,
    url,
    message:
      `Installed @objectstack/spec is v${installedVersion} but this app declares `
      + `${source} '${result.requiredRange}', which targets protocol v${declaredMajor}.`,
    hint: `Review the v${installedMajor} migration guide before bumping ${source}: ${url}`,
  };
}
