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
 *
 * ## The dependency check beside it (ADR-0141 D2)
 *
 * The same module hosts the pre-install dependency check: one predicate
 * ({@link checkDeclaredDependencies}) that every install door runs right after
 * {@link assertProtocolCompat}, and the range reader it needs
 * ({@link rangeAdmitsVersion}). The reader is a SIBLING of the handshake's
 * {@link rangeAdmitsMajor}, sharing its alternative split, its length bound and
 * its comparator-operator peel, and differing in the two ways D2 requires: it
 * answers at exact-version granularity, and its caller fails CLOSED on what it
 * cannot read. The handshake's own verdicts do not move. ⛔ No fourth range
 * reader: `parseRangeFloor` and `SemanticVersionManager` are the other two,
 * and neither has both the grammar and the granularity.
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
  /**
   * The declared major the package targets, when a single major is
   * determinable: the range's leading version token, and for a `||` union the
   * lowest of its alternatives', whatever order they are written in.
   */
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
 * The `||` alternatives of a range, each trimmed. A range with no `||` is its
 * own single alternative, so no single-range reading changes through this.
 */
function rangeAlternatives(range: string): string[] {
  return range.split('||').map((alternative) => alternative.trim());
}

/**
 * The longest range either reader reads. A real SemVer range is short, and a
 * manifest's range strings are externally authored, so bounding the length
 * defuses any pathological input before it reaches a split or a regex: an
 * overlong string is simply unrecognized, never a slow scan.
 */
const MAX_RANGE_LENGTH = 128;

/** The intersection separator both readers accept: whitespace or a comma. */
const COMPARATOR_SEPARATOR = /[\s,]+/;

/**
 * A hyphen range's two ends (`'11.0.0 - 12.0.0'`), or `null` when `r` is not
 * one. Split on the whitespace-delimited hyphen (a fixed anchor between the two
 * `\s+` runs — linear, no `.`-vs-`\s` backtracking) rather than a lazy
 * `(.+?)…(.+)` match.
 */
function hyphenRangeEnds(r: string): [string, string] | null {
  const ends = r.split(/\s+-\s+/);
  return ends.length === 2 ? [ends[0]!, ends[1]!] : null;
}

type ComparatorOperator = '>=' | '<=' | '>' | '<';

/**
 * Peel a comparator's operator off by fixed prefix rather than a `\s*(.+)`
 * match, whose whitespace/any-char overlap is a polynomial-ReDoS shape on
 * untrusted input. `null` when `comparator` opens with no comparison operator.
 */
function peelComparatorOperator(comparator: string): { op: ComparatorOperator; rest: string } | null {
  if (comparator.startsWith('>=') || comparator.startsWith('<=')) {
    return { op: comparator.slice(0, 2) as ComparatorOperator, rest: comparator.slice(2) };
  }
  if (comparator.startsWith('>') || comparator.startsWith('<')) {
    return { op: comparator.slice(0, 1) as ComparatorOperator, rest: comparator.slice(1) };
  }
  return null;
}

/**
 * Decide whether a SemVer-ish range admits `runtimeMajor`.
 *
 * Returns `true`/`false` on a positive determination, or `null` when the range
 * shape is not recognized (caller admits with a warning rather than refusing).
 * Protocol compatibility is major-grained by design, so every supported form
 * reduces to "which majors does this admit".
 *
 * A `||` union (`'^17.7.0 || ^18.0.0'`, the spelling a package bridging two
 * protocol majors writes) admits a major when ANY alternative admits it.
 * When none does and any alternative is unrecognized (an empty one included:
 * `'^17 ||'`), the union is unrecognized too and answers `null`, because the
 * alternative this cannot read might be the one that admits. Only a union
 * whose every alternative refuses answers `false`.
 */
export function rangeAdmitsMajor(range: string, runtimeMajor: number): boolean | null {
  const r = range.trim();
  // Bounded before any split or regex ({@link MAX_RANGE_LENGTH}): an overlong
  // string is simply unrecognized (admit-with-warning), never a slow scan.
  if (r.length > MAX_RANGE_LENGTH) return null;
  let verdict: boolean | null = false;
  for (const alternative of rangeAlternatives(r)) {
    const admits = alternativeAdmitsMajor(alternative, runtimeMajor);
    if (admits === true) return true;
    if (admits === null) verdict = null;
  }
  return verdict;
}

