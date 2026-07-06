// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Protocol version handshake (ADR-0087 D1).
 *
 * A package declares the metadata/runtime protocol range it was authored
 * against via its manifest `engines.protocol` (ADR-0025 §3.2, protocol-first
 * per §3.10 #3; falling back to `engines.platform`, then the legacy
 * `engine.objectstack`). Until now that field was **declared but checked
 * nowhere** — an ADR-0078 "declarable-but-inert" violation — so a package
 * built against protocol N loaded by an incompatible runtime failed deep in a
 * schema `.parse()` or a renderer contract instead of at the boundary.
 *
 * This module is that boundary. It turns a version mismatch into a
 * **structured, machine-actionable refusal** carrying a stable code, both
 * versions, and the exact replay command — the same shape whether the consumer
 * is one major behind or five (ADR-0087: timeliness is never load-bearing).
 *
 * It never blocks on a range it cannot parse: it only refuses on a *positive*
 * determination that the declared range excludes the runtime major. Absent and
 * unrecognized ranges are admitted (the former grandfathered, the latter a
 * parser-coverage gap) so the handshake can never cause a false rejection.
 */

import { PROTOCOL_VERSION } from '@objectstack/spec/kernel';
import { MetadataError } from './errors.js';

/** The manifest slice the handshake reads. All fields optional. */
export interface ProtocolHandshakeManifest {
  id?: string;
  version?: string;
  engines?: { protocol?: string; platform?: string };
  /** Legacy single-field compatibility declaration, superseded by `engines`. */
  engine?: { objectstack?: string };
}

export type ProtocolCompatResult =
  | { status: 'ok'; runtimeMajor: number; requiredRange: string; source: RangeSource }
  | { status: 'no-range'; runtimeMajor: number }
  | { status: 'unparsed-range'; runtimeMajor: number; requiredRange: string; source: RangeSource }
  | {
      status: 'incompatible';
      runtimeMajor: number;
      runtimeVersion: string;
      requiredRange: string;
      source: RangeSource;
      /** Stable, machine-readable diagnostic (also the shape emitted as JSON). */
      diagnostic: ProtocolIncompatibleDiagnostic;
    };

export type RangeSource = 'engines.protocol' | 'engines.platform' | 'engine.objectstack';

export interface ProtocolIncompatibleDiagnostic {
  code: 'OS_PROTOCOL_INCOMPATIBLE';
  packageId: string;
  requiredRange: string;
  rangeSource: RangeSource;
  runtimeVersion: string;
  runtimeMajor: number;
  /** The declared major the package targets, when a single major is determinable. */
  targetMajor: number | null;
  /** The command that resolves the refusal (wired end-to-end by ADR-0087 P2). */
  migrateCommand: string;
  message: string;
}

/**
 * Structured error thrown at the install/load boundary for an incompatible
 * package. Extends `MetadataError` so callers can `instanceof` across package
 * boundaries and read `.code`; `.diagnostic` carries the JSON-serializable
 * detail for `--json` output and the MCP surface (ADR-0087 D4).
 */
export class ProtocolIncompatibleError extends MetadataError {
  constructor(public readonly diagnostic: ProtocolIncompatibleDiagnostic) {
    super(diagnostic.code, diagnostic.message);
  }
}

/** First declared range, protocol-first (ADR-0025 §3.10 #3). */
function resolveDeclaredRange(
  manifest: ProtocolHandshakeManifest,
): { range: string; source: RangeSource } | null {
  const protocol = manifest.engines?.protocol?.trim();
  if (protocol) return { range: protocol, source: 'engines.protocol' };
  const platform = manifest.engines?.platform?.trim();
  if (platform) return { range: platform, source: 'engines.platform' };
  const legacy = manifest.engine?.objectstack?.trim();
  if (legacy) return { range: legacy, source: 'engine.objectstack' };
  return null;
}

