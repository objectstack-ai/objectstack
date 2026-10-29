// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What a host proved about an installed plugin's artifact before it imported
 * the plugin's code (ADR-0025 §3.5 M1).
 *
 * A signature is verified over the `.osplugin` bytes it signs, and by the time
 * a plugin reaches the kernel's `PluginLoader` it is an in-memory module with
 * no bytes to verify. So the host that verified the artifact — the runtime's
 * boot-time loader for installed plugins — records its verdict against the
 * plugin object here, and `PluginLoader` reads it: a plugin that carries a
 * `signature` with no recorded verdict for that exact signature is refused,
 * because a signature string a plugin declares for itself proves nothing.
 *
 * Kept in a module-private `WeakMap`, so the verdict follows the object, adds
 * no property to it, and goes with it.
 */

/** One host verification of an installed plugin's artifact. */
export interface PluginArtifactVerdict {
  /**
   * The detached signature that verified over the artifact bytes, or `null`
   * for an install admitted unsigned under `--trust-unsigned`.
   */
  signature: string | null;
  /** The trusted key's id, or `null` for an unsigned install. */
  keyId: string | null;
  /** The trusted key's fingerprint (`sha256:` + hex of the SPKI DER bytes), or `null`. */
  fingerprint: string | null;
  /** sha256 (hex) of the artifact bytes the verdict covers. */
  artifactSha256: string;
}

const VERDICTS = new WeakMap<object, Readonly<PluginArtifactVerdict>>();

/** Record that `plugin`'s artifact was verified, and how. */
export function recordPluginArtifactVerdict(plugin: object, verdict: PluginArtifactVerdict): void {
  VERDICTS.set(plugin, Object.freeze({ ...verdict }));
}

/** The verdict a host recorded for `plugin`, if any. */
export function pluginArtifactVerdict(plugin: object): Readonly<PluginArtifactVerdict> | undefined {
  return VERDICTS.get(plugin);
}
