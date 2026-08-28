// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Versioned forward conversion for compiled artifacts (#12772; ADR-0087 D2).
 *
 * ## The gap this closes
 *
 * A compiled artifact (`objectstack build` → `dist/objectstack.json`) is
 * **data at rest with a version stamp**: its manifest declares the protocol
 * range it was authored against (`engines.protocol`, ADR-0025 §3.2), and the
 * bytes then sit unchanged while the platform moves on. When a spec release
 * retires an authorable key *inside* a protocol line (an ADR-0049
 * enforce-or-remove narrowing riding a minor release), every already-built
 * artifact that carries the key becomes unbootable the moment a runtime
 * crosses that minor — the strict parse at the artifact-ingestion door fires
 * the `retiredKey()` tombstone, and `os migrate meta` cannot help because it
 * targets *sources*, not built artifacts. Measured on a real deployment: an
 * artifact built by released 17.1.0 tooling (which injected the then-legal
 * `allowRestore`/`allowPurge` permission bits) was refused by the 17.2.0
 * runtime with no operator remedy short of hand-editing the JSON.
 *
 * The stored-row read path already solves the same problem for `sys_metadata`
 * rows: every rehydration seam replays the full ADR-0087 conversion chain —
 * retired entries included — via `applyConversionsToStoredItem`, because a row
 * at rest has no author for a tombstone to teach. This module extends that
 * policy to artifacts, with the one refinement an artifact affords and a row
 * does not: **the artifact says what surface it was authored against**, so the
 * replay is *versioned* rather than unconditional.
 *
 * ## The policy
 *
 * Let `floor` be the lowest version the artifact's declared protocol range
 * admits (the leading version token of `engines.protocol`), and `runtime` the
 * `@objectstack/spec` version this process actually runs.
 *
 * - **`floor < runtime`** → the artifact predates this runtime's authoring
 *   surface. Replay the full conversion chain (retired entries included)
 *   before the strict parse — the artifact is the "consumer arriving late"
 *   ADR-0087 D3 keeps every conversion around for.
 * - **`floor >= runtime`** → the artifact claims the current (or a newer)
 *   surface. Nothing is replayed; the strict parse — tombstones included —
 *   is the authority. This is what keeps the conversion **versioned rather
 *   than a blanket amnesty**: a key retired at version V stays a loud refusal
 *   for anything authored at ≥ V, and when a retired key later returns to the
 *   spec (the roadmap-M2 shape: `allowRestore`/`allowPurge` come back with the
 *   lifecycle operations they gate), artifacts authored against that surface
 *   are never stripped by history.
 * - **No declared range** → replay the full chain. Same posture as the
 *   protocol handshake (which grandfathers range-less packages with a warning,
 *   ADR-0087 "never false-reject") and as the stored-row pass (whose rows
 *   carry no version at all): an artifact of unknown age is treated as old
 *   data at rest, and conversions only rewrite shapes they positively
 *   recognize, so a genuinely-current artifact loses nothing.
 * - **`runtime` unresolvable** → nothing is replayed. Amnesty rests on
 *   positive version evidence; without a runtime version to compare against,
 *   the strict parse stays the authority (the refusal still carries the
 *   tombstone's prescription). Unreachable in practice — `@objectstack/spec`
 *   is a hard dependency — and injectable for tests either way.
 *
 * The comparison uses the full `x.y.z`, not the major: within-line
 * retirements (17.1 → 17.2) are exactly the case that created this module.
 * Cross-major gaps are the protocol *handshake*'s jurisdiction
 * (`checkProtocolCompat`) and refuse before conversion could matter.
 *
 * ## What this deliberately is NOT
 *
 * - Not a second conversion table: the ADR-0087 registry in
 *   `@objectstack/spec` stays the single authority on *what* converts; this
 *   module only decides *whether the retired window opens* for one artifact.
 * - Not a validator: like `applyConversions` itself, this never throws and
 *   never gates. Gating stays at the caller's schema parse.
 * - Not the flow-specific seam: flows convert here too (context-less, exactly
 *   like the `defineStack` build seam — the open-namespace conflict guard
 *   needs a live executor registry no ingestion door has), and
 *   `AutomationEngine.registerFlow` re-canonicalizes with the guard where the
 *   registry exists. Conversions are idempotent by construction, so the seams
 *   stack safely.
 */

import { createRequire } from 'node:module';
// ⚠ VALUE import only, and deliberately no `type` import beside it: this module
// must keep the `@objectstack/spec` ROOT entry out of this package's PUBLIC
// declaration surface. When an exported signature here referenced a root spec
// type, the emitted `dist/index.d.ts` gained `import ... from '@objectstack/spec'`,
// and every DOWNSTREAM type program reading this package's declarations began
// loading the ~2MB spec root d.mts BESIDE the d.ts flavor it already read —
// the whole spec surface instantiated twice. Measured cost: the TEST_DEBT
// re-measure of `packages/qa/http-conformance` (671-file program) crossed CI's
// ~4GB tsc heap ceiling and OOM'd, red on a PR whose diff never touched that
// package (#12772 patch round; `--listFiles` diff: the only additions were
// `spec/dist/index.d.mts` + its chunk). The runtime import below is invisible
// to declaration emit once no exported type references the root — the public
// surface speaks {@link ArtifactConversionNotice}, a structural mirror pinned
// against the real thing in this module's test.
import { applyConversions } from '@objectstack/spec';
import { resolveDeclaredRange, type ProtocolHandshakeManifest } from './protocol-handshake.js';

/**
 * Structural mirror of `ConversionNotice` (`@objectstack/spec`,
 * `src/conversions/types.ts`) — field-for-field, including the literal `code`.
 *
 * A mirror rather than a re-export, for the declaration-surface reason on the
 * import above; its exactness is pinned BOTH assignability directions in
 * `artifact-forward-conversion.test.ts`, so a drift in either declaration
 * fails the suite rather than silently forking the contract.
 */
export interface ArtifactConversionNotice {
  code: 'OS_METADATA_CONVERTED';
  /** The conversion id that fired (`MetadataConversion.id`). */
  conversionId: string;
  /** Dotted surface the conversion governs, e.g. `flow.node.type`. */
  surface: string;
  /** The protocol major that introduced the canonical shape. */
  toMajor: number;
  /** The protocol major in which this conversion retires from the load path. */
  retiresIn: number;
  /** The off-spec token/shape actually seen in the source. */
  from: string;
  /** The canonical token/shape it was converted to. */
  to: string;
  /** Where in the stack it applied, e.g. `permissions[0].objects.crm_ticket.allowPurge`. */
  path: string;
  /** Derived, human-facing one-liner. */
  message: string;
}

/** Why the retired conversion window did or did not open for an artifact. */
export type ArtifactForwardConversionVerdict =
  /** Declared floor predates the runtime spec — full chain replayed. */
  | 'converted-forward'
  /** No declared range — treated as old data at rest, full chain replayed. */
  | 'converted-undeclared'
  /** Declared floor is current-or-newer — nothing replayed, the strict parse decides. */
  | 'authored-current'
  /** Runtime spec version unresolvable — nothing replayed (see module doc). */
  | 'runtime-version-unknown'
  /** Input is not an object — nothing to do. */
  | 'not-an-object';

export interface ArtifactForwardConversionOptions {
  /**
   * Sink for each structured notice the replay emits. Same contract as
   * `applyConversions`: converting is the point; *surfacing* is the caller's
   * choice (the ingestion door logs them operator-visibly, deduped).
   */
  onNotice?: (notice: ArtifactConversionNotice) => void;
  /**
   * The `@objectstack/spec` version this runtime executes. Injectable for
   * tests; defaults to the installed spec package's own version. `null`
   * means "could not resolve" and closes the retired window.
   */
  runtimeSpecVersion?: string | null;
}

export interface ArtifactForwardConversionResult<T> {
  /**
   * The definition with the conversion outcome applied. Copy-on-write: the
   * original reference comes back untouched when nothing converted.
   */
  definition: T;
  verdict: ArtifactForwardConversionVerdict;
  /** The declared range's floor as `x.y.z`, when one was declared and parsed. */
  authoredFloor: string | null;
  /** The runtime spec version the floor was compared against. */
  runtimeSpecVersion: string | null;
  /** Every notice the replay emitted (empty when nothing converted). */
  notices: ArtifactConversionNotice[];
}

/**
 * Lowest version a conventional artifact range admits, as `[major, minor,
 * patch]` — the leading version token of the range (`^17.1.0` → 17.1.0,
 * `>=17.1 <18` → 17.1.0, `^17` → 17.0.0).
 *
 * Deliberately the same "leading token" school as the handshake's
 * `rangeAdmitsMajor` rather than a full semver engine: every range the
 * tooling stamps or the docs teach leads with its floor. A range this cannot
 * read returns `null`, and the caller treats an unreadable floor like an
 * undeclared one — the never-false-reject direction.
 */
export function parseRangeFloor(range: string): [number, number, number] | null {
  const r = range.trim();
  if (r === '' || r.length > 128) return null;
  // Strip a leading range operator (`^`, `~`, `>=`, `>`, `=`, `v`).
  const m = r.match(/^[\^~>=<\s]*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  const major = Number.parseInt(m[1]!, 10);
  const minor = m[2] !== undefined ? Number.parseInt(m[2], 10) : 0;
  const patch = m[3] !== undefined ? Number.parseInt(m[3], 10) : 0;
  if (!Number.isFinite(major)) return null;
  return [major, minor, patch];
}

/** Parse a concrete `x.y.z` version (prerelease/build suffixes tolerated). */
function parseVersion(version: string): [number, number, number] | null {
  const m = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number.parseInt(m[1]!, 10), Number.parseInt(m[2]!, 10), Number.parseInt(m[3]!, 10)];
}

function compareTriples(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
  }
  return 0;
}

