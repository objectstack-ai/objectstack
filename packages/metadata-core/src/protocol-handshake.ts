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
      protocolVersion: string;
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
  /**
   * The protocol version the manifest was judged against -- `PROTOCOL_VERSION`,
   * the protocol major padded to a semver ('17.0.0'), never the installed
   * package version of the runtime. It was spelled `runtimeVersion` until this
   * release, where a machine consumer read it as a package version with no
   * prose to disambiguate; the prose in `message` was always unambiguous, the
   * machine field was not.
   */
  protocolVersion: string;
  runtimeMajor: number;
  /** The declared major the package targets, when a single major is determinable. */
  targetMajor: number | null;
  /** The command that resolves the refusal (wired end-to-end by ADR-0087 P2). */
  migrateCommand: string;
  message: string;
}

/**
 * Brand for {@link ProtocolIncompatibleError}. It uses `Symbol.for`, so
 * recognition keeps working when two module instances of this package coexist
 * (the ESM and CJS builds, or `src` beside `dist`), where an `instanceof` would
 * silently answer false. The runtime's `FlowActionRefusal` uses the same idiom.
 */
const PROTOCOL_INCOMPATIBLE_BRAND = Symbol.for('objectstack.metadata-core.protocolIncompatibleError');

/**
 * Structured error thrown at the install/load boundary for an incompatible
 * package. Extends `MetadataError` so callers can `instanceof` across package
 * boundaries and read `.code`; `.diagnostic` carries the JSON-serializable
 * detail for `--json` output and the MCP surface (ADR-0087 D4).
 *
 * ## The status it declares: 422 (#21727)
 *
 * The manifest is well-formed, but it declares a range this runtime can never
 * satisfy, and the remedy is to change the body
 * (`objectstack migrate meta --from N`). That is 422, the status
 * {@link SchemaValidationError} maps to in this same package. It is NOT 409:
 * the error-code ledger keeps 409 for refusals that come from environment
 * state, where resubmitting the same body could succeed later. With no
 * declared status, every HTTP door answered the 500 fallback for a manifest
 * the caller wrote. Both spellings are declared because doors read either one
 * (`resolveThrownHttpError` reads `status`, then `statusCode`).
 *
 * `code` is redeclared as a literal, always equal to `diagnostic.code`, so that
 * `check:error-status-conformance` derives this class as a producer of
 * `OS_PROTOCOL_INCOMPATIBLE` at 422. A code that arrives only through `super()`
 * is invisible to that gate.
 *
 * ## The structured diagnostic on the wire
 *
 * The shared resolver (`resolveThrownHttpError` in `@objectstack/types`)
 * builds `details` from a closed list that deliberately drops a thrown
 * `.diagnostic` (#8016, #9106, #9585). So each HTTP door that reaches this
 * throw recognises the error with {@link isProtocolIncompatibleError} ahead of
 * its generic catch and answers through {@link protocolIncompatibleAnswer}: the
 * declared status, with the diagnostic's five fields in `error.details`. Two
 * doors do today, the install branch of `POST /api/v1/packages` and
 * `POST /api/v1/marketplace/install-local` (#21762). A caller that does not
 * recognise the error still answers the right status, without `details`.
 */
export class ProtocolIncompatibleError extends MetadataError {
  readonly code = 'OS_PROTOCOL_INCOMPATIBLE' as const;
  readonly status = 422;
  readonly statusCode = 422;

  constructor(public readonly diagnostic: ProtocolIncompatibleDiagnostic) {
    super(diagnostic.code, diagnostic.message);
    (this as Record<PropertyKey, unknown>)[PROTOCOL_INCOMPATIBLE_BRAND] = true;
  }
}

/**
 * Recognition predicate for {@link ProtocolIncompatibleError}. A door asks it
 * BEFORE its generic catch. It checks the brand rather than `instanceof` (see
 * {@link PROTOCOL_INCOMPATIBLE_BRAND}). A foreign object that merely copies the
 * field names is not recognised, so no thrower can impersonate the protocol
 * refusal's structured channel with a lookalike.
 */
