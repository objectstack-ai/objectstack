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
 * admits (the leading version token of `engines.protocol`; of a `||` union,
 * the lowest alternative's — {@link parseRangeFloor}), and `runtime` the
 * `@objectstack/spec` version this process actually runs — its package label.
 * The window is decided PER ENTRY: a registry entry E is replayed when
 *
 *     floor < runtime   OR   floor ≤ E.retiredAfter
 *                       OR   (floor = M.0.0  AND  E.toMajor = M)
 *
 * where `retiredAfter` is the version the registry stamps on every retired
 * entry — the last published spec whose authoring surface still accepted the
 * old shape (`MetadataConversion`, `@objectstack/spec`) — and `toMajor` is the
 * protocol major whose conversion step the entry belongs to
 * (`CONVERSIONS_BY_MAJOR[M]`, the step `objectstack migrate meta --from M-1`
 * replays). Spelled out:
 *
 * - **`floor < runtime`** → the artifact predates this runtime's authoring
 *   surface. Replay the full conversion chain (retired entries included)
 *   before the strict parse — the artifact is the "consumer arriving late"
 *   ADR-0087 D3 keeps every conversion around for.
 * - **`floor >= runtime`** → the artifact claims the current (or a newer)
 *   surface as the label spells it. Only the retired entries whose
 *   `retiredAfter` the floor does not exceed are replayed — retirements the
 *   running spec enforces although its label has not moved past the release
 *   the artifact was built by. `main` is exactly that runtime between two
 *   releases: it refuses keys the next release retires while still carrying
 *   the last release's label, so a label-only comparison read an artifact
 *   built by that last release as "current" and refused it outright. When no
 *   entry is that recent, nothing is replayed and the strict parse —
 *   tombstones included — is the authority. This is what keeps the conversion
 *   **versioned rather than a blanket amnesty**: a key retired at version V
 *   stays a loud refusal for anything authored at ≥ V, and when a retired key
 *   later returns to the spec (the roadmap-M2 shape: `allowRestore`/`allowPurge`
 *   come back with the lifecycle operations they gate), artifacts authored
 *   against that surface are never stripped by history.
 * - **`floor` = M.0.0, at or above the runtime label** → every retired entry
 *   of the conversion step INTO protocol M replays as well (verdict
 *   `'converted-major-step'`). M.0.0 is what a bare `^M` range reads as, and
 *   it is the floor every build made during M's prerelease declares: the
 *   protocol constant moves to M when the prerelease opens (ruling record
 *   6049734955, Q1 → B), while the package label still names the last release
 *   of M-1 and every retirement landing in the prerelease is stamped at or below
 *   that label. So a prerelease-built `^M` artifact may predate any retirement in
 *   step M, and the per-entry comparison above can never say so: M.0.0 sits
 *   above every stamp of the M-1 line. Nor can the artifact: `os build`
 *   writes the parsed stack plus its docs and an optional `runtimeModule`,
 *   with no field naming the spec or CLI that built it, so no reading of the
 *   artifact tells "built before this entry" from "built after it". What makes
 *   the replay safe instead is that a conversion only rewrites the shape it
 *   positively recognizes: every retired entry of the step comes back by
 *   reference over a definition that lacks its old shape (pinned over each
 *   step-18 entry's own fixture pair in this module's test), so an artifact
 *   built after a retirement is unchanged and one built before it boots. The
 *   same holds at M.0.0 GA (label M.0.0, floor equal), where a prerelease-built
 *   artifact still declares that floor; from M.0.1 on the label half above
 *   replays the whole chain for it anyway. ⚠️ The M2 caveat: an entry whose old
 *   shape becomes legal again cannot be protected for a bare-major floor by
 *   this half — nor by the label half, which strips it for the same artifact on
 *   the next release — so the change that re-legalizes a retired key decides
 *   that entry's fate at this door, where the default-flip refusal below
 *   ({@link DEFAULT_FLIPS_NOT_REPLAYED_HERE}) is the existing mechanism.
 * - **A flat package body** — the manifest half beside the collections, with
 *   no `manifest` key (the shape `registerApp` and the marketplace ledger
 *   hold) — declares its range on itself, and the window is read there.
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
 * Below the label the label still stands in for every entry's own version, so
 * an artifact authored between an entry's retirement and the running release
 * is replayed rather than refused; narrowing that to the per-entry version
 * alone is a separate decision, not taken here.
 *
 * The comparison uses the full `x.y.z`, not the major: within-line
 * retirements (17.1 → 17.2) are exactly the case that created this module.
 * Cross-major gaps are the protocol *handshake*'s jurisdiction
 * (`checkProtocolCompat`) and refuse before conversion could matter.
 *
 * ## Reach — the definition's own collections AND every package body
 *
 * A multi-package artifact (ADR-0130 D4, option B) carries its collections in
 * `packages[i].manifest`, each an ASSEMBLED package body
 * (`AssembledPackageBodySchema`) that the strict parse gates entry by entry —
 * in `ObjectStackDefinitionSchema` and in `resolveArtifactPackageOrder` alike.
 * Since the 2026-09-22 addendum to D4 the definition's top level carries no
 * copy of them. So the same walk runs over each body as a second root: the
 * same `applyConversions` call, the same registry, the same window. ⛔ Never a
 * second walk with its own entry list — a body would then answer a different
 * question than the definition it travels in.
 *
 * A body is a stack-shaped root: where its manifest half and its collection
 * half declare the same key (`objects`, `datasources`, `permissions`), the
 * collection wins (the precedence table on `AssembledPackageBodySchema`), and
 * those are exactly the keys the registry walks at a definition's top level.
 * The one entry that reads a manifest (`manifest-permissions-string-list-removed`)
 * reaches `packages[i].manifest` from the definition root itself, which runs
 * first; a body has no `manifest` key for it to read again.
 *
 * The window is the ARTIFACT's — decided once from the definition's own
 * `engines.protocol` — and a body's own `engines.protocol` is not read. The
 * floor stands in for when the artifact was built (see above), and one
 * `os build` serializes every body of one artifact together (ADR-0130 D1: one
 * artifact, one atomic delivery). The same reading gates the boot: the
 * artifact-boot handshake judges the artifact's own `manifest` (`AppPlugin`,
 * `assertArtifactProtocolCompatible` in `@objectstack/runtime`). A per-body
 * window would also split the two copies of one definition that an artifact
 * built before that addendum carries (top level and body) into two answers.
 * Notices from a body are located from the definition root
 * (`packages[1].manifest.dashboards[0].refreshIntervalSeconds`).
 *
 * ## The one class the window does NOT admit — default flips
 *
 * The window above is a RESCUE: without it an artifact carrying a key the
 * current schema has since tombstoned is refused outright, with no operator
 * remedy. Every entry of that kind is safe to replay here, because the old
 * shape has no live meaning left to destroy.
 *
 * A DEFAULT FLIP is not that. Its old shape still parses, still means
 * something on today's authoring surface, and the rewrite changes what it
 * means — so replaying it is a reinterpretation, sound only where "this input
 * predates the flip" is a FACT. At this door it is a GUESS, and a weak one:
 * the key is the artifact's **declared `engines.protocol` floor**, not its
 * age, and `^17.0.0` is the range `create-objectstack` stamps — so an app
 * authored today, against today's surface, lands inside the window (measured
 * for `field-required-notnull-explicit`, #16693; measured again for
 * `app-hidden-to-unpublished`, #17885). Retirement does not hold those back
 * either: `retiredFromLoadPath`'s jurisdiction is the AUTHORING funnel and
 * nothing else (ADR-0087's recorded determination, and the flag's own docblock now says
 * so) — which is exactly why the window has to name them here.
 *
 * ⇒ {@link DEFAULT_FLIPS_NOT_REPLAYED_HERE} lists them, and the door refuses
 * them by id. Each id owes its reason beside it.
 *
 * ## What this deliberately is NOT
 *
 * - Not a second conversion table: the ADR-0087 registry in
 *   `@objectstack/spec` stays the single authority on *what* converts — and,
 *   through each retired entry's `retiredAfter`, on *since when* it stopped
 *   being authorable, and through its `toMajor`, on *which step* it belongs
 *   to; this module only decides *whether the retired window opens* for one
 *   artifact, reading those facts off the registry per entry.
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
import { ALL_CONVERSIONS, applyConversions } from '@objectstack/spec';
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
  /**
   * Where in the stack it applied, e.g. `permissions[0].objects.crm_ticket.allowPurge`;
   * inside a package body, from the definition's root (`packages[1].manifest.dashboards[0]…`).
   */
  path: string;
  /** Derived, human-facing one-liner. */
  message: string;
}