/**
 * Resolve the installed `@objectstack/spec` version, from either module
 * system this dual-build package ships as. Returns `null` when unresolvable
 * (which closes the retired window — see the module doc's failure posture).
 */
export function resolveInstalledSpecVersion(): string | null {
  // CJS build: the ambient `require` resolves from this package's own
  // dependency chain — the right anchor for a published install.
  try {
    if (typeof require === 'function') {
      const pkg = require('@objectstack/spec/package.json') as { version?: string };
      if (typeof pkg?.version === 'string') return pkg.version;
    }
  } catch {
    // fall through to the ESM anchor
  }
  // ESM build: anchor a require at this module's own URL. In the CJS build
  // this branch is only reachable when the branch above already failed, and
  // its transformed `import.meta.url` is `undefined` there — `createRequire`
  // then throws and the catch below answers `null`, the documented posture.
  try {
    const req = createRequire(import.meta.url);
    const pkg = req('@objectstack/spec/package.json') as { version?: string };
    if (typeof pkg?.version === 'string') return pkg.version;
  } catch {
    // unresolvable — the caller's failure posture applies
  }
  return null;
}

/**
 * Apply the versioned forward conversion to one compiled-artifact definition.
 *
 * Pure and copy-on-write; never throws, never validates. See the module doc
 * for the whole policy. `definition` is the *stack definition* (the shape
 * with `manifest`, `objects`, `permissions`, … at the top) — for an
 * environment-artifact envelope, pass the envelope's `metadata` block.
 */
