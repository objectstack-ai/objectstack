// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE read of the compiled manifest an `.osplugin` artifact carries
 * (ADR-0025 §3.2), shared by both doors that read it after the build:
 * `os plugin install` (before anything is unpacked) and the boot-time loader
 * (`installed-plugin-loader.ts`, check 4, before anything is imported).
 *
 * The manifest is parsed through `ManifestSchema`, the contract `os plugin
 * build` already holds the source manifest to, so an artifact built before a
 * schema change (a retired value such as `packaging: 'manifest-deps'`) or one
 * whose compiled manifest drifted is refused with the schema's own words: the
 * prescription a retired value carries reaches the operator instead of a
 * failure further down the line (`import_failed`). ⛔ Neither door keeps a
 * second copy of any manifest rule: both ask this function and map its answer
 * to their own refusal channel.
 */

import { formatZodIssue } from '@objectstack/spec';
import { ManifestSchema, type ObjectStackManifestParsed } from '@objectstack/spec/kernel';

/** The manifest at an artifact's root. */
export const COMPILED_PLUGIN_MANIFEST_FILE = 'objectstack.plugin.json';

/** An artifact entry, as `readTarGz` answers it. */
export interface CompiledManifestEntry {
  path: string;
  data: Uint8Array;
}

export type CompiledPluginManifestRead =
  | { ok: true; manifest: ObjectStackManifestParsed }
  /** `unreadable`: no manifest, or not a JSON object. `invalid`: `ManifestSchema` refused it. */
  | { ok: false; reason: 'unreadable' | 'invalid'; message: string; issues: string[] };

/**
 * Read and parse the compiled manifest among an artifact's `files`. On a
 * refusal, `issues` holds one `path: message` line per schema issue (empty
 * for `unreadable`) and `message` says the whole of it on one line.
 */
export function readCompiledPluginManifest(files: readonly CompiledManifestEntry[]): CompiledPluginManifestRead {
  let raw: unknown;
  try {
    const entry = files.find((f) => f.path === COMPILED_PLUGIN_MANIFEST_FILE);
    if (!entry) throw new Error(`${COMPILED_PLUGIN_MANIFEST_FILE} not found`);
    raw = JSON.parse(Buffer.from(entry.data).toString('utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${COMPILED_PLUGIN_MANIFEST_FILE} is not a JSON object`);
  } catch (error) {
    return { ok: false, reason: 'unreadable', message: error instanceof Error ? error.message : String(error), issues: [] };
  }
  const parsed = ManifestSchema.safeParse(raw);
  if (parsed.success) return { ok: true, manifest: parsed.data };
  const issues = parsed.error.issues.flatMap((issue) =>
    formatZodIssue(issue as Parameters<typeof formatZodIssue>[0])
      .split('\n')
      .map((line) => line.trim().replace(/^✗\s*/, '')),
  );
  return {
    ok: false,
    reason: 'invalid',
    message: `${COMPILED_PLUGIN_MANIFEST_FILE} is not a valid plugin manifest: ${issues.join('; ')}`,
    issues,
  };
}