/** Why the retired conversion window did or did not open for an artifact. */
export type ArtifactForwardConversionVerdict =
  /** Declared floor predates the runtime spec — full chain replayed. */
  | 'converted-forward'
  /**
   * Declared floor is at or above the runtime spec's label, but at or below the
   * `retiredAfter` of one or more retired entries this runtime enforces — only
   * those entries replayed (see the module doc's per-entry rule).
   */
  | 'converted-retired-after'
  /**
   * Declared floor is `M.0.0` — the first release of protocol major M, the
   * floor every build from M's prerelease declares — at or above the runtime
   * spec's label: every retired entry of the conversion step into M replayed,
   * beside any the per-entry rule opens (see the module doc).
   */
  | 'converted-major-step'
  /** No declared range — treated as old data at rest, full chain replayed. */
  | 'converted-undeclared'
  /**
   * Declared floor is current-or-newer, newer than every retirement's
   * `retiredAfter`, and not the first release of a major whose conversion step
   * carries retired entries — nothing replayed, the strict parse decides.
   */
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
  /**
   * Under `'converted-retired-after'` and `'converted-major-step'` only: the
   * retirements this runtime enforces past the artifact's floor, which the
   * per-entry half of the window replayed — each with the `retiredAfter` the
   * floor is at or below. The entries the major-step half opens are NOT listed
   * here (their `retiredAfter` is below the floor; one reason, the floor, opens
   * all of them). Empty for every other verdict: the label half replays the
   * whole chain on one reason for all of it, and a closed window replays
   * nothing.
   */
  replayedRetirements: ArtifactReplayedRetirement[];
}