export function applyArtifactForwardConversions<T>(
  definition: T,
  options: ArtifactForwardConversionOptions = {},
): ArtifactForwardConversionResult<T> {
  const runtimeSpecVersion =
    options.runtimeSpecVersion !== undefined
      ? options.runtimeSpecVersion
      : resolveInstalledSpecVersion();

  if (definition === null || typeof definition !== 'object' || Array.isArray(definition)) {
    return { definition, verdict: 'not-an-object', authoredFloor: null, runtimeSpecVersion, notices: [] };
  }

  const manifest = (definition as { manifest?: unknown }).manifest;
  const declared =
    manifest && typeof manifest === 'object'
      ? resolveDeclaredRange(manifest as ProtocolHandshakeManifest)
      : null;
  const floor = declared ? parseRangeFloor(declared.range) : null;
  const authoredFloor = floor ? floor.join('.') : null;

  const runtime = runtimeSpecVersion ? parseVersion(runtimeSpecVersion) : null;
  if (!runtime) {
    return { definition, verdict: 'runtime-version-unknown', authoredFloor, runtimeSpecVersion, notices: [] };
  }

  let verdict: ArtifactForwardConversionVerdict;
  if (!floor) {
    verdict = 'converted-undeclared';
  } else if (compareTriples(floor, runtime) < 0) {
    verdict = 'converted-forward';
  } else {
    return { definition, verdict: 'authored-current', authoredFloor, runtimeSpecVersion, notices: [] };
  }

  const notices: ArtifactConversionNotice[] = [];
  const converted = applyConversions(definition as Record<string, unknown>, {
    includeRetired: true,
    onNotice: (n) => {
      notices.push(n);
      options.onNotice?.(n);
    },
  }) as T;

  return { definition: converted, verdict, authoredFloor, runtimeSpecVersion, notices };
}