export function isProtocolIncompatibleError(e: unknown): e is ProtocolIncompatibleError {
  return typeof e === 'object' && e !== null
    && (e as Record<PropertyKey, unknown>)[PROTOCOL_INCOMPATIBLE_BRAND] === true;
}

/**
 * What an HTTP door answers for a {@link ProtocolIncompatibleError}: the status,
 * the code and the message the error declares, and the structured diagnostic
 * for `error.details`. Each door wraps it in its own envelope.
 */
export interface ProtocolIncompatibleAnswer {
  status: ProtocolIncompatibleError['status'];
  code: ProtocolIncompatibleError['code'];
  /** The error's own prose, unchanged. Its `Run:` command is `details.migrateCommand`. */
  message: string;
  details: Pick<
    ProtocolIncompatibleDiagnostic,
    'requiredRange' | 'rangeSource' | 'protocolVersion' | 'targetMajor' | 'migrateCommand'
  >;
}

/**
 * The ONE answer every HTTP door gives ADR-0087 D1's protocol refusal (#21727,
 * #21762). A door asks {@link isProtocolIncompatibleError} ahead of its generic
 * catch, then answers through this. ⛔ No door restates the shape: two package
 * install doors reach the throw, and a second copy is where they drift.
 *
 * ADR-0087 D1 promises a refusal whose diagnostic "the consumer that must act
 * on this refusal" can read, and that consumer is an agent. Served through the
 * shared resolver instead, the five fields survive only inside the prose.
 *
 * `details` is a CLOSED shape: exactly these five members of
 * {@link ProtocolIncompatibleDiagnostic}, named one by one. ⛔ It is not a
 * spread of the diagnostic. `packageId` and `runtimeMajor` stay out (the first
 * is the id the caller sent, the second is derivable from `protocolVersion`),
 * `code` is the answer's own member (an envelope puts it in `error.code`, never
 * in `error.details.code`, ADR-0112 D5), and a member later added to the
 * diagnostic does not reach the wire without a decision here.
 *
 * The message is the error's own prose: the CLI and people read it.
 */
export function protocolIncompatibleAnswer(err: ProtocolIncompatibleError): ProtocolIncompatibleAnswer {
  const d = err.diagnostic;
  return {
    status: err.status,
    code: err.code,
    message: err.message,
    details: {
      requiredRange: d.requiredRange,
      rangeSource: d.rangeSource,
      protocolVersion: d.protocolVersion,
      targetMajor: d.targetMajor,
      migrateCommand: d.migrateCommand,
    },
  };
}

/**
 * First declared range, protocol-first (ADR-0025 §3.10 #3).
 *
 * Exported (#12772) so the artifact forward-conversion policy reads the
 * declared range from the same source priority as the handshake — two readers
 * of `engines.protocol` with two priority orders would be the "two opinions"
 * defect, one layer down.
 */
export function resolveDeclaredRange(
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
  protocolVersion: string = PROTOCOL_VERSION,
): ProtocolCompatResult {
  const runtimeMajor = leadingMajor(protocolVersion) ?? 0;
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
    `(${declared.source}) but this runtime is protocol ${protocolVersion}. ` +
    `This is a major-version break. Run: ${migrateCommand}`;

  return {
    status: 'incompatible',
    runtimeMajor,
    protocolVersion,
    requiredRange: declared.range,
    source: declared.source,
    diagnostic: {
      code: 'OS_PROTOCOL_INCOMPATIBLE',
      packageId,
      requiredRange: declared.range,
      rangeSource: declared.source,
      protocolVersion,
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
  protocolVersion: string = PROTOCOL_VERSION,
  warn: WarnFn = (m) => console.warn(m),
): void {
  const result = checkProtocolCompat(manifest, protocolVersion);
  const pkg = manifest.id ?? '<unknown>';
  switch (result.status) {
    case 'ok':
      return;
    case 'no-range':
      warn(
        `[protocol] package '${pkg}' declares no engines.protocol range; ` +
          `loading under protocol ${protocolVersion} without a compatibility check (ADR-0087).`,
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