/** One `||` alternative: the single-range grammar {@link rangeAdmitsMajor} combines. */
function alternativeAdmitsMajor(r: string, runtimeMajor: number): boolean | null {
  if (r === '') return null;
  if (r === '*' || r === 'x' || r === 'latest') return true;

  // Compound comparator range, e.g. ">=11.0.0 <13.0.0" (space- or comma-joined).
  const parts = r.split(COMPARATOR_SEPARATOR).filter(Boolean);
  if (parts.length > 1 && parts.every((p) => /^[<>]=?/.test(p))) {
    let ok = true;
    for (const p of parts) {
      const admits = comparatorAdmitsMajor(p, runtimeMajor);
      if (admits === null) return null;
      ok = ok && admits;
    }
    return ok;
  }

  // Hyphen range: "11.0.0 - 12.0.0".
  const hyphenParts = hyphenRangeEnds(r);
  if (hyphenParts) {
    const lo = leadingMajor(hyphenParts[0]);
    const hi = leadingMajor(hyphenParts[1]);
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

/**
 * The major a refused range targets: the major of its leading version token,
 * its floor as the upgrade guidance reads it (`'^10'` → 10, `'>=15 <18'` → 15).
 * A `||` union targets its LOWEST alternative's, in whatever order the
 * alternatives are written: `'^16 || ^17'` and `'^17 || ^16'` are one range and
 * get one `migrate meta --from`.
 */
function declaredFloorMajor(range: string): number | null {
  let lowest: number | null = null;
  for (const alternative of rangeAlternatives(range)) {
    const major = leadingMajor(alternative.replace(/^[\^~<>=\s]+/, ''));
    if (major === null) return null;
    if (lowest === null || major < lowest) lowest = major;
  }
  return lowest;
}

function comparatorAdmitsMajor(comparator: string, runtimeMajor: number): boolean | null {
  const peeled = peelComparatorOperator(comparator);
  if (peeled === null) return null;
  const { op, rest } = peeled;
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
  const targetMajor = declaredFloorMajor(declared.range);
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

// ==========================================================================
// ADR-0141 D2 — the range reader at exact-version granularity
// ==========================================================================

/** A full version, `[major, minor, patch]`. */
export type ExactVersion = readonly [number, number, number];

/**
 * The version grammar the dependency check reads for an INSTALLED package:
 * `MAJOR.MINOR.PATCH`, an optional leading `v`, an optional `+build` suffix
 * (ignored, as SemVer orders it). `null` for anything else — a partial
 * version (`6`, `6.1`), a prerelease (`6.1.0-beta.1`: outside the stated
 * grammar, so the check fails closed on it), a non-string.
 */
export function readExactVersion(version: unknown): ExactVersion | null {
  if (typeof version !== 'string' || version.length > MAX_RANGE_LENGTH) return null;
  const m = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:\+[0-9A-Za-z.-]+)?$/);
  if (!m) return null;
  return [Number.parseInt(m[1]!, 10), Number.parseInt(m[2]!, 10), Number.parseInt(m[3]!, 10)];
}

/**
 * The range grammar {@link rangeAdmitsVersion} reads, as a refusal states it.
 * The handshake family's grammar minus `latest` (a dist-tag, not a bound), at
 * npm's exact-version semantics.
 */
export const DEPENDENCY_RANGE_GRAMMAR =
  '`^`, `~`, `>=`, `>`, `<=`, `<` or `=` before a version; an exact version (`6.1.0`); '
  + 'an `x` / `*` wildcard (`6.x`, `6.1.*`, `*`); a hyphen range (`6.1.0 - 6.3`); '
  + 'comparators joined by a space or a comma (an intersection: `>=6.1.0 <7`); and `||` between alternatives';

/** A version token as written: up to three numeric parts, stopping at the first `x` / `X` / `*`. */
function readPartialVersion(token: string): number[] | null {
  const m = token.match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/);
  if (!m) return null;
  const parts: number[] = [];
  for (const part of [m[1], m[2], m[3]]) {
    if (part === undefined || !/^\d+$/.test(part)) break;
    parts.push(Number.parseInt(part, 10));
  }
  return parts;
}

