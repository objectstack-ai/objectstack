// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Per-file integrity verification for `.osplugin` artifacts (ADR-0025 §3.2).
 *
 * Checks an unpacked artifact's files against the manifest's declared
 * `integrity` map (artifact-relative path → SRI-style `sha256-<base64>`
 * digest, the format `os plugin build` writes). Like its sibling
 * `plugin-artifact-signature.ts`, this module is pure and dependency-free
 * (node:crypto only) so it stays byte-for-byte portable to the cloud
 * control plane, which owes the unpack-time re-verification leg
 * (ADR-0025 §3.5 step 5 — tracked on #11331, NOT discharged by this
 * module). The framework caller is the `os plugin publish` preflight: the
 * publisher self-checks its own artifact before upload.
 *
 * Verdict semantics:
 *   - absent map (`undefined` / `null`) → ok, `skipped: true` — the field
 *     is `.optional()` in the manifest schema, so artifacts predating
 *     integrity computation stay publishable (permissive by contract).
 *   - digest mismatch, declared entry with no file, or file with no
 *     declared entry → NOT ok, with one structured violation per finding.
 *     An extra file is refused because a stale map is exactly the drift
 *     this check exists to catch.
 */

import { createHash } from 'node:crypto';

/** A single unpacked artifact file. `path` is POSIX, archive-relative. */
export interface IntegrityFile {
  path: string;
  data: Uint8Array;
}

export type IntegrityViolationKind = 'digest_mismatch' | 'missing_file' | 'extra_file';

/** One structured integrity finding (the rejection envelope's unit). */
export interface IntegrityViolation {
  kind: IntegrityViolationKind;
  /** Artifact-relative POSIX path the finding is about. */
  path: string;
  /** The digest the manifest declares (absent for `extra_file`). */
  declared?: string;
  /** The digest computed from the supplied bytes (absent unless comparable). */
  actual?: string;
}

export interface VerifyIntegrityResult {
  /** Overall verdict: every declared digest matched and no file was unaccounted for. */
  ok: boolean;
  /** True when no integrity map was supplied, so nothing was checked (still `ok`). */
  skipped: boolean;
  /** Number of declared entries whose digests were computed and compared. */
  checked: number;
  violations: IntegrityViolation[];
}

/** SRI hash algorithms this verifier can compute (`<alg>-<base64>`). */
const SRI_ALGORITHMS = new Set(['sha256', 'sha384', 'sha512']);

function sriDigestFor(declared: string, data: Uint8Array): string {
  const dash = declared.indexOf('-');
  const alg = dash > 0 && SRI_ALGORITHMS.has(declared.slice(0, dash)) ? declared.slice(0, dash) : 'sha256';
  return `${alg}-${createHash(alg).update(data).digest('base64')}`;
}

/**
 * Verify `files` against the manifest's declared `integrity` map.
 *
 * `options.exempt` names paths outside the map's coverage — the compiled
 * manifest itself and the signature placeholder, which `computeIntegrity`
 * excludes at build time (the manifest cannot hash itself, and the
 * signature signs the manifest) — so their presence is never an
 * `extra_file` finding.
 */
export function verifyIntegrity(
  files: readonly IntegrityFile[],
  integrity: Readonly<Record<string, string>> | null | undefined,
  options: { exempt?: readonly string[] } = {},
): VerifyIntegrityResult {
  if (integrity === null || integrity === undefined) {
    return { ok: true, skipped: true, checked: 0, violations: [] };
  }
  const exempt = new Set(options.exempt ?? []);
  const byPath = new Map<string, Uint8Array>();
  for (const f of files) {
    if (!exempt.has(f.path)) byPath.set(f.path, f.data);
  }

  const violations: IntegrityViolation[] = [];
  let checked = 0;
  for (const [path, declaredRaw] of Object.entries(integrity)) {
    if (exempt.has(path)) continue;
    const declared = typeof declaredRaw === 'string' ? declaredRaw : String(declaredRaw);
    const data = byPath.get(path);
    if (data === undefined) {
      violations.push({ kind: 'missing_file', path, declared });
      continue;
    }
    checked++;
    const actual = sriDigestFor(declared, data);
    if (actual !== declared) violations.push({ kind: 'digest_mismatch', path, declared, actual });
  }
  for (const path of [...byPath.keys()].sort()) {
    if (!Object.prototype.hasOwnProperty.call(integrity, path)) {
      violations.push({ kind: 'extra_file', path });
    }
  }
  return { ok: violations.length === 0, skipped: false, checked, violations };
}

/** Render one violation as a single human-actionable line. */
export function formatIntegrityViolation(v: IntegrityViolation): string {
  switch (v.kind) {
    case 'digest_mismatch':
      return `${v.path}: digest mismatch — manifest declares ${v.declared}, artifact bytes hash to ${v.actual}`;
    case 'missing_file':
      return `${v.path}: declared in the integrity map but absent from the artifact`;
    case 'extra_file':
      return `${v.path}: present in the artifact but not in the integrity map`;
  }
}