/** One retirement the per-entry half of the window replayed (see `'converted-retired-after'`). */
export interface ArtifactReplayedRetirement {
  /** The conversion id (`MetadataConversion.id`). */
  conversionId: string;
  /** Its `retiredAfter`: the last spec release whose authoring surface still accepted the old shape. */
  retiredAfter: string;
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
 *
 * A `||` union admits what any alternative admits (the handshake's reading),
 * so its floor is the LOWEST alternative's, in whatever order they are written
 * (`^18.0.0 || ^17.1.0` → 17.1.0, as `^17.1.0 || ^18.0.0`). One alternative
 * this cannot read, an empty one included, leaves that floor unknown: `null`.
 */
export function parseRangeFloor(range: string): [number, number, number] | null {
  const r = range.trim();
  if (r === '' || r.length > 128) return null;
  let lowest: [number, number, number] | null = null;
  for (const alternative of r.split('||')) {
    const floor = alternativeFloor(alternative.trim());
    if (floor === null) return null;
    if (lowest === null || compareTriples(floor, lowest) < 0) lowest = floor;
  }
  return lowest;
}

/** The floor of one `||` alternative of a range (see {@link parseRangeFloor}). */
function alternativeFloor(r: string): [number, number, number] | null {
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
  // Anchor a require at this module's own URL. `import.meta.url` reads as
  // written in the ESM build; in the CJS build tsup's `shims: true` (declared
  // and argued in this package's `tsup.config.ts` — #12971) rewrites it to a
  // real `__filename`-derived URL, so BOTH formats anchor on this module's own
  // file and resolve the SAME `@objectstack/spec/package.json`.
  //
  // ⛔ That shim is what makes this line legal in the CJS output at all: at
  // this build `target` esbuild emits `import.meta` verbatim, and outside an
  // ES module that is a PARSE-time error — the whole `require` entry point
  // becomes unloadable and the `catch` below never runs. Never assume the
  // catch covers a missing shim; it cannot, and this file has already paid
  // for the assumption once.
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
 * ADR-0087 entries the versioned window deliberately does NOT replay here —
 * the DEFAULT-FLIP class (see the module doc). Module-local on purpose: this
 * is the door's own refusal, not a fact about the registry, and exporting it
 * would invite a second caller to inherit a judgement it has not made.
 *
 * - `app-hidden-to-unpublished` (#17885, #4829, ADR-0045 amended 2026-08-09;
 *   retired with the ≤16.x kits on #25767, kept here as the worked example):
 *   rewrote `app.hidden: true` into `app._unpublished: true`. `hidden` is a
 *   LIVE authorable key — navigation presentation, *"never an access gate"*
 *   (`ui/app.zod.ts`) — while `_unpublished` is the machine-managed publish
 *   gate that `filterAppForUser` (`packages/rest/src/rest-server.ts`) drops
 *   the app on for every user without `studio.access` / `setup.access`. So
 *   replaying it here turns an authored `defineApp({ hidden: true })` into an
 *   app nobody but a builder can see — reproducing #4829, the incident the
 *   `_unpublished` split was introduced to end, through the conversion layer.
 *   The entry is sound where it says it is (the stored-row rehydration seams,
 *   where a `hidden: true` row can only have come from the pre-split
 *   materialization path, and `os migrate meta --from <=16`, where the
 *   operator asserts the source's age) — this door is neither, so it opts out
 *   rather than the entry ceasing to fire.
 * - `flow-decision-mode-inclusive-explicit` (#15429, maintainer ruling
 *   「跟主流对齐」): writes `mode: 'inclusive'` onto an edge-branched `decision`
 *   (no `conditions` list) that has two or more conditioned out-edges, so a
 *   flow written while every true branch ran keeps that behaviour now that the
 *   traversal is exclusive (first true edge in declaration order). Both shapes
 *   are legal and mean different things — an omitted `mode` IS the exclusive
 *   gateway, by the contract on `DecisionConfigSchema` — so the rewrite is a
 *   reinterpretation, sound only where "this source predates the flip" is a
 *   fact. Here it is a guess: the trigger is the artifact's declared
 *   `engines.protocol` floor, and `^17.0.0` is the range `create-objectstack`
 *   stamps, so an app scaffolded today, whose author wrote two branches
 *   against the contract that says an omitted `mode` is exclusive, lands
 *   inside the window and would be handed an inclusive gateway it never
 *   asked for — the ruled default made unobservable for every artifact-deployed
 *   app. The entry is sound at exactly one seam: `os migrate meta --from 17`,
 *   where the operator asserts the source's age and reviews the diff. The
 *   automation engine's flow rehydration seam refuses it by id for the same
 *   reason (`CONVERSIONS_NOT_REPLAYED_AT_REHYDRATION` in
 *   `packages/services/service-automation/src/engine.ts`); this door does too.
 */
const DEFAULT_FLIPS_NOT_REPLAYED_HERE: readonly string[] = [
  // `app-hidden-to-unpublished` stood here until #25767 retired it with the
  // ≤16.x kits (ADR-0087 D2 = A): the registry no longer carries it, so there is
  // nothing for this door to refuse. The reasoning in the docblock above is kept
  // because it is the reasoning the NEXT default flip is judged by.
  'flow-decision-mode-inclusive-explicit',
];

/**
 * The window for a floor at or above the runtime label, decided per entry.
 * `closed` is the ids the door must NOT replay — {@link DEFAULT_FLIPS_NOT_REPLAYED_HERE}
 * (read first, whatever an entry's version says), every live entry, and every
 * retired entry the floor postdates. Two halves open the rest:
 *
 * - `opened` — the per-entry half: each retirement whose `retiredAfter` the
 *   floor is at or below, i.e. one this runtime enforces past the floor.
 * - `majorStep` — for a floor of `M.0.0` only: every other retired entry whose
 *   `toMajor` is M, the step a prerelease build of M may have run only in part
 *   (see the module doc). Read AFTER the per-entry half, so an entry both open
 *   is reported once, with its `retiredAfter`.
 *
 * `null` when nothing opens, i.e. the floor postdates every retirement the
 * runtime enforces. A `retiredAfter` this cannot read leaves its entry to the
 * major-step half alone, and closed outside it: the strict parse and its
 * tombstone stay the authority, which is the loud direction.
 */
function idsTheFloorPostdates(
  floor: [number, number, number],
): { closed: string[]; opened: ArtifactReplayedRetirement[]; majorStep: string[] } | null {
  const closed = [...DEFAULT_FLIPS_NOT_REPLAYED_HERE];
  const opened: ArtifactReplayedRetirement[] = [];
  const majorStep: string[] = [];
  const firstReleaseOfMajor = floor[1] === 0 && floor[2] === 0;
  for (const conversion of ALL_CONVERSIONS) {
    if (DEFAULT_FLIPS_NOT_REPLAYED_HERE.includes(conversion.id)) continue;
    if (conversion.retiredFromLoadPath !== true) {
      closed.push(conversion.id);
      continue;
    }
    const retiredAfter = parseVersion(conversion.retiredAfter);
    if (retiredAfter && compareTriples(floor, retiredAfter) <= 0) {
      opened.push({ conversionId: conversion.id, retiredAfter: retiredAfter.join('.') });
    } else if (firstReleaseOfMajor && conversion.toMajor === floor[0]) {
      majorStep.push(conversion.id);
    } else {
      closed.push(conversion.id);
    }
  }
  return opened.length > 0 || majorStep.length > 0 ? { closed, opened, majorStep } : null;
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
    return { definition, verdict: 'not-an-object', authoredFloor: null, runtimeSpecVersion, notices: [], replayedRetirements: [] };
  }

  // WHERE the declared range is read from. A stack definition carries it on
  // its `manifest`; a package BODY carries it on itself — the manifest half of
  // `AssembledPackageBodySchema` sits beside the collections, which is the
  // shape a flat `manifest.register` / `registerApp` payload and a marketplace
  // ledger entry have, and the shape `packages[i].manifest` has inside an
  // option-B artifact (ADR-0130 D4). A definition that carries a `manifest`
  // object is read there and nowhere else, as before; only a definition with
  // no `manifest` is read on its own keys, so a flat body's window is the
  // body's own, versioned, instead of the undeclared amnesty.
  const manifest = (definition as { manifest?: unknown }).manifest;
  const rangeCarrier: unknown = manifest && typeof manifest === 'object' && !Array.isArray(manifest) ? manifest : definition;
  const declared = resolveDeclaredRange(rangeCarrier as ProtocolHandshakeManifest);
  const floor = declared ? parseRangeFloor(declared.range) : null;
  const authoredFloor = floor ? floor.join('.') : null;

  const runtime = runtimeSpecVersion ? parseVersion(runtimeSpecVersion) : null;
  if (!runtime) {
    return { definition, verdict: 'runtime-version-unknown', authoredFloor, runtimeSpecVersion, notices: [], replayedRetirements: [] };
  }

  let verdict: ArtifactForwardConversionVerdict;
  let excludeConversionIds: readonly string[] = DEFAULT_FLIPS_NOT_REPLAYED_HERE;
  let replayedRetirements: ArtifactReplayedRetirement[] = [];
  if (!floor) {
    verdict = 'converted-undeclared';
  } else if (compareTriples(floor, runtime) < 0) {
    verdict = 'converted-forward';
  } else {
    const perEntry = idsTheFloorPostdates(floor);
    if (perEntry === null) {
      return { definition, verdict: 'authored-current', authoredFloor, runtimeSpecVersion, notices: [], replayedRetirements: [] };
    }
    verdict = perEntry.majorStep.length > 0 ? 'converted-major-step' : 'converted-retired-after';
    replayedRetirements = perEntry.opened;
    // Every entry the floor postdates stays with the strict parse. Each id's
    // reason is the same, read off the registry rather than written here — the
    // floor is at or above the runtime label AND above the entry's own
    // `retiredAfter`, and it is not `M.0.0` for the entry's own step M (or the
    // entry is live, and a live entry has no retirement for the floor to
    // predate).
    excludeConversionIds = perEntry.closed;
  }

  const notices: ArtifactConversionNotice[] = [];
  // ONE walk — the registry's whole chain, under the one window decided above —
  // run over every root this definition carries: its own collections first,
  // then each `packages[i].manifest` body (see "Reach" in the module doc). A
  // body's notice is located under its package, so a boot log names the body.
  const replay = (root: Record<string, unknown>, at: string): Record<string, unknown> =>
    applyConversions(root, {
      includeRetired: true,
      excludeConversionIds,
      onNotice: (n) => {
        const notice = at === '' ? n : locateUnder(n, at);
        notices.push(notice);
        options.onNotice?.(notice);
      },
    });
  const converted = replayPackageBodies(replay(definition as Record<string, unknown>, ''), replay) as T;

  return { definition: converted, verdict, authoredFloor, runtimeSpecVersion, notices, replayedRetirements };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Run `replay` over each `packages[i].manifest` body (ADR-0130 D4) of an
 * already-converted definition. Copy-on-write at both levels: an entry whose
 * body converts nothing keeps its reference, and the definition keeps its own
 * when no body converted. A `packages` that is not an array, an entry that is
 * not an object, and a body that is not an object are left exactly as given —
 * this never gates; `resolveArtifactPackageOrder` (`@objectstack/core`) is the
 * refusal for each of those shapes.
 */
function replayPackageBodies(
  definition: Record<string, unknown>,
  replay: (root: Record<string, unknown>, at: string) => Record<string, unknown>,
): Record<string, unknown> {
  const packages = definition.packages;
  if (!Array.isArray(packages)) return definition;
  let touched = false;
  const next = packages.map((entry: unknown, i: number) => {
    if (!isRecord(entry) || !isRecord(entry.manifest)) return entry;
    const body = replay(entry.manifest, `packages[${i}].manifest`);
    if (body === entry.manifest) return entry;
    touched = true;
    return { ...entry, manifest: body };
  });
  return touched ? { ...definition, packages: next } : definition;
}

/**
 * A notice emitted inside a package body, located from the definition's root:
 * `path` gains the body's prefix, and so does the one place `message` quotes
 * that path (`applyConversions` writes it as ` at <path>: `). Every other field
 * is the conversion's own.
 */
function locateUnder(notice: ArtifactConversionNotice, at: string): ArtifactConversionNotice {
  const path = `${at}.${notice.path}`;
  return {
    ...notice,
    path,
    message: notice.message.replace(` at ${notice.path}: `, () => ` at ${path}: `),
  };
}