/** Leading integer of a version-ish token (`11`, `11.2`, `11.2.3`, `v11`). */
function leadingMajor(token: string): number | null {
  const m = token.trim().replace(/^v/i, '').match(/^(\d+)/);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

/**
 * Decide whether a SemVer-ish range admits `runtimeMajor`.
 *
 * Returns `true`/`false` on a positive determination, or `null` when the range
 * shape is not recognized (caller admits with a warning rather than refusing).
 * Protocol compatibility is major-grained by design, so every supported form
 * reduces to "which majors does this admit".
 */
export function rangeAdmitsMajor(range: string, runtimeMajor: number): boolean | null {
  const r = range.trim();
  if (r === '' ) return null;
  // A real SemVer range is short. Bounding the length here defuses any
  // pathological input before it reaches a regex (a manifest's `engines`
  // string is externally authored, so treat it as untrusted): an overlong
  // string is simply unrecognized (admit-with-warning), never a slow scan.
  if (r.length > 128) return null;
  if (r === '*' || r === 'x' || r === 'latest') return true;

  // Compound comparator range, e.g. ">=11.0.0 <13.0.0" (space- or comma-joined).
  const parts = r.split(/[\s,]+/).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => /^[<>]=?/.test(p))) {
    let ok = true;
    for (const p of parts) {
      const admits = comparatorAdmitsMajor(p, runtimeMajor);
      if (admits === null) return null;
      ok = ok && admits;
    }
    return ok;
  }

  // Hyphen range: "11.0.0 - 12.0.0". Split on the whitespace-delimited hyphen
  // (a fixed anchor between the two `\s+` runs — linear, no `.`-vs-`\s`
  // backtracking) rather than a lazy `(.+?)…(.+)` match.
  const hyphenParts = r.split(/\s+-\s+/);
  if (hyphenParts.length === 2) {
    const lo = leadingMajor(hyphenParts[0]!);
    const hi = leadingMajor(hyphenParts[1]!);
    if (lo === null || hi === null) return null;
    return runtimeMajor >= lo && runtimeMajor <= hi;
  }

  // Single comparator.
  if (/^[<>]=?/.test(r)) return comparatorAdmitsMajor(r, runtimeMajor);

  // Caret: `^N` / `^N.x.y` pins the major (for N >= 1, which all protocol
  // majors are).
  if (r.startsWith('^')) {
    const maj = leadingMajor(r.slice(1));
    return maj === null ? null : runtimeMajor === maj;
  }

  // Tilde: `~N.x.y` also pins the major for the handshake's purposes.
  if (r.startsWith('~')) {
    const maj = leadingMajor(r.slice(1));
    return maj === null ? null : runtimeMajor === maj;
  }

  // `N.x` / `N.*` wildcard.
  const wildcard = r.match(/^(\d+)\.(?:x|\*)/i);
  if (wildcard) return runtimeMajor === Number.parseInt(wildcard[1]!, 10);

  // Bare exact version or bare major: `11`, `11.0.0`.
  const exact = leadingMajor(r);
  if (exact !== null && /^\d+(\.\d+){0,2}$/.test(r)) return runtimeMajor === exact;

  return null;
}

function comparatorAdmitsMajor(comparator: string, runtimeMajor: number): boolean | null {
  // Peel the operator off by fixed prefix rather than a `\s*(.+)` match, whose
  // whitespace/any-char overlap is a polynomial-ReDoS shape on untrusted input.
  let op: string;
  let rest: string;
  if (comparator.startsWith('>=') || comparator.startsWith('<=')) {
    op = comparator.slice(0, 2);
    rest = comparator.slice(2);
  } else if (comparator.startsWith('>') || comparator.startsWith('<')) {
    op = comparator.slice(0, 1);
    rest = comparator.slice(1);
  } else {
    return null;
  }
  const bound = rest.trim().replace(/^v/i, '');
  if (bound === '') return null;
  const parts = bound.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!parts) return null;
  const maj = Number.parseInt(parts[1]!, 10);
  const minor = parts[2] !== undefined ? Number.parseInt(parts[2], 10) : 0;
  const patch = parts[3] !== undefined ? Number.parseInt(parts[3], 10) : 0;
  // A bare major (`11`) desugars in npm semver differently from an explicit
  // floor (`11.0.0`): `>11` means `>=12`, but `>11.0.0` admits `11.0.1`.
  const isBare = parts[2] === undefined && parts[3] === undefined;
  // Whether the bound sits exactly on major `maj`'s first version.
  const atMajorFloor = minor === 0 && patch === 0;

  switch (op) {
    case '>=':
      // `>=maj.*` admits major maj and up.
      return runtimeMajor >= maj;
    case '>':
      // bare `>maj` → `>=maj+1` (excludes maj); `>maj.x.y` still admits maj.
      return isBare ? runtimeMajor > maj : runtimeMajor >= maj;
    case '<=':
      // `<=maj.*` admits major maj and below.
      return runtimeMajor <= maj;
    case '<':
      // `<maj.0.0` (bare or explicit floor) excludes all of major maj;
      // `<maj.5.0` still admits maj.
      return atMajorFloor ? runtimeMajor < maj : runtimeMajor <= maj;
    default:
      return null;
  }
}