/** `parts` padded with zeros to a full version. */
function floorOf(parts: readonly number[]): ExactVersion {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** The first version past every version `parts` names (`6` → `7.0.0`, `6.1` → `6.2.0`). */
function ceilingOf(parts: readonly number[]): ExactVersion {
  return parts.length === 1 ? [parts[0]! + 1, 0, 0] : [parts[0]!, parts[1]! + 1, 0];
}

function compareVersions(a: ExactVersion, b: ExactVersion): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

/** One bound of a desugared comparator; a comparator is the AND of its bounds. */
interface VersionBound { op: ComparatorOperator; v: ExactVersion }

/** A bound nothing satisfies — `>*`, `<*`, `<0.0.0`. */
const NOTHING: VersionBound = { op: '<', v: [0, 0, 0] };

/**
 * One comparator of an intersection, desugared to bounds the way npm does
 * (`^1.2` → `>=1.2.0 <2.0.0`, `>6` → `>=7.0.0`, `<=6.1` → `<6.2.0`). `null`
 * when the token is outside {@link DEPENDENCY_RANGE_GRAMMAR}; an empty list
 * admits every version.
 */
function comparatorBounds(token: string): VersionBound[] | null {
  const peeled = peelComparatorOperator(token);
  let op: ComparatorOperator | '=' | '^' | '~' | '' = '';
  let rest = token;
  if (peeled) {
    ({ op, rest } = peeled);
  } else if (token.startsWith('=') || token.startsWith('^') || token.startsWith('~')) {
    op = token[0] as '=' | '^' | '~';
    rest = token.slice(1);
  }
  const parts = readPartialVersion(rest.replace(/^v/i, ''));
  if (parts === null) return null;
  const full = parts.length === 3;
  const any = parts.length === 0;
  const floor = floorOf(parts);
  switch (op) {
    case '':
    case '=':
      if (full) return [{ op: '>=', v: floor }, { op: '<=', v: floor }];
      return any ? [] : [{ op: '>=', v: floor }, { op: '<', v: ceilingOf(parts) }];
    case '>=':
      return any ? [] : [{ op: '>=', v: floor }];
    case '>':
      if (any) return [NOTHING];
      return full ? [{ op: '>', v: floor }] : [{ op: '>=', v: ceilingOf(parts) }];
    case '<=':
      if (any) return [];
      return full ? [{ op: '<=', v: floor }] : [{ op: '<', v: ceilingOf(parts) }];
    case '<':
      return any ? [NOTHING] : [{ op: '<', v: floor }];
    case '~':
      if (any) return [];
      return [{ op: '>=', v: floor }, { op: '<', v: ceilingOf(parts.slice(0, Math.min(parts.length, 2))) }];
    case '^': {
      if (any) return [];
      // The first non-zero part is the one that may not move; a part left
      // unwritten counts as the one that moves (`^0.x` → `<1.0.0`).
      const upper: ExactVersion = parts[0]! > 0 || parts.length === 1
        ? [parts[0]! + 1, 0, 0]
        : parts[1]! > 0 || parts.length === 2
          ? [0, parts[1]! + 1, 0]
          : [0, 0, parts[2]! + 1];
      return [{ op: '>=', v: floor }, { op: '<', v: upper }];
    }
  }
}

function boundAdmits(bound: VersionBound, version: ExactVersion): boolean {
  const c = compareVersions(version, bound.v);
  switch (bound.op) {
    case '>=': return c >= 0;
    case '>': return c > 0;
    case '<=': return c <= 0;
    case '<': return c < 0;
  }
}

/** One `||` alternative at exact-version granularity: the AND of its comparators' bounds. */
function alternativeAdmitsVersion(r: string, version: ExactVersion): boolean | null {
  if (r === '') return null;
  // An operator separated from its version by spaces (`>= 6.1.0`) reads as
  // one token. The class is a fixed literal set, so the replace is linear.
  const joined = r.replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
  let bounds: VersionBound[] = [];
  const hyphen = hyphenRangeEnds(joined);
  if (hyphen) {
    const lo = readPartialVersion(hyphen[0].replace(/^v/i, ''));
    const hi = readPartialVersion(hyphen[1].replace(/^v/i, ''));
    if (lo === null || hi === null) return null;
    if (lo.length > 0) bounds.push({ op: '>=', v: floorOf(lo) });
    if (hi.length === 3) bounds.push({ op: '<=', v: floorOf(hi) });
    else if (hi.length > 0) bounds.push({ op: '<', v: ceilingOf(hi) });
  } else {
    for (const token of joined.split(COMPARATOR_SEPARATOR).filter(Boolean)) {
      const tokenBounds = comparatorBounds(token);
      if (tokenBounds === null) return null;
      bounds = bounds.concat(tokenBounds);
    }
  }
  return bounds.every((bound) => boundAdmits(bound, version));
}

/**
 * Decide whether a range admits one exact version — the reader ADR-0141 D2's
 * dependency check needs, a sibling of {@link rangeAdmitsMajor}.
 *
 * Returns `true` / `false` on a positive determination, or `null` when the
 * range is outside {@link DEPENDENCY_RANGE_GRAMMAR} or `version` is outside
 * {@link readExactVersion}'s grammar. A `||` union admits when ANY alternative
 * admits; when none does and any alternative is unreadable, the union is
 * unreadable too (`null`), exactly as {@link rangeAdmitsMajor} combines them.
 *
 * ⛔ The handshake reads `null` as "admit with a warning"; the dependency check
 * reads it as "not satisfied". Each caller owns that policy, so the two
 * readers can share their parsing without sharing a verdict.
 */
export function rangeAdmitsVersion(range: string, version: string): boolean | null {
  const exact = readExactVersion(version);
  if (exact === null) return null;
  const r = range.trim();
  if (r.length > MAX_RANGE_LENGTH) return null;
  let verdict: boolean | null = false;
  for (const alternative of rangeAlternatives(r)) {
    const admits = alternativeAdmitsVersion(alternative, exact);
    if (admits === true) return true;
    if (admits === null) verdict = null;
  }
  return verdict;
}

// ==========================================================================
// ADR-0141 D2 — the pre-install dependency check
// ==========================================================================

/** The manifest slice the dependency check reads. */
export interface DependencyDeclaringManifest {
  id?: unknown;
  name?: unknown;
  /** `ManifestSchema.dependencies`: `{ [packageId]: versionRange }`. */
  dependencies?: unknown;
}

/** What the check needs of an installed package: the registry row's manifest version. */
export interface InstalledDependencyRecord {
  manifest?: { version?: unknown };
}

/** One declared entry the check found unsatisfied, as the refusal carries it. */
export type UnmetDependency =
  | {
      /** The delivered package that declares the entry. */
      packageId: string;
      /** The declared dependency id. */
      dependency: string;
      /** The declared range, as written. */
      range: string;
      /**
       * `absent` — not installed and not delivered by the same act;
       * `out-of-range` — installed at `installedVersion`, outside `range`;
       * `unreadable-range` — `range` is outside {@link DEPENDENCY_RANGE_GRAMMAR};
       * `unreadable-version` — installed at a version outside {@link readExactVersion}'s grammar.
       */
      found: 'absent' | 'out-of-range' | 'unreadable-range' | 'unreadable-version';
      /** The installed version, as stored, when there is an installed record. */
      installedVersion?: string;
    }
  | {
      packageId: string;
      /** `dependencies` is present but is not a `{ packageId: versionRange }` record. */
      found: 'unreadable-declaration';
    };

/** What one install act hands {@link checkDeclaredDependencies}. */
export interface DeclaredDependencyCheck {
  /**
   * The packages this act installs, each judged on its OWN entries (never a
   * dependency's: those were judged when it was installed). One manifest for a
   * single-package door; every package of an artifact for an artifact door.
   */
  delivered: readonly DependencyDeclaringManifest[];
  /** The installed package record for an id (`SchemaRegistry.getPackage`), or `undefined`. */
  getInstalled: (id: string) => InstalledDependencyRecord | undefined;
}

/** The id a delivered manifest is installed under — `id || name`, as the registry keys it. */
function deliveredId(manifest: DependencyDeclaringManifest): string | undefined {
  const id = manifest.id || manifest.name;
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/**
 * ADR-0141 D2's one predicate: every declared entry of the delivered packages
 * that the environment does not satisfy, in declaration order — empty when the
 * install may proceed.
 *
 * An entry `(id, range)` is satisfied when `id` is delivered by the same act
 * (presence only: the packages of one artifact are one tested unit, and an
 * in-artifact range mismatch is the author tooling's to report, not the
 * install's), or when `id` is installed at a `manifest.version` inside `range`.
 * Fail closed: an unreadable range or installed version does not satisfy, and
 * a `dependencies` that is present but not a record is reported, never read as
 * "no dependencies". Every record entry is required; the record has no
 * optional arm. Enablement is not judged.
 *
 * Pure: no throwing, no I/O. Doors call {@link assertDeclaredDependencies}.
 */
export function checkDeclaredDependencies(check: DeclaredDependencyCheck): UnmetDependency[] {
  // Packages only: an artifact wrapper's own id names no package unless one of
  // `delivered` carries it, and a module declaring it would pass here and be
  // `absent` on its first standalone install.
  const delivered = new Set<string>();
  for (const manifest of check.delivered) {
    const id = deliveredId(manifest);
    if (id !== undefined) delivered.add(id);
  }
  const unmet: UnmetDependency[] = [];
  for (const manifest of check.delivered) {
    const declared = manifest.dependencies;
    if (declared === undefined || declared === null) continue;
    const packageId = deliveredId(manifest) ?? '<unknown>';
    if (typeof declared !== 'object' || Array.isArray(declared)) {
      unmet.push({ packageId, found: 'unreadable-declaration' });
      continue;
    }
    for (const [dependency, declaredRange] of Object.entries(declared as Record<string, unknown>)) {
      if (delivered.has(dependency)) continue;
      const range = typeof declaredRange === 'string' ? declaredRange : String(declaredRange);
      const record = check.getInstalled(dependency);
      const stored = record?.manifest?.version;
      const installedVersion = record === undefined || stored === undefined || stored === null
        ? undefined
        : String(stored);
      const withVersion = installedVersion === undefined ? {} : { installedVersion };
      // Range first: an unreadable range cannot be satisfied by installing
      // anything, so it is the fact the author acts on, present or not.
      const rangeReadable = typeof declaredRange === 'string'
        && rangeAdmitsVersion(declaredRange, '0.0.0') !== null;
      if (!rangeReadable) {
        unmet.push({ packageId, dependency, range, found: 'unreadable-range', ...withVersion });
        continue;
      }
      if (record === undefined) {
        unmet.push({ packageId, dependency, range, found: 'absent' });
        continue;
      }
      const admits = typeof stored === 'string' ? rangeAdmitsVersion(range, stored) : null;
      if (admits === null) {
        // Undecided. The `0.0.0` probe above only shows SOME alternative reads:
        // a union whose readable alternatives refuse a readable version and
        // whose other alternative cannot be read (`<5 || latest` against
        // 7.0.0) is undecided because of the range, and naming the version
        // would send the author to fix the wrong side.
        const versionReadable = typeof stored === 'string' && readExactVersion(stored) !== null;
        unmet.push({ packageId, dependency, range, found: versionReadable ? 'unreadable-range' : 'unreadable-version', ...withVersion });
      } else if (!admits) {
        unmet.push({ packageId, dependency, range, found: 'out-of-range', ...withVersion });
      }
    }
  }
  return unmet;
}

/** One `AppCompatibilityCheck` issue (`@objectstack/spec/system`) — the shape the refusal carries per unmet entry. */
export interface DependencyMissingIssue {
  severity: 'error';
  category: 'dependency_missing';
  message: string;
}

function unmetIssueMessage(entry: UnmetDependency): string {
  if (entry.found === 'unreadable-declaration') {
    return `Package '${entry.packageId}' declares \`dependencies\` in a shape that is not a `
      + '{ "PACKAGE_ID": "VERSION_RANGE" } record, so what it depends on cannot be read.';
  }
  const head = `Package '${entry.packageId}' depends on '${entry.dependency}' ${entry.range}`;
  switch (entry.found) {
    case 'absent':
      return `${head}, which is not installed. Install '${entry.dependency}' at a version inside ${entry.range} first.`;
    case 'out-of-range':
      return `${head}, which is installed at version ${entry.installedVersion}, outside that range. `
        + `Install a version of '${entry.dependency}' inside ${entry.range} first.`;
    case 'unreadable-range':
      return `Package '${entry.packageId}' depends on '${entry.dependency}' with the range '${entry.range}', `
        + `which is not a readable version range, so no installed version can satisfy it. Supported: ${DEPENDENCY_RANGE_GRAMMAR}.`;
    case 'unreadable-version':
      return `${head}, which is installed with ${entry.installedVersion === undefined ? 'no version' : `the version '${entry.installedVersion}'`}`
        + ' — not a readable MAJOR.MINOR.PATCH version (a prerelease is outside the grammar), so it cannot be judged against the range.';
  }
}

/**
 * Brand for {@link DependencyMissingError}; `Symbol.for`, for the reason
 * {@link PROTOCOL_INCOMPATIBLE_BRAND} gives.
 */
const DEPENDENCY_MISSING_BRAND = Symbol.for('objectstack.metadata-core.dependencyMissingError');

/**
 * ADR-0141 D2's refusal: an install whose delivered packages declare
 * dependencies the environment does not satisfy. Nothing was registered,
 * written or persisted.
 *
 * ## The status it declares: 422
 *
 * The status the sibling refusals at the same gate answer for a delivered
 * manifest judged against the environment ahead of registration
 * (`NAMESPACE_CONFLICT`, `DUPLICATE_ARTIFACT_OBJECT_NAME`); ADR-0141 merge
 * question 5. `code` is redeclared as a literal so
 * `check:error-status-conformance` derives this class as the producer of
 * `DEPENDENCY_MISSING` at 422, and both status spellings are declared because
 * doors read either one.
 *
 * ## What it carries
 *
 * `issues` — one `AppCompatibilityCheck` issue per unmet entry, the shape
 * `AppCompatibilityCheckSchema` reserves the `dependency_missing` category in.
 * The shared resolver (`resolveThrownHttpError`) passes a thrown `.issues`
 * through into `error.details`, so any door answers them. `unmet` — the facts
 * per entry (the dependent, the dependency, the range, what was found), which
 * the resolver's closed `details` list drops; a door that recognises the error
 * ({@link isDependencyMissingError}) answers them through
 * {@link dependencyMissingAnswer}, and a Console renders its text from them.
 */
export class DependencyMissingError extends MetadataError {
  readonly code = 'DEPENDENCY_MISSING' as const;
  readonly status = 422;
  readonly statusCode = 422;
  readonly issues: readonly DependencyMissingIssue[];

  constructor(public readonly unmet: readonly UnmetDependency[]) {
    const issues = unmet.map((entry): DependencyMissingIssue => ({
      severity: 'error',
      category: 'dependency_missing',
      message: unmetIssueMessage(entry),
    }));
    super(
      'DEPENDENCY_MISSING',
      `Install refused: ${unmet.length === 1 ? 'a declared dependency is' : `${unmet.length} declared dependencies are`} `
        + `not satisfied in this environment, and nothing was installed. ${issues.map((i) => i.message).join(' ')}`
        + ' A package installs only after every package its manifest declares in `dependencies` is installed'
        + ' at a version inside the declared range (ADR-0141 D2).',
    );
    this.issues = issues;
    (this as Record<PropertyKey, unknown>)[DEPENDENCY_MISSING_BRAND] = true;
  }
}

/** Recognition predicate for {@link DependencyMissingError}, by brand — a lookalike is not recognised. */
export function isDependencyMissingError(e: unknown): e is DependencyMissingError {
  return typeof e === 'object' && e !== null
    && (e as Record<PropertyKey, unknown>)[DEPENDENCY_MISSING_BRAND] === true;
}

/**
 * Run ADR-0141 D2's check at an install door: returns silently when every
 * declared entry is satisfied, throws {@link DependencyMissingError} naming
 * EVERY unmet entry otherwise. Doors call it right after
 * {@link assertProtocolCompat}, before anything registers.
 */
export function assertDeclaredDependencies(check: DeclaredDependencyCheck): void {
  const unmet = checkDeclaredDependencies(check);
  if (unmet.length > 0) throw new DependencyMissingError(unmet);
}

/** What an HTTP door answers for a {@link DependencyMissingError}. */
export interface DependencyMissingAnswer {
  status: DependencyMissingError['status'];
  code: DependencyMissingError['code'];
  /** The error's own prose, unchanged. */
  message: string;
  /**
   * A CLOSED shape: the `AppCompatibilityCheck` verdict (`compatible` and its
   * `issues`) and the per-entry facts, named one by one — ⛔ not a spread of
   * the error, so a member later added to it does not reach the wire without
   * a decision here.
   */
  details: {
    compatible: false;
    issues: readonly DependencyMissingIssue[];
    unmet: readonly UnmetDependency[];
  };
}

/**
 * The ONE answer every HTTP install door gives ADR-0141 D2's refusal: a door
 * asks {@link isDependencyMissingError} ahead of its generic catch, then
 * answers through this. ⛔ No door restates the shape.
 */
export function dependencyMissingAnswer(err: DependencyMissingError): DependencyMissingAnswer {
  return {
    status: err.status,
    code: err.code,
    message: err.message,
    details: { compatible: false, issues: err.issues, unmet: err.unmet },
  };
}