/**
 * Run the handshake for a manifest against a runtime protocol version
 * (defaults to this build's `PROTOCOL_VERSION`). Pure — no throwing, no I/O.
 */
export function checkProtocolCompat(
  manifest: ProtocolHandshakeManifest,
  runtimeVersion: string = PROTOCOL_VERSION,
): ProtocolCompatResult {
  const runtimeMajor = leadingMajor(runtimeVersion) ?? 0;
  const declared = resolveDeclaredRange(manifest);

  if (!declared) return { status: 'no-range', runtimeMajor };

  const admits = rangeAdmitsMajor(declared.range, runtimeMajor);
  if (admits === null) {
    return { status: 'unparsed-range', runtimeMajor, requiredRange: declared.range, source: declared.source };
  }
  if (admits) {
    return { status: 'ok', runtimeMajor, requiredRange: declared.range, source: declared.source };
  }

  const packageId = manifest.id ?? '<unknown>';
  const targetMajor = leadingMajor(declared.range.replace(/^[\^~<>=\s]+/, ''));
  const migrateCommand =
    targetMajor !== null
      ? `objectstack migrate meta --from ${targetMajor}`
      : `objectstack migrate meta`;
  const message =
    `package '${packageId}' targets protocol ${declared.range} ` +
    `(${declared.source}) but this runtime is protocol ${runtimeVersion}. ` +
    `This is a major-version break. Run: ${migrateCommand}`;

  return {
    status: 'incompatible',
    runtimeMajor,
    runtimeVersion,
    requiredRange: declared.range,
    source: declared.source,
    diagnostic: {
      code: 'OS_PROTOCOL_INCOMPATIBLE',
      packageId,
      requiredRange: declared.range,
      rangeSource: declared.source,
      runtimeVersion,
      runtimeMajor,
      targetMajor,
      migrateCommand,
      message,
    },
  };
}

/** Warn hook — overridable for tests; defaults to `console.warn`. */
export type WarnFn = (message: string) => void;

/**
 * Enforce the handshake at a load/install boundary.
 *
 * - `ok` → returns silently.
 * - `no-range` → warns once (grandfathering; `objectstack lint` nudges the
 *   package to declare a range, and scaffolds stamp one going forward).
 * - `unparsed-range` → warns (parser-coverage gap; never a false rejection).
 * - `incompatible` → throws {@link ProtocolIncompatibleError}.
 */
export function assertProtocolCompat(
  manifest: ProtocolHandshakeManifest,
  runtimeVersion: string = PROTOCOL_VERSION,
  warn: WarnFn = (m) => console.warn(m),
): void {
  const result = checkProtocolCompat(manifest, runtimeVersion);
  const pkg = manifest.id ?? '<unknown>';
  switch (result.status) {
    case 'ok':
      return;
    case 'no-range':
      warn(
        `[protocol] package '${pkg}' declares no engines.protocol range; ` +
          `loading under protocol ${runtimeVersion} without a compatibility check (ADR-0087).`,
      );
      return;
    case 'unparsed-range':
      warn(
        `[protocol] package '${pkg}' declares an unrecognized ${result.source} range ` +
          `'${result.requiredRange}'; skipping the protocol handshake (ADR-0087).`,
      );
      return;
    case 'incompatible':
      throw new ProtocolIncompatibleError(result.diagnostic);
  }
}
