// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { FieldError } from '@objectstack/spec/api';
import type {
  SettingsManifest,
  ResolvedSettingValue,
  SettingsNamespacePayload,
  SettingsActionResult,
  SpecifierScope,
  SpecifierValueDomain,
  SettingsChangeEvent,
  SettingsChangeHandler,
  SettingsUnsubscribe,
} from '@objectstack/spec/system';
import {
  type CryptoAdapter,
  NoopCryptoAdapter,
  providesConfidentiality,
} from './crypto-adapter.js';
import {
  type SettingsActionHandler,
  type SettingsAuditSink,
  type SettingsContext,
  type SettingsEngine,
  type SettingsRow,
  type SettingsServiceOptions,
  envKeyOf,
  SettingsCryptoUnavailableError,
  SettingsForbiddenError,
  SettingsLockedError,
  SettingsValidationError,
  UnknownKeyError,
  UnknownNamespaceError,
} from './settings-service.types.js';
import {
  firstRejectedDomainMember,
  knownValueDomain,
  valueDomainPhrasing,
} from './value-domains.js';
import {
  evaluateVisibility,
  referencedKeys,
  visibilitySource,
  VisibilityParseError,
} from './visibility-eval.js';

const DEFAULT_OBJECT = 'sys_setting';

/**
 * The execution context `SettingsService`'s own row writes run under (#8030).
 *
 * `sys_setting` is a platform-owned table with platform-owned columns
 * (`value_enc`, `updated_by` are declared `readonly: true`), and this service
 * is the only writer of them — after its own capability, lock and validation
 * gates. See {@link SettingsService.upsertRow} for the full argument and for
 * why the field stays `readonly` for everybody else.
 *
 * Frozen so a downstream engine adapter cannot mutate the service's posture by
 * writing into the bag it was handed.
 */
const SETTINGS_SYSTEM_WRITE_CONTEXT = Object.freeze({ isSystem: true as const });

/**
 * Value-bearing specifier types — drives which entries we expect to
 * find in the K/V store. Keeps the resolver in sync with the spec
 * without importing the (large) Zod enum at runtime.
 */
const LAYOUT_ONLY_TYPES = new Set([
  'group',
  'info_banner',
  'child_pane',
  'title_value',
  'action_button',
]);

/**
 * Specifier types whose stored value must be a member of the declared
 * `options` table.
 *
 * THE list is the spec's, not a judgement call made here: `SpecifierSchema`'s
 * superRefine (`settings-manifest.zod.ts`) rejects a manifest that authors one
 * of exactly these three types without a non-empty `options`. So "the types
 * that must declare an option table" and "the types whose value is checked
 * against it" name the same set — declared IS enforced, with no third list to
 * drift. `radio` and `multiselect` have no producer manifest today; they are
 * covered anyway because the alternative is that the first manifest to author
 * one silently re-opens this exact hole.
 */
const OPTION_BEARING_TYPES = new Set(['select', 'radio', 'multiselect']);

/**
 * The declared option values, in string form.
 *
 * String form because a stored value has been through JSON (and, over the REST
 * boundary, a form post): an option declared `value: 30` is legitimately read
 * back as `'30'`, and rejecting that would be enforcing the transport rather
 * than the enumeration. Same rule the record validator applies to
 * `select`/`multiselect` field options (objectui#2729).
 */
function declaredOptionValues(options: unknown): string[] {
  if (!Array.isArray(options)) return [];
  const out: string[] = [];
  for (const opt of options) {
    if (!opt || typeof opt !== 'object') continue;
    const v = (opt as Record<string, unknown>).value;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      out.push(String(v));
    }
  }
  return out;
}

/**
 * The first member of `value` that the declared table does not admit, or
 * `null` when every member is admissible.
 *
 * ONE comparison, shared by both paths that produce an effective value — the
 * save path ({@link SettingsService.validatePatch}) and the env path
 * ({@link SettingsService.get} / `reportRejectedEnvOverride`). #5204 exists
 * precisely because one of those two checked the option table and the other
 * did not; two open-coded copies of this comparison would be the same defect
 * deferred rather than fixed.
 *
 * `multiselect` stores an array, `select`/`radio` a scalar; both are checked
 * element-wise against the one table. A scalar arriving at a multiselect is
 * wrapped rather than rejected — policing the value's SHAPE is a different
 * constraint (`invalid_type`) with a different owner, and inventing it here
 * would reject writes this check was never asked to touch.
 *
 * Returns a WRAPPER, not the offending value itself: a bare return cannot
 * distinguish "nothing was rejected" from "the rejected member WAS
 * `undefined`", and the latter would slip through the check. Same reason the
 * implementation uses `findIndex` rather than `find`.
 */
function firstRejectedOption(allowed: string[], value: unknown): { value: unknown } | null {
  const picked = Array.isArray(value) ? value : [value];
  const at = picked.findIndex((v) => !allowed.includes(String(v)));
  return at === -1 ? null : { value: picked[at] };
}

/**
 * The value bounds a specifier declares — `min`/`max` (numeric window),
 * `step` (numeric grid) and `minLength`/`maxLength` (string length window), as
 * `SpecifierSchema` spells them (#5932, #6199).
 */
interface DeclaredBounds {
  min?: number;
  max?: number;
  /**
   * The grid spacing, from the `step` declared under `SpecifierSchema`'s
   * "numeric bounds and step" comment (#6199). Only ever set to a FINITE
   * POSITIVE number — see {@link declaredBounds} for why a `0`, a negative or a
   * non-finite `step` declares no grid at all rather than an impossible one.
   */
  step?: number;
  minLength?: number;
  maxLength?: number;
}

/** A breached bound, in the form both call sites need to report it. */
interface RangeViolation {
  /**
   * `FieldErrorCode`, ADR-0114 — the member that mirrors the breached property.
   *
   * The window codes are the property's own name (`min` → `min_value`). A grid
   * breach has no such member, so it takes `invalid_value`, the catalog's
   * declared slot for "rejected for a reason no other member names" — the same
   * verdict `rest-server.ts` already reaches for Zod's `not_multiple_of`, which
   * is this exact condition arriving from the other direction. Inventing a
   * `not_multiple_of` member would be a `packages/spec` change, and the catalog
   * is closed on purpose.
   */
  code: 'min_value' | 'max_value' | 'min_length' | 'max_length' | 'invalid_value';
  /**
   * `range` (numeric window), `step` (numeric grid) or `length` (character
   * window) — picks the prose at both call sites.
   */
  kind: 'range' | 'step' | 'length';
  /** The declared window in machine form, for `FieldError.constraint`. */
  constraint: Record<string, unknown>;
  /** The declared window in prose (`min 6, max 64`), for the env log line. */
  declared: string;
}

/**
 * Relative slack allowed when deciding whether a value sits ON the declared
 * grid, as a fraction of the magnitudes involved (#6199).
 *
 * A grid check is `value === anchor + k * step` for some integer `k`, and in
 * binary floating point that equation is almost never exactly true for the
 * decimal grids people actually declare. `ai.temperature` declares `step: 0.1`;
 * `0.7 / 0.1` is `6.999999999999999`, not `7`, so an exact modulo would reject
 * a value the manifest's own default neighbourhood is made of. The tolerance is
 * RELATIVE rather than absolute because the absolute error scales with the
 * operands: at `step: 1e-6` an absolute `1e-9` would be a third of a step wide,
 * and at `max: 1048576` (`ai.max_tokens`) it would be tighter than one ULP.
 *
 * `1e-9` sits deliberately between the two errors it must separate. A double
 * carries ~2.2e-16 of relative precision, so a handful of arithmetic steps
 * accumulate ~1e-15 at worst — six orders of magnitude of headroom below this
 * bound. A genuine off-grid value is off by a fraction of a step: `0.15` on a
 * `0.1` grid misses by `0.05`, which is `3e-1` relative — eight orders of
 * magnitude above it. Nothing real lands in the gap.
 *
 * The direction of the remaining doubt is deliberate too. This gate is a
 * TIGHTENING of a path that accepted everything yesterday, so where the
 * arithmetic genuinely cannot tell (a value so large the grid is finer than the
 * double's own spacing there), it accepts. Rejecting a legitimate write is the
 * expensive mistake; letting one absurd-magnitude value through is not.
 */
const STEP_GRID_TOLERANCE = 1e-9;

/**
 * True when `value` sits on the grid `anchor + k * step` for some integer `k`,
 * within {@link STEP_GRID_TOLERANCE} (#6199).
 *
 * The ANCHOR is the declared `min` when there is one, else `0` — the HTML
 * step-base convention, and the one the vocabulary itself points at: `step`
 * lives under `SpecifierSchema`'s `min`/`max` comment, and a `slider` declaring
 * `min: 1, step: 2` means the odd numbers, not the even ones. Nothing in this
 * repo declares a different base; the only other `multipleOf`-shaped rule
 * anywhere (Zod's, mapped in `rest-server.ts`) is anchored at 0, which is the
 * same convention with no `min` declared.
 *
 * The comparison happens in the VALUE domain, not the multiplier domain:
 * `Math.abs(k - Math.round(k))` would measure the error as a fraction of a
 * step, so its meaning would change with the grid's fineness. Measuring
 * `value` against the nearest grid point keeps the tolerance a property of the
 * numbers, which is what the floating-point error is a property of.
 */
function isOnStepGrid(value: number, anchor: number, step: number): boolean {
  const k = Math.round((value - anchor) / step);
  if (!Number.isFinite(k)) return true; // cannot judge — accept, per the posture above
  const nearest = anchor + k * step;
  const scale = Math.max(Math.abs(value), Math.abs(anchor), Math.abs(step));
  return Math.abs(value - nearest) <= scale * STEP_GRID_TOLERANCE;
}

/**
 * The bounds this specifier declares, or `null` when it declares none.
 *
 * Keyed on the DECLARATION, not on the specifier `type` — deliberately, and
 * unlike the `options` check next door, which keys on `OPTION_BEARING_TYPES`.
 * The difference is the spec's, not a preference: `SpecifierSchema`'s
 * superRefine *ties* an option table to exactly `select`/`radio`/`multiselect`
 * (it rejects those three without one), so "types that must declare a table"
 * and "types whose value is checked against it" are the same set and no third
 * list can drift. It ties `min`/`max`/`step`/`minLength`/`maxLength` to nothing
 * — doc comments say `number`/`slider` and `text`/`textarea`, but the schema
 * accepts them on any specifier and only checks their ordering. Inventing a
 * type list here would therefore BE the third list, and it would recreate this
 * issue one level down: a `min` authored on a type not on my list would parse,
 * render, and quietly not be enforced. So: declared is enforced, wherever it is
 * declared. The value's SHAPE decides applicability instead (see
 * {@link firstRangeViolation}), which is exactly how the `pattern` branch in
 * `validatePatch` has always worked.
 *
 * `step` (#6199) is admitted on a STRICTER test than the window bounds: finite
 * AND positive. A window bound of `0` or `-3` is a perfectly meaningful window;
 * a `step` of `0` or `-0.1` is not a grid at all — `anchor + k * 0` is a single
 * point and a negative spacing names the same grid as its absolute value while
 * reading as an author error. Such a declaration therefore records NO grid,
 * which is the same disposition this function already gives a non-finite bound
 * and the same one `registerManifest` gives an option-bearing specifier with no
 * table: nothing to enforce, unchanged behaviour, never a refused write. It is
 * also the posture #5204 settled for the declaration audit one level up —
 * registration REPORTS, it never refuses — and there is nothing to report here,
 * because a manifest that declares an impossible grid rejects no writes and
 * misconfigures no deployment; it merely fails to constrain, which is exactly
 * where every other specifier without a `step` already sits.
 */
function declaredBounds(spec: {
  min?: unknown; max?: unknown; step?: unknown; minLength?: unknown; maxLength?: unknown;
}): DeclaredBounds | null {
  const out: DeclaredBounds = {};
  let any = false;
  for (const k of ['min', 'max', 'minLength', 'maxLength'] as const) {
    const v = spec[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = v;
      any = true;
    }
  }
  if (typeof spec.step === 'number' && Number.isFinite(spec.step) && spec.step > 0) {
    out.step = spec.step;
    any = true;
  }
  return any ? out : null;
}

/**
 * The value as a number, or `null` when it is not a number at all.
 *
 * A string that parses is admitted for the same reason `declaredOptionValues`
 * compares in string form: a stored value has been through JSON and, over the
 * REST boundary, a form post, so a `number` specifier legitimately reads back
 * as `'42'` and rejecting that would enforce the transport rather than the
 * bound. Booleans, arrays and objects are NOT coerced (`Number(true)` is 1,
 * `Number([])` is 0) — a value of the wrong shape is `invalid_type`, a
 * different constraint with a different owner, and inventing it here would
 * reject writes this check was never asked to touch. Same posture, same
 * sentence, as `firstRejectedOption`.
 */
function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * The bound this value breaches, or `null` when it sits inside every declared
 * window.
 *
 * ONE comparison, shared by both paths that produce an effective value — the
 * save path ({@link SettingsService.validatePatch}) and the env path
 * ({@link SettingsService.effectiveEnvOverride}) — for the same reason
 * {@link firstRejectedOption} is shared: #5204 exists precisely because one of
 * those two consulted the declared table and the other did not, and #5932's
 * triage ruled that the env half must reuse the one judgment point rather than
 * open a second implementation of the same comparison.
 *
 * A value that is not comparable against a declared window is left alone (a
 * non-numeric value under `min`/`max`/`step`, a non-string under
 * `minLength`/`maxLength`). Check ordering mirrors `record-validator.ts`'s
 * equivalent branches so the two report the same bound for the same value; a
 * value can breach only one side of a well-ordered window anyway, and
 * `SpecifierSchema` rejects `min > max` at parse time.
 *
 * The grid (`step`, #6199) is judged AFTER the window it lives inside, so a
 * value that is both out of range and off grid is reported as out of range.
 * That ordering is not cosmetic: the window is the coarser, more actionable
 * fact, and `validatePatch` emits at most one `FieldError` per key — telling an
 * author that `temperature: 40` misses the 0.1 grid, while true, buries that it
 * is twenty times the declared maximum.
 */
function firstRangeViolation(bounds: DeclaredBounds, value: unknown): RangeViolation | null {
  const { min, max, step, minLength, maxLength } = bounds;

  if (typeof min === 'number' || typeof max === 'number') {
    const n = numericValue(value);
    if (n !== null) {
      const constraint: Record<string, unknown> = {};
      if (typeof min === 'number') constraint.min = min;
      if (typeof max === 'number') constraint.max = max;
      const declared = [
        typeof min === 'number' ? `min ${min}` : null,
        typeof max === 'number' ? `max ${max}` : null,
      ].filter(Boolean).join(', ');
      if (typeof min === 'number' && n < min) {
        return { code: 'min_value', kind: 'range', constraint, declared };
      }
      if (typeof max === 'number' && n > max) {
        return { code: 'max_value', kind: 'range', constraint, declared };
      }
    }
  }

  if (typeof step === 'number') {
    const n = numericValue(value);
    // The anchor is the declared `min` when there is one, else 0 — see
    // {@link isOnStepGrid}. It travels in `constraint` alongside `step` because
    // a client cannot reconstruct the grid from the spacing alone, and the
    // specifier it came from may declare no `min` at all.
    const anchor = typeof min === 'number' ? min : 0;
    if (n !== null && !isOnStepGrid(n, anchor, step)) {
      return {
        code: 'invalid_value',
        kind: 'step',
        constraint: { step, ...(typeof min === 'number' ? { min } : {}) },
        declared: anchor === 0 ? `step ${step}` : `step ${step} from ${anchor}`,
      };
    }
  }

  if (typeof minLength === 'number' || typeof maxLength === 'number') {
    if (typeof value === 'string') {
      const actual = value.length;
      const constraint: Record<string, unknown> = {};
      if (typeof minLength === 'number') constraint.minLength = minLength;
      if (typeof maxLength === 'number') constraint.maxLength = maxLength;
      constraint.actual = actual;
      const declared = [
        typeof minLength === 'number' ? `min ${minLength}` : null,
        typeof maxLength === 'number' ? `max ${maxLength}` : null,
      ].filter(Boolean).join(', ') + ' characters';
      if (typeof maxLength === 'number' && actual > maxLength) {
        return { code: 'max_length', kind: 'length', constraint, declared };
      }
      if (typeof minLength === 'number' && actual < minLength) {
        return { code: 'min_length', kind: 'length', constraint, declared };
      }
    }
  }

  return null;
}

/**
 * A declared `pattern` in enforceable form (#6580): the source string as the
 * manifest spelled it (for `FieldError.constraint` and the env log line) and
 * the compiled `RegExp`. Compiled once and shared safely — `new RegExp(source)`
 * takes no flags here, and a flagless RegExp's `test()` is stateless
 * (`lastIndex` only advances under `g`/`y`).
 */
interface DeclaredPattern {
  source: string;
  re: RegExp;
}

/**
 * The `pattern` this specifier declares as something enforceable, or `null`
 * when it declares none — where "none" deliberately includes a declaration
 * that does not compile.
 *
 * The invalid-RegExp tolerance is the write gate's own, hoisted verbatim: the
 * `validatePatch` branch has always answered an uncompilable `pattern` with
 * `re = undefined` ("invalid manifest pattern — don't block writes"), and it
 * is the same disposition {@link declaredBounds} gives an impossible `step`
 * (#6199): such a manifest rejects no values and misconfigures no deployment,
 * it merely fails to constrain. Because BOTH doors obtain the declaration
 * through this one function, the tolerance can no longer drift between them.
 */
function declaredPattern(pattern: unknown): DeclaredPattern | null {
  if (typeof pattern !== 'string') return null;
  try {
    return { source: pattern, re: new RegExp(pattern) };
  } catch {
    return null; // invalid manifest pattern — nothing to enforce, never a refusal
  }
}

/**
 * The value, wrapped, when it is a string the declared pattern does not admit;
 * `null` when the pattern has nothing to say about it.
 *
 * ONE comparison, shared by both paths that produce an effective value — the
 * save path ({@link SettingsService.validatePatch}) and the env path
 * ({@link SettingsService.effectiveEnvOverride}) — for the reason #5204 is on
 * file and #5932's triage turned into a ruling: the same comparison living in
 * one door only is how `PUT /api/settings/:ns` came to refuse the very value
 * an `OS_*` override slid straight through (#6580). `pattern` was the last
 * declared constraint family judged on one door.
 *
 * A non-string value is left alone: a `pattern` constrains character shape, so
 * the value's SHAPE decides applicability — exactly how the write gate's
 * branch has always behaved (`typeof value === 'string'`), and the same
 * posture, same sentence, as `firstRangeViolation`'s length window. Policing
 * the value's type is a different constraint (`invalid_type`) with a different
 * owner.
 *
 * Returns a WRAPPER rather than a boolean for symmetry with
 * {@link firstRejectedOption}: the caller reports the offending value, and the
 * wrapper is the shape every family hands back at both call sites.
 */
function firstPatternMiss(declared: DeclaredPattern, value: unknown): { value: string } | null {
  if (typeof value !== 'string') return null;
  return declared.re.test(value) ? null : { value };
}

interface RegisteredManifest {
  manifest: SettingsManifest;
  /** Resolved specifier scopes for fast lookup. */
  scopes: Map<string, SpecifierScope>;
  /** Specifiers marked encrypted (or implicit for `password`). */
  encryptedKeys: Set<string>;
  /** Default values from the manifest, keyed by specifier key. */
  defaults: Map<string, unknown>;
  /** Action handlers registered alongside this manifest. */
  actions: Map<string, SettingsActionHandler>;
  /**
   * Declared option values (string form) for every option-bearing specifier
   * that actually declares a non-empty table, keyed by specifier key.
   *
   * Precomputed at registration because `get()` is the service's hottest path
   * — `getNamespace` calls it once per specifier on every settings page load —
   * and the alternative is re-scanning `manifest.specifiers` per read. A key
   * ABSENT from this map is a key with nothing to enforce (not option-bearing,
   * or an option-bearing type whose manifest declares no usable table), so
   * absence means "unchanged behaviour" at both call sites rather than
   * "check against an empty set", which would reject everything.
   */
  optionTables: Map<string, string[]>;
  /**
   * Declared value bounds for every specifier that declares at least one of
   * `min` / `max` / `step` / `minLength` / `maxLength`, keyed by specifier key
   * (#5932, #6199).
   *
   * Precomputed for the same reason and read the same way as `optionTables`:
   * `get()` is the hottest path, and an ABSENT key means "this specifier
   * declares no window" — nothing to enforce, unchanged behaviour — rather
   * than "an empty window", which would reject everything.
   */
  bounds: Map<string, DeclaredBounds>;
  /**
   * Declared standard value domains (#5712), keyed by specifier key —
   * recorded only for the domains this side can enforce (see
   * `knownValueDomain`).
   *
   * Precomputed for the same reason and read the same way as `optionTables`:
   * an ABSENT key means "no domain declared" — for an option-bearing type the
   * #5131 exhaustive-options check stays the boundary, byte-for-byte unchanged
   * behaviour — while a PRESENT key moves the enforcement boundary onto the
   * standard's membership and degrades `options` to a UI convenience list.
   */
  valueDomains: Map<string, SpecifierValueDomain>;
  /**
   * Declared, compilable `pattern` for every specifier that has one (#6580),
   * keyed by specifier key.
   *
   * Precomputed for the same reason and read the same way as `optionTables`:
   * `get()` is the hottest path, and an ABSENT key means "nothing to enforce"
   * — no pattern declared, or a declaration that does not compile (the write
   * gate's own tolerance, see {@link declaredPattern}) — rather than "an
   * impossible pattern", which would reject everything.
   */
  patterns: Map<string, DeclaredPattern>;
}

/**
 * Concrete SettingsService. See `src/settings-service.types.ts` for
 * the supporting types and `README.md` for the high-level contract.
 */
export class SettingsService {
  private engine?: SettingsEngine;
  private readonly crypto: CryptoAdapter;
  private cryptoProvider?: import('@objectstack/spec/contracts').ICryptoProvider;
  private secretStore?: import('./settings-service.types.js').SettingsSecretStore;
  private audit?: SettingsAuditSink;
  private auditWriter?: import('./settings-service.types.js').SettingsAuditWriter;
  private readonly env: Record<string, string | undefined>;
  private readonly objectName: string;
  private readonly logger?: import('./settings-service.types.js').SettingsDiagnosticsLogger;
  private readonly registry = new Map<string, RegisteredManifest>();
  /**
   * `OS_*` overrides already reported as rejected (#5204), keyed
   * `<envVar>=<offending value>`. See {@link reportRejectedEnvOverride} for why
   * the value is part of the key and not just the var name.
   */
  private readonly reportedEnvOverrides = new Set<string>();
  /**
   * `<namespace>.<key>` pairs whose fail-closed encryption refusal (#8026) has
   * already been reported to the logger. Deduped for the same reason
   * {@link reportedEnvOverrides} is: a settings form that retries a save would
   * otherwise repeat one operator-actionable line per attempt.
   */
  private readonly reportedCryptoRefusals = new Set<string>();
  /** In-memory fallback when no engine is wired. */
  private readonly memory: SettingsRow[] = [];
  /** Change subscribers, optionally scoped to a namespace. */
  private readonly subscribers = new Set<{
    ns?: string;
    handler: SettingsChangeHandler;
  }>();

  constructor(opts: SettingsServiceOptions = {}) {
    this.engine = opts.engine;
    this.crypto = opts.crypto ?? new NoopCryptoAdapter();
    this.cryptoProvider = opts.cryptoProvider;
    this.secretStore = opts.secretStore;
    this.audit = opts.audit;
    this.auditWriter = opts.auditWriter;
    this.env = opts.env ?? (typeof process !== 'undefined' ? process.env : {});
    this.objectName = opts.objectName ?? DEFAULT_OBJECT;
    this.logger = opts.logger;
  }

  /**
   * Late-bind a data engine and (optionally) an audit sink. Plugins
   * call this from `kernel:ready` once `objectql` is wired so the
   * SettingsService swaps from its in-memory fallback to the real
   * `sys_setting` table without re-registering the service.
   */
  bindEngine(
    engine: SettingsEngine,
    audit?: SettingsAuditSink,
    extras?: {
      secretStore?: import('./settings-service.types.js').SettingsSecretStore;
      auditWriter?: import('./settings-service.types.js').SettingsAuditWriter;
      cryptoProvider?: import('@objectstack/spec/contracts').ICryptoProvider;
    },
  ): void {
    this.engine = engine;
    if (audit) this.audit = audit;
    if (extras?.secretStore) this.secretStore = extras.secretStore;
    if (extras?.auditWriter) this.auditWriter = extras.auditWriter;
    if (extras?.cryptoProvider) this.cryptoProvider = extras.cryptoProvider;

    // Notify subscribers that the persistent store is now available so
    // late-binders (e.g. AIServicePlugin's adapter rebuild on saved
    // provider settings) can re-fetch with real DB-backed values rather
    // than only the in-memory defaults that were visible at
    // `kernel:ready` ordering before the engine was wired.
    for (const ns of this.registry.keys()) {
      this.emitChange({
        namespace: ns,
        key: '*',
        scope: 'global',
        action: 'set',
        at: new Date().toISOString(),
      });
    }
  }

  /**
   * Cascade priority ranks for lock comparisons (lower = higher
   * precedence). env<global<tenant<user<default. A locked row at a
   * lower rank blocks writes at all higher ranks.
   */
  private scopeRank(scope: SpecifierScope | 'env' | 'default'): number {
    switch (scope) {
      case 'global':  return 1;
      case 'tenant':  return 2;
      case 'user':    return 3;
      default:        return 99;
    }
  }

  // ---------------------------------------------------------------------
  // Change events (Phase 1)
  // ---------------------------------------------------------------------

  /**
   * Subscribe to `settings:changed` events. When `namespace` is set the
   * handler only fires for that namespace, otherwise it fires for every
   * mutation across the service.
   *
   * Returns an idempotent unsubscribe handle — call it from the
   * consumer's shutdown hook to avoid leaks.
   */
  subscribe(
    namespace: string | undefined,
    handler: SettingsChangeHandler,
  ): SettingsUnsubscribe {
    const entry = { ns: namespace, handler };
    this.subscribers.add(entry);
    return () => {
      this.subscribers.delete(entry);
    };
  }

  /**
   * Dispatch a change event to all matching subscribers. Errors thrown
   * by a handler are swallowed to keep the bus crash-safe — handlers
   * are expected to enqueue async work themselves.
   */
  private emitChange(event: SettingsChangeEvent): void {
    if (this.subscribers.size === 0) return;
    for (const sub of this.subscribers) {
      if (sub.ns && sub.ns !== event.namespace) continue;
      try {
        sub.handler(event);
      } catch {
        // Swallow — never break the writer because a listener misbehaves.
      }
    }
  }

  // ---------------------------------------------------------------------
  // Manifest registry
  // ---------------------------------------------------------------------

  /**
   * Register (or replace) a manifest. Idempotent.
   *
   * Registration is also where the deployment's `OS_*` overrides for this
   * namespace are audited against the manifest's option tables (#5204) — see
   * {@link auditEnvOverrides}. Registration REPORTS, it never rejects: a value
   * that was legal yesterday and left the table today must not keep an
   * existing deployment from booting.
   */
  registerManifest(manifest: SettingsManifest): void {
    const scopes = new Map<string, SpecifierScope>();
    const encryptedKeys = new Set<string>();
    const defaults = new Map<string, unknown>();
    const optionTables = new Map<string, string[]>();
    const bounds = new Map<string, DeclaredBounds>();
    const valueDomains = new Map<string, SpecifierValueDomain>();
    const patterns = new Map<string, DeclaredPattern>();
    const defaultScope = manifest.scope ?? 'tenant';
    for (const spec of manifest.specifiers) {
      if (!spec.key || LAYOUT_ONLY_TYPES.has(spec.type)) continue;
      scopes.set(spec.key, spec.scope ?? defaultScope);
      if (spec.encrypted || spec.type === 'password') encryptedKeys.add(spec.key);
      if (typeof spec.default !== 'undefined') defaults.set(spec.key, spec.default);
      // Declared bounds are recorded wherever they are declared — see
      // `declaredBounds` for why this is keyed on the declaration and the
      // option table is keyed on the type (#5932), and why a `step` that is not
      // a finite positive spacing records no grid at all (#6199).
      const declared = declaredBounds(spec);
      if (declared) bounds.set(spec.key, declared);
      // A declared standard value domain (#5712). `knownValueDomain` filters to
      // the members this side can enforce: `registerManifest` takes manifests
      // as given (no Zod pass), and a misspelt domain on a hand-built manifest
      // must fall back to unchanged behaviour — for an option-bearing type
      // that is the #5131 exhaustive table — rather than either an
      // unenforceable claim or an accept-everything hole.
      const domain = knownValueDomain((spec as { valueDomain?: unknown }).valueDomain);
      if (domain) valueDomains.set(spec.key, domain);
      // The declared `pattern`, compiled once (#6580). `declaredPattern`
      // carries the write gate's own tolerance — an uncompilable declaration
      // records nothing to enforce — so an absent entry means unchanged
      // behaviour at both call sites, never "reject everything".
      const pattern = declaredPattern(spec.pattern);
      if (pattern) patterns.set(spec.key, pattern);
      if (OPTION_BEARING_TYPES.has(spec.type)) {
        // A manifest with no option table cannot say what is legal. The spec
        // refuses that shape at parse time, but `registerManifest` takes
        // manifests as given (no Zod pass), so record nothing rather than
        // record an empty table — same leniency the save path takes, and the
        // reason the map's ABSENT key means "nothing to enforce".
        const allowed = declaredOptionValues((spec as { options?: unknown }).options);
        if (allowed.length > 0) optionTables.set(spec.key, allowed);
      }
    }
    const prev = this.registry.get(manifest.namespace);
    const actions = prev?.actions ?? new Map<string, SettingsActionHandler>();
    this.registry.set(manifest.namespace, {
      manifest,
      scopes,
      encryptedKeys,
      defaults,
      actions,
      optionTables,
      bounds,
      valueDomains,
      patterns,
    });
    this.auditEnvOverrides(manifest.namespace);
  }

  /**
   * #5204 — report every `OS_*` override in this namespace whose value the
   * specifier's declared `options` table does not admit.
   *
   * Why at registration and not only on read: an override that will never take
   * effect is a **misconfigured deployment**, and the operator should learn
   * that at boot, next to the rest of the startup output — not the first time
   * somebody happens to open the settings page, and not never (a key nobody
   * reads during the process's life would otherwise stay silent forever).
   *
   * Why it does NOT refuse to boot: the option tables move. #5094 retired
   * `sendgrid` and `ses` from `mail.provider`; a deployment pinning
   * `OS_MAIL_PROVIDER=sendgrid` was correct the day it was written, and turning
   * an upgrade into a crash-on-start would punish exactly the operator this
   * message is trying to help. The value is ignored either way (see `get`); the
   * difference is whether the rest of the platform still comes up around it.
   */
  private auditEnvOverrides(namespace: string): void {
    const reg = this.registry.get(namespace);
    if (!reg) return;
    // Only the keys that declare something enforceable can be rejected, so only
    // they are worth walking: an option table (#5131/#5204), a value window
    // (#5932), a standard value domain (#5712) or a pattern (#6580).
    // `effectiveEnvOverride` does the judging (and the reporting); the value it
    // returns is of no interest here.
    const enforceable = new Set([
      ...reg.optionTables.keys(),
      ...reg.bounds.keys(),
      ...reg.valueDomains.keys(),
      ...reg.patterns.keys(),
    ]);
    for (const key of enforceable) {
      this.effectiveEnvOverride(reg, namespace, key);
    }
  }

  /**
   * The `OS_*` override for this key **if it is actually in force**, else null.
   *
   * THE one place that answers "does env win here?", for every site that used to
   * ask in its own way. There were three, and #5204 is what having three costs:
   * `get()` coerced the value and returned it, `setMany` locked the key on the
   * mere PRESENCE of the variable, and neither consulted the `options` table
   * that the save path had been enforcing since #5131.
   *
   * Routing all three through one judgment is what keeps `locked` coherent. A
   * rejected override is not in force, so it must not pin the key either:
   * reporting `locked: false` from `get()` while `setMany` still threw
   * `SETTINGS_LOCKED` would leave the settings UI rendering the field as
   * editable and then failing the save — and, worse, would leave that key
   * configurable by NOTHING (env value rejected, UI refused), a lockout only an
   * env edit could clear. That is strictly worse than the hole #5204 closes,
   * and it is the same reasoning `validatePatch` already applies when it
   * refuses to lock a workspace out over historical drift.
   *
   * Reporting lives here rather than at the call sites so no future fourth
   * caller can read an override without the rejection being heard.
   *
   * #5932 added the second family of declared constraints (`min`/`max`/
   * `minLength`/`maxLength`) HERE rather than on the env path's own terms, for
   * the reason #5204 is on file: the same comparison in two places is how the
   * env half came to disagree with the save half in the first place. Both
   * families are judged at this one point, by the same helpers the save path
   * calls, and both produce the same verdict — an override that is not in force
   * contributes no value and pins nothing. #6199 folded `step` into that same
   * family rather than opening a third branch: it rides `DeclaredBounds` and
   * `firstRangeViolation`, so it arrives on both paths at once by construction
   * and cannot be the next constraint that is enforced on one door only.
   * #6580 closed the set out: `pattern`, the LAST declared constraint family
   * still judged on one door only, now arrives through the same shared helper
   * the save path calls ({@link firstPatternMiss}), in the same family order
   * the save path applies — options → pattern → valueDomain → bounds — so the
   * two doors report the same family for the same value.
   */
  private effectiveEnvOverride(
    reg: RegisteredManifest,
    namespace: string,
    key: string,
  ): { envName: string; value: unknown } | null {
    const envName = envKeyOf(namespace, key);
    const envRaw = this.env[envName];
    if (typeof envRaw !== 'string') return null;

    const value = coerceEnvValue(envRaw, reg.defaults.get(key));

    // Families are judged in the SAME order `validatePatch` judges them —
    // options (when no domain is declared) → pattern → valueDomain → bounds —
    // so a value that breaks several declarations is rejected for the same
    // reason at both doors, not just rejected at both (#6580).
    //
    // A declared standard value domain (#5712) REPLACES the option table as
    // the membership boundary: the standard's membership is what the override
    // is judged against, and `options` is a UI convenience list this door does
    // not consult. Judged here — the ONE decision point — for the reason #5204
    // is on file: the same comparison in two places is how the env half came to
    // disagree with the save half in the first place.
    const domain = reg.valueDomains.get(key);
    if (!domain) {
      // A key with no declared table has nothing to enforce — unchanged
      // behaviour (#5131's exhaustive-options semantics, untouched when no
      // domain is declared).
      const allowed = reg.optionTables.get(key);
      if (allowed) {
        const rejected = firstRejectedOption(allowed, value);
        if (rejected) {
          this.reportRejectedEnvOverride(reg, namespace, key, envName, rejected.value, {
            what: 'is not a declared option for',
            detail: `Allowed values: ${allowed.join(', ')}.`,
            fix: 'one of the allowed values',
          });
          return null;
        }
      }
    }

    // The declared `pattern` (#6580) — the last declared constraint family
    // that was judged on one door only. Judged by the same helper the save
    // path calls ({@link firstPatternMiss}), in the same position it holds
    // there: after the option table, before the domain membership and the
    // value window. A key with no compilable pattern has nothing to enforce
    // ({@link declaredPattern} — the write gate's invalid-RegExp tolerance,
    // shared by construction).
    const pattern = reg.patterns.get(key);
    if (pattern) {
      const miss = firstPatternMiss(pattern, value);
      if (miss) {
        this.reportRejectedEnvOverride(reg, namespace, key, envName, miss.value, {
          what: 'does not match the declared pattern for',
          detail: `Allowed values: strings matching /${pattern.source}/.`,
          fix: 'a value matching the declared pattern',
        });
        return null;
      }
    }

    if (domain) {
      const rejected = firstRejectedDomainMember(domain, value);
      if (rejected) {
        const { member, example } = valueDomainPhrasing(domain);
        this.reportRejectedEnvOverride(reg, namespace, key, envName, rejected.value, {
          what: `is not a valid ${member} for`,
          detail: `Allowed values: any ${member} (e.g. '${example}').`,
          fix: `a valid ${member}`,
        });
        return null;
      }
    }

    // Likewise a key with no declared window (#5932).
    const bounds = reg.bounds.get(key);
    if (bounds) {
      const breach = firstRangeViolation(bounds, value);
      if (breach) {
        // A grid breach gets its own three fragments rather than being forced
        // through the window template (#6199): "is outside the declared step"
        // and "a value within the allowed step" are both false descriptions of
        // what happened — the value can sit squarely inside every declared
        // bound and still miss the grid, which is the whole point of the check.
        this.reportRejectedEnvOverride(reg, namespace, key, envName, value, breach.kind === 'step'
          ? {
            what: 'does not sit on the declared step grid for',
            detail: `Allowed values: ${breach.declared}.`,
            fix: 'a value on the declared step grid',
          }
          : {
            what: `is outside the declared ${breach.kind} for`,
            detail: `Allowed ${breach.kind}: ${breach.declared}.`,
            fix: `a value within the allowed ${breach.kind}`,
          });
        return null;
      }
    }

    return { envName, value };
  }

  /**
   * Emit the one loud line a rejected `OS_*` override owes its operator, at
   * most once per (env var, value) for the life of the service.
   *
   * **Level is `error`, deliberately.** AGENTS.md → "Degradation log levels"
   * decides this by one question: afterwards, does the system still look normal
   * from the outside while something it claims to honour has not landed? Here
   * it does — the read API answers with a perfectly plausible value tagged with
   * a perfectly plausible source, and nothing anywhere looks broken, while the
   * operator's declared intent is simply not in force. #5152 reached the same
   * verdict for `auth.membership_policy` in `bindAuthSettings` for the same
   * reason, and that case shows the stakes: a typo'd `invite_only` read as
   * `auto` leaves an operator believing the wall is up while every sign-up is
   * auto-bound.
   *
   * **Once, not once per read.** Same section: "Say it once, at the first
   * degradation, not once per failed write." `getNamespace` resolves every
   * specifier in the namespace on every settings page load, so a per-read line
   * would be a firehose — and training people to skim `error` is the
   * mirror-image failure AGENTS.md names in the very next paragraph. Keying the
   * dedupe on the VALUE as well as the var means a genuinely new bad value is
   * still reported: `this.env` may be a live `process.env` reference, so an
   * override can appear or change after registration and must not inherit an
   * earlier line's silence.
   *
   * **No structured `meta`.** Everything an operator needs is in the sentence,
   * and `Logger.redactSensitive` (`packages/core/src/logger.ts`) redacts any
   * meta field whose name merely CONTAINS `key`/`token`/`secret`/`password` —
   * so the obvious `{ key }` / `{ envKey }` field would arrive as
   * `***REDACTED***` and delete the diagnostic while looking complete (#5573).
   */
  private reportRejectedEnvOverride(
    reg: RegisteredManifest,
    namespace: string,
    key: string,
    envName: string,
    offending: unknown,
    /**
     * What this particular declaration refused, as the three fragments the one
     * sentence template needs. Passed in rather than branched on here so a
     * third constraint family reuses the dedupe, the redaction rule and the
     * consequence/fix prose instead of growing a second reporter beside them.
     */
    rejection: { what: string; detail: string; fix: string },
  ): void {
    const dedupeAt = `${envName}=${String(offending)}`;
    if (this.reportedEnvOverrides.has(dedupeAt)) return;
    this.reportedEnvOverrides.add(dedupeAt);

    // An option value is not a secret, but `encrypted` is authorable on ANY
    // specifier — so never echo the rejected value for a key whose contents are
    // held encrypted, in a message that lands in logs. Same rule, same reason,
    // as the save path's `invalid_option` error.
    const secret = reg.encryptedKeys.has(key);
    const rejected = secret ? '' : ` Rejected value: '${String(offending)}'.`;
    const message =
      `[SettingsService] env override ${envName} ${rejection.what} ` +
      `setting '${namespace}.${key}' — IGNORED.${rejected} ${rejection.detail} ` +
      `Consequence: this override does NOT take effect and nothing else looks wrong — ` +
      `'${namespace}.${key}' resolves from the next layer of the cascade instead ` +
      `(a stored global/tenant/user value, else the manifest default), and reads report ` +
      `THAT layer as the source rather than 'env'. ` +
      `Fix: set ${envName} to ${rejection.fix}, or unset it and configure ` +
      `'${namespace}.${key}' through the settings UI.`;

    if (this.logger?.error) this.logger.error(message);
    else console.error(message);
  }

  /** Look up a manifest, or throw `UnknownNamespaceError`. */
  getManifest(namespace: string): SettingsManifest {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    return reg.manifest;
  }

  /**
   * [Finding-1] Capability a manifest demands for an operation. Reads default to
   * `setup.access`; writes default to the manifest's `writePermission`, falling
   * back to its `readPermission`, then `setup.access` — so a write ALWAYS
   * requires at least as much as a read and is never ungated.
   */
  private requiredCapability(m: SettingsManifest, op: 'read' | 'write'): string {
    return op === 'read'
      ? (m.readPermission ?? 'setup.access')
      : (m.writePermission ?? m.readPermission ?? 'setup.access');
  }

  /**
   * [Finding-1] Enforce the manifest's capability for an ENFORCED (HTTP-boundary)
   * caller. Trusted in-process callers (`enforced` unset) are never gated — the
   * seed/boot paths that call the service directly keep full access.
   */
  private assertPermitted(m: SettingsManifest, op: 'read' | 'write', ctx: SettingsContext): void {
    if (!ctx.enforced) return;
    const required = this.requiredCapability(m, op);
    const held = new Set(ctx.permissions ?? []);
    if (!held.has(required)) {
      throw new SettingsForbiddenError(m.namespace, required, op);
    }
  }

  /** List all registered manifests, optionally filtered by permission. */
  listManifests(ctx: SettingsContext = {}): SettingsManifest[] {
    const perms = new Set(ctx.permissions ?? []);
    const all = Array.from(this.registry.values()).map((r) => r.manifest);
    // Empty permissions ⇒ pass-through ONLY for a trusted (non-enforced)
    // in-process caller. An ENFORCED HTTP caller with no capabilities sees only
    // the manifests it may read — never the whole set (Finding-1: an
    // unauthenticated request previously enumerated every namespace).
    if (perms.size === 0 && !ctx.enforced) return all;
    return all.filter((m) => perms.has(this.requiredCapability(m, 'read')));
  }

  /** Register a handler for an `action_button` declared in a manifest. */
  registerAction(namespace: string, actionId: string, handler: SettingsActionHandler): void {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    reg.actions.set(actionId, handler);
  }

  // ---------------------------------------------------------------------
  // Resolver
  // ---------------------------------------------------------------------

  /** Resolve a single key. */
  async get<T = unknown>(
    namespace: string,
    key: string,
    ctx: SettingsContext = {},
  ): Promise<ResolvedSettingValue<T>> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    if (!reg.scopes.has(key)) throw new UnknownKeyError(namespace, key);

    // 1. OS_* env — but only when the override is actually in force.
    //
    // #5204: the `options` table is an ENFORCEMENT surface on this side too.
    // `setMany` has checked it since #5131, yet an env override reached the
    // effective value without passing through that path at all, and did so at
    // the TOP of the cascade with `locked: true` — so `OS_MAIL_PROVIDER=sendgrid`
    // handed the mail plugin the exact value #5094 had just retired, through the
    // one door nobody was watching. `coerceEnvValue` only ever reshaped the
    // string by the default's type; it never consulted the enumeration.
    //
    // A rejected value is IGNORED rather than repaired: there is no honest way to
    // guess which declared option a typo meant, and guessing is worse than not
    // applying it (#5152, on `invite_only` silently read as `auto`). Ignored
    // means the env layer contributes NOTHING here — no value and, critically,
    // no `cascadeChain` entry: an `env` entry carrying `locked: true` would be
    // picked up by the `lockedEntry` scan below and reported as locking a value
    // it is not even providing, which is the opposite of what the read API owes
    // its caller.
    const envOverride = this.effectiveEnvOverride(reg, namespace, key);
    if (envOverride) {
      const { envName, value } = envOverride;
      return {
        value: value as T,
        source: 'env',
        locked: true,
        lockedReason: `Set via env: ${envName}`,
        cascadeChain: [
          { scope: 'env', value, locked: true, lockedReason: `Set via env: ${envName}`, effective: true },
        ],
      };
    }

    const scope = reg.scopes.get(key)!;
    // For 'user' scope we pre-filter by user_id; for 'tenant' and 'global'
    // we load everything for the namespace and pick the right row below.
    const rows = await this.loadRows(namespace, scope === 'user' ? ctx.userId ?? null : null);

    // 2. cascade walk — OS_* env (handled above) > global > tenant > user > default
    //
    // Build the full chain in declared order so the UI can render
    // "Inherited from Global / Locked by Global / Overrides tenant"
    // badges. The first non-null entry wins as `source`.
    const chain: NonNullable<ResolvedSettingValue['cascadeChain']> = [];

    const globalRow = rows.find((r) => r.key === key && r.scope === 'global');
    if (globalRow) {
      const value = await this.materialiseRow(globalRow);
      chain.push({
        scope: 'global',
        value,
        locked: !!globalRow.locked,
        lockedReason: globalRow.locked_reason ?? undefined,
      });
    }

    if (scope === 'tenant' || scope === 'user') {
      const tenantRow = rows.find((r) => r.key === key && r.scope === 'tenant');
      if (tenantRow) {
        chain.push({
          scope: 'tenant',
          value: await this.materialiseRow(tenantRow),
          locked: !!tenantRow.locked,
          lockedReason: tenantRow.locked_reason ?? undefined,
        });
      }
    }

    if (scope === 'user') {
      const userRow = rows.find((r) => r.key === key && r.scope === 'user');
      if (userRow) {
        chain.push({
          scope: 'user',
          value: await this.materialiseRow(userRow),
        });
      }
    }

    const def = reg.defaults.get(key);
    chain.push({ scope: 'default', value: def ?? null });

    // Effective row: highest priority entry. Lock anywhere up the chain
    // locks the effective value (lower scopes can't shadow it).
    const lockedEntry = chain.find((e) => e.locked === true);
    const effective = chain.find((e) => e.value !== null && e.value !== undefined) ?? chain[chain.length - 1];
    effective.effective = true;

    return {
      value: effective.value as T,
      source: effective.scope as ResolvedSettingValue['source'],
      locked: !!lockedEntry,
      lockedReason: lockedEntry?.lockedReason,
      cascadeChain: chain,
    };
  }

  /** Resolve every value in a namespace + return the manifest. */
  async getNamespace(
    namespace: string,
    ctx: SettingsContext = {},
  ): Promise<SettingsNamespacePayload> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    // [Finding-1] Reading a namespace's values requires the manifest's read
    // capability for an enforced (HTTP) caller.
    this.assertPermitted(reg.manifest, 'read', ctx);

    const values: Record<string, ResolvedSettingValue> = {};
    for (const [key] of reg.scopes) {
      values[key] = await this.get(namespace, key, ctx);
    }
    return { manifest: reg.manifest, values };
  }

  /**
   * The namespace's secret-backed keys — every specifier declared
   * `encrypted: true` or `type: 'password'` (#7522).
   *
   * Published so the REST boundary can redact exactly the values this service
   * encrypts, reading the SAME set `setMany` consults to decide what gets
   * encrypted at all. Re-deriving the predicate at the boundary is how the two
   * sides drift into "encrypted on write, cleartext on read", which is the
   * defect this accessor exists to close.
   *
   * Note what it deliberately does NOT do: the values themselves keep coming
   * back as plaintext from `get()` / `getNamespace()` / `snapshotOf()`, because
   * in-process consumers (the mail, sms, storage and auth plugins, via
   * `createClient()`) need the real secret. Redaction is the caller's step, and
   * belongs to the REST read boundary only.
   *
   * Throws `UnknownNamespaceError` for an unregistered namespace rather than
   * answering an empty set: "I don't know this namespace" must never read as
   * "nothing here is secret".
   */
  secretKeysOf(namespace: string): ReadonlySet<string> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    return reg.encryptedKeys;
  }

  // ---------------------------------------------------------------------
  // Reactive client (Phase 1)
  // ---------------------------------------------------------------------

  /**
   * Build a reactive `ISettingsClient` for a namespace.
   *
   * The client maintains an internal snapshot of the resolved values,
   * refreshing on every `settings:changed` event for the namespace.
   * Consumers call `current` / `get(key)` for synchronous reads and
   * register handlers via `onChange()`.
   *
   * `schema` is optional. When supplied, the snapshot is parsed (and
   * defaulted) through the Zod schema on each refresh — this gives
   * plugins strong types and runtime validation in one call. When
   * absent, raw resolved values flow through unchanged (used by the
   * dynamic console UI which validates per-field).
   */
  async createClient<T extends Record<string, unknown> = Record<string, unknown>>(
    namespace: string,
    opts: {
      ctx?: SettingsContext;
      parse?: (raw: Record<string, unknown>) => T;
    } = {},
  ): Promise<{
    readonly namespace: string;
    readonly current: T;
    get<K extends keyof T>(key: K): T[K];
    onChange(handler: SettingsChangeHandler): SettingsUnsubscribe;
    refresh(): Promise<void>;
    dispose(): void;
  }> {
    const ctx = opts.ctx ?? {};
    let snapshot: T = await this.snapshotOf<T>(namespace, ctx, opts.parse);

    const off = this.subscribe(namespace, () => {
      // Fire-and-forget refresh; new readers see the latest snapshot.
      void this.snapshotOf<T>(namespace, ctx, opts.parse).then((next) => {
        snapshot = next;
      });
    });

    return {
      namespace,
      get current() {
        return snapshot;
      },
      get<K extends keyof T>(key: K): T[K] {
        return snapshot[key];
      },
      onChange: (handler) => this.subscribe(namespace, handler),
      refresh: async () => {
        snapshot = await this.snapshotOf<T>(namespace, ctx, opts.parse);
      },
      dispose: off,
    };
  }

  private async snapshotOf<T>(
    namespace: string,
    ctx: SettingsContext,
    parse?: (raw: Record<string, unknown>) => T,
  ): Promise<T> {
    const payload = await this.getNamespace(namespace, ctx);
    const raw: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(payload.values)) raw[k] = v.value;
    return parse ? parse(raw) : (raw as T);
  }

  // ---------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------

  /**
   * Fail-closed gate for `encryptedKeys` writes (#8026).
   *
   * Refuses when BOTH credential paths are unavailable: no
   * `cryptoProvider` + `secretStore` pair (the Phase 3 `sys_secret` path), and
   * an inline {@link CryptoAdapter} that declares no confidentiality — i.e.
   * the `NoopCryptoAdapter` default, whose `encrypt()` is base64. Anything
   * that CAN protect the value is left alone: an injected KMS-backed adapter
   * keeps working exactly as before, and so does the `sys_secret` path the
   * shipped plugin wires.
   *
   * ## Boot vs write
   *
   * The card asked for this to be loud at boot. It cannot be *refused* at
   * boot: `SettingsServicePlugin` constructs the service in `init()` and binds
   * the real provider later, at `kernel:ready`, so a construction-time throw
   * would refuse every shipped deployment — and a namespace with no encrypted
   * specifier needs no provider at all. The refusal therefore lands at the
   * write, where the fact is finally knowable, and the LOUDNESS lands here:
   * one operator-actionable line through the deployment's own logger the first
   * time a given key is refused. A caller that swallows the thrown error still
   * leaves that line behind.
   *
   * Reads are deliberately NOT gated: `NoopCryptoAdapter.decrypt` still
   * decodes existing `b64:` rows, so a deployment that already wrote some can
   * still read them, report them, and migrate them. Refusing those reads too
   * would strand exactly the data this refusal exists to stop producing.
   */
  private assertEncryptionAvailable(namespace: string, key: string): void {
    if (this.cryptoProvider && this.secretStore) return;
    if (providesConfidentiality(this.crypto)) return;

    const err = new SettingsCryptoUnavailableError(namespace, key);
    const dedupeAt = `${namespace}.${key}`;
    if (!this.reportedCryptoRefusals.has(dedupeAt)) {
      this.reportedCryptoRefusals.add(dedupeAt);
      const message = `[SettingsService] ${err.message}`;
      if (this.logger?.error) this.logger.error(message);
      else console.error(message);
    }
    throw err;
  }

  /** Persist a single key. Throws SettingsLockedError when env-locked. */
  async set(
    namespace: string,
    key: string,
    value: unknown,
    ctx: SettingsContext = {},
  ): Promise<ResolvedSettingValue> {
    return (await this.setMany(namespace, { [key]: value }, ctx))[key];
  }

  /** Persist multiple keys atomically (best-effort). */
  async setMany(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: SettingsContext = {},
  ): Promise<Record<string, ResolvedSettingValue>> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    // [Finding-1] Writing requires the manifest's write capability for an
    // enforced (HTTP) caller. Checked BEFORE any lock/validation work so an
    // unauthorized write is rejected outright (this is the gate that was
    // missing — the write path previously trusted a spoofable header identity).
    this.assertPermitted(reg.manifest, 'write', ctx);

    // Pre-flight: reject the whole batch if any key is locked or unknown.
    for (const key of Object.keys(patch)) {
      if (!reg.scopes.has(key)) throw new UnknownKeyError(namespace, key);
      // An env override pins the key against writes — but only one that is IN
      // FORCE (#5204). This used to trigger on the mere PRESENCE of the
      // variable, which after the read-side gate would have produced a key
      // configurable by nothing at all: the env value rejected and ignored, the
      // UI refused with `SETTINGS_LOCKED`, and `get()` reporting `locked: false`
      // to a settings page that would then fail its own save. See
      // `effectiveEnvOverride`.
      if (this.effectiveEnvOverride(reg, namespace, key)) {
        throw new SettingsLockedError(namespace, key);
      }

      // Phase 2 lock: a row at an upper scope marked locked=true
      // refuses writes at this (lower) scope. Writing AT the same
      // scope as the lock is still permitted (i.e. a platform admin
      // can edit a globally-locked value; a tenant admin cannot).
      const scope = reg.scopes.get(key)!;
      const rows = await this.loadRows(namespace, scope === 'user' ? ctx.userId ?? null : null);
      const upper = rows.find(
        (r) =>
          r.key === key &&
          r.locked === true &&
          this.scopeRank(r.scope) < this.scopeRank(scope),
      );
      if (upper) {
        throw new SettingsLockedError(namespace, key, `locked-by-${upper.scope}`);
      }
    }

    // Reject writes that would leave the namespace in a known-broken
    // state (visible required field empty / pattern mismatch). See
    // validatePatch for the exact semantics.
    await this.validatePatch(namespace, patch, ctx);

    // #8026 — a declared-encrypted key with nothing able to encrypt it fails
    // the WHOLE batch, here, rather than part-way down the write loop below.
    // The persist site enforces the same rule (that is the load-bearing half);
    // this pass is what keeps a refused batch from leaving the namespace
    // half-written.
    //
    // Ordered AFTER `validatePatch` deliberately. Both refuse the whole batch,
    // but they address different people: a validation error names something the
    // CALLER can fix in the form they are looking at, while this one names a
    // deployment the caller cannot reconfigure. Checked first, it would mask
    // every field-level diagnostic on a namespace that happens to carry a
    // secret. Clearing a key (null/undefined) is exempt throughout: there is no
    // plaintext to protect, and an operator must always be able to REMOVE a
    // value on a deployment that cannot store one.
    for (const [key, submitted] of Object.entries(patch)) {
      if (submitted === null || typeof submitted === 'undefined') continue;
      if (!reg.encryptedKeys.has(key)) continue;
      this.assertEncryptionAvailable(namespace, key);
    }

    for (const [key, rawValue] of Object.entries(patch)) {
      const scope = reg.scopes.get(key)!;
      // global rows are platform-wide (tenant_id=null, user_id=null);
      // user rows pin to ctx.userId; tenant rows leave user_id null and
      // let the engine's tenant scoping fill in tenant_id from ctx.
      const userId = scope === 'user' ? ctx.userId ?? null : null;
      const isEncrypted = reg.encryptedKeys.has(key);
      const isNull = rawValue === null || typeof rawValue === 'undefined';

      let storedValue: unknown | null = null;
      let storedEnc: string | null = null;
      let digest = '';

      if (!isNull) {
        if (isEncrypted) {
          const plain = typeof rawValue === 'string' ? rawValue : JSON.stringify(rawValue);
          // Phase 3 split: when a sys_secret store + ICryptoProvider are
          // wired, persist the ciphertext in sys_secret and keep the
          // handle id in sys_setting.value_enc. Otherwise fall back to
          // the legacy inline crypto adapter path for back-compat.
          if (this.cryptoProvider && this.secretStore) {
            const handle = await this.cryptoProvider.encrypt(plain, {
              namespace,
              key,
              tenantId: ctx.tenantId,
            });
            await this.secretStore.insert({
              id: handle.id,
              namespace,
              key,
              kms_key_id: handle.kmsKeyId,
              alg: handle.alg,
              version: handle.version,
              ciphertext: handle.ciphertext,
            });
            storedEnc = handle.id;
            digest = this.cryptoProvider.digest(plain);
          } else {
            // #8026 — the legacy inline-adapter path persists only through an
            // adapter that declares real confidentiality. The base64 default
            // is refused here rather than silently writing a reversible
            // `value_enc` that reads as protected. Kept AT the write (not only
            // in the pre-flight above) so no future caller can reach this
            // branch and fall open.
            this.assertEncryptionAvailable(namespace, key);
            storedEnc = await this.crypto.encrypt(plain, { namespace, key });
            digest = this.crypto.digest(plain);
          }
        } else {
          storedValue = rawValue;
          digest = this.crypto.digest(stableStringify(rawValue));
        }
      }

      // Hoisted so the reap below can re-read the SAME row this write targeted
      // (#8262) — the composite key is what makes the verification meaningful.
      const rowForKey: SettingsRow = {
        namespace,
        key,
        scope,
        user_id: userId,
        value: storedValue,
        value_enc: storedEnc,
        encrypted: isEncrypted,
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId ?? null,
      };
      const previousEnc = await this.upsertRow(rowForKey);

      // Destroy the ciphertext the row USED to name (#8030) — but only once a
      // re-read confirms the row really stopped naming it (#8262); "a new
      // ciphertext was written" is not evidence that the repoint landed.
      // Ordered after the repoint on purpose, and never allowed to fail the
      // write — a guarantee that now covers the verification read as well as
      // the delete; see `reapRotatedSecret`. Not gated on `isEncrypted`: a key
      // that STOPS being encrypted (a manifest edit) orphans its handle in
      // exactly the same way, and the helper is self-guarding.
      await this.reapRotatedSecret(rowForKey, previousEnc, storedEnc);

      if (this.audit) {
        try {
          await this.audit.record({
            namespace,
            key,
            scope,
            userId: ctx.userId,
            // [#8145] The ledger row's tenant context. Its absence is what makes
            // an audit row invisible to RLS readers — see `SettingsAuditSink`.
            tenantId: ctx.tenantId,
            action: isNull ? 'reset' : 'set',
            valueDigest: isEncrypted ? '<encrypted:' + digest + '>' : digest,
            encrypted: isEncrypted,
            requestId: ctx.requestId,
          });
        } catch {
          // [#8145] Never fail a write because a ledger is unhappy — the same
          // rule `auditWriter` below has always had, now applied to both sinks.
          // Load-bearing rather than defensive: this sink writes `sys_audit_log`,
          // owned by the OPTIONAL plugin-audit, so on a deployment without that
          // plugin the insert throws on every single settings write. The sink
          // the plugin supplies swallows and reports on its own; this guard is
          // what protects a HOST-supplied sink from taking down the write path.
        }
      }

      if (this.auditWriter) {
        try {
          await this.auditWriter.write({
            namespace,
            key,
            scope,
            action: isNull ? 'reset' : 'set',
            source: 'api',
            actorId: ctx.userId,
            oldHash: null,
            newHash: isNull ? null : digest,
            encrypted: isEncrypted,
            requestId: ctx.requestId,
          });
        } catch {
          // never fail a write because the audit table is unhappy.
        }
      }

      this.emitChange({
        namespace,
        key,
        scope,
        action: isNull ? 'reset' : 'set',
        at: new Date().toISOString(),
      });
    }

    // Re-resolve so callers see the post-write effective values.
    const out: Record<string, ResolvedSettingValue> = {};
    for (const key of Object.keys(patch)) {
      out[key] = await this.get(namespace, key, ctx);
    }
    return out;
  }

  /**
   * Save-time validation for `setMany`, fulfilling the spec promise that
   * `required` is enforced server-side and hidden specifiers are not
   * validated. Semantics, tuned to reject broken configs without
   * breaking unrelated single-key writes:
   *
   * - The post-write value map is computed (current values overlaid
   *   with the patch; `null` patch entries fall back to the default).
   * - A specifier is checked only when the patch TOUCHES it — its own
   *   key is in the patch, or a key its `visible` expression references
   *   is (switching provider must validate that provider's fields).
   * - `required` + visible + empty → rejected.
   * - `pattern` (text fields) + non-empty value that mismatches → rejected.
   * - `options` (`select`/`radio`/`multiselect`) + non-empty value outside
   *   the declared table → rejected (`invalid_option`) — unless the specifier
   *   declares a `valueDomain`, which moves the boundary (next bullet).
   * - `valueDomain` (#5712) + non-empty value that is not a member of the
   *   declared standard → rejected (`invalid_value`). The domain REPLACES the
   *   option table as the membership boundary: `options` degrades to a UI
   *   convenience list, so a value outside `options` but inside the domain is
   *   accepted. Judged AFTER `pattern` — shape and membership narrow
   *   independently and a value must satisfy both, but the shape breach is the
   *   coarser, more actionable fact (same one-error-per-key ordering argument
   *   as window-before-grid).
   * - `min` / `max` / `minLength` / `maxLength` + non-empty value outside the
   *   declared window → rejected (`min_value` / `max_value` / `min_length` /
   *   `max_length`, #5932).
   * - `step` + non-empty numeric value that misses the declared grid
   *   (`min + k * step`, or `k * step` where no `min` is declared) → rejected
   *   (`invalid_value`, #6199).
   * - All-null patches (namespace reset) skip validation rather than block the
   *   write.
   * - A `visible` predicate `evaluateVisibility` cannot parse → the write is
   *   REFUSED (`invalid_value`, #7169). See §Unparseable `visible` below for
   *   why this one is not lenient like its neighbours, and why it carries no
   *   TOUCH gate.
   *
   * The TOUCH gate is what keeps the options check from being a regression
   * for existing workspaces: a value that pre-dates a manifest's current
   * option table (a `mail.provider` of `sendgrid`, retired in #5094) only
   * fails the patch that writes that key. A patch changing `from_name`
   * alone is not rejected because a stale `provider` sits in the store —
   * otherwise every workspace carrying historical drift would be locked out
   * of its own settings page, unable to edit anything, which is worse than
   * the gap this closes. The value-window check (#5932) inherits that gate
   * for the same reason and one more: bounds get TIGHTENED over a product's
   * life (a `password_min_length` floor raised from 6 to 8), and a workspace
   * sitting below the new floor must still be able to edit its unrelated
   * settings — it is told about the key only when it writes that key.
   *
   * At most one `FieldError` per offending key: every branch above `continue`s
   * once it has spoken, so a client is handed the first constraint the value
   * broke rather than a pile it must rank itself.
   *
   * ## Unparseable `visible` — the one branch that fails CLOSED (#7169)
   *
   * Maintainer ruling, 2026-08-10: *"save-time validation must refuse a
   * `visible` predicate the actual evaluator cannot parse — a silent skip of
   * the `required` gate is the worst failure class this repo names."*
   *
   * Until then this branch read `catch { continue; // stay lenient }`, and the
   * `continue` skipped the **whole specifier**. That is the asymmetry that
   * justifies breaking ranks with the lenient neighbours listed above: an
   * uncompilable `pattern` or a missing `options` table disables ONE check on
   * ONE key, and the rest of the specifier is still judged. `visible` is the
   * gate every other check hangs off, so an unparseable one switches off
   * `required`, `options`, `pattern`, `valueDomain` and the value window at
   * once — invisibly, with no diagnostic anywhere, for as long as the manifest
   * stands.
   *
   * **No TOUCH gate here, deliberately.** The gate above exists for stored
   * VALUES that pre-date a manifest's current constraints — data a workspace
   * cannot fix from a settings page it would be locked out of. This is not a
   * value fault: the defect is in the MANIFEST, it is the same for every
   * workspace running that code, and the fix is a one-line edit by whoever
   * ships the manifest. Gating it on touch would hide it again in exactly the
   * shape #7169 measured — the console posts only its dirty keys, so a
   * half-filled form never touches the empty `required` field whose predicate
   * is broken, and the refusal would never fire on the incident it exists for.
   * Resets still work: an all-null patch returns before this loop, so a
   * namespace whose manifest is broken can always be cleared.
   *
   * The predicate source travels in `constraint.visible` and is NOT redacted
   * for `encrypted` keys, unlike the value-bearing branches below: a `visible`
   * expression is manifest content that `GET /api/settings/:ns` already serves
   * to the console in full. It is the author's own text, never a stored secret.
   */
  private async validatePatch(
    namespace: string,
    patch: Record<string, unknown>,
    ctx: SettingsContext,
  ): Promise<void> {
    const reg = this.registry.get(namespace);
    if (!reg) return;
    const entries = Object.entries(patch);
    if (entries.length === 0) return;
    // An all-null patch is a reset — clearing values is never blocked.
    if (entries.every(([, v]) => v === null || typeof v === 'undefined')) return;

    // Post-write value map: resolved values overlaid with the patch.
    const data: Record<string, unknown> = {};
    for (const [key] of reg.scopes) {
      data[key] = (await this.get(namespace, key, ctx)).value;
    }
    for (const [key, value] of entries) {
      data[key] = value === null || typeof value === 'undefined'
        ? reg.defaults.get(key) ?? null
        : value;
    }

    const patchKeys = new Set(Object.keys(patch));
    // One `FieldError` per offending key (ADR-0114). The constraint kind is
    // known HERE and nowhere later — the route that serves this used to receive
    // a `key → message` map and could only re-emit the prose — so the code is
    // stamped at the point the check fails rather than inferred from the text.
    const errors: FieldError[] = [];

    for (const spec of (reg.manifest.specifiers ?? []) as Array<Record<string, unknown>>) {
      const key = spec.key as string | undefined;
      const type = String(spec.type ?? '');
      if (!key || LAYOUT_ONLY_TYPES.has(type)) continue;

      const label = typeof spec.label === 'string' ? spec.label : key;

      let visible = true;
      let deps: string[] = [];
      if (typeof spec.visible !== 'undefined') {
        try {
          visible = evaluateVisibility(spec.visible, data);
          deps = referencedKeys(spec.visible);
        } catch (err) {
          // Fail CLOSED (#7169) — see §Unparseable `visible` in the doc comment
          // above for the ruling, the asymmetry with the lenient branches, and
          // why there is no TOUCH gate on this one.
          const source = visibilitySource(spec.visible) ?? String(spec.visible);
          const detail = err instanceof VisibilityParseError
            ? err.detail
            : err instanceof Error ? err.message : String(err);
          errors.push({
            field: key,
            // `invalid_value` is ADR-0114's declared slot for "rejected for a
            // reason no other member names" — the same reading #5712 and #6199
            // took. Nothing in the closed catalog names a manifest-side
            // declaration fault, and inventing a member for one service's
            // manifest format is precisely the friction that catalog is for.
            code: 'invalid_value',
            message:
              `${label} declares a visibility predicate this service cannot evaluate: ${detail}. ` +
              `The write is refused rather than accepted with this field's declared constraints ` +
              `silently unenforced — fix the manifest's \`visible\` expression.`,
            label,
            // The predicate as a discrete value, so a client can name WHICH
            // expression refused without parsing the sentence (`FieldError.
            // constraint`, ADR-0114). Spelled `visible` — the manifest property
            // it comes from — like every other constraint key here.
            constraint: { visible: source },
          });
          continue;
        }
      }
      if (!visible) continue;
      if (!patchKeys.has(key) && !deps.some((d) => patchKeys.has(d))) continue;

      const value = data[key];
      const empty =
        value === null || typeof value === 'undefined' ||
        (typeof value === 'string' && value.trim() === '');

      if (spec.required === true && empty) {
        errors.push({
          field: key,
          code: 'required',
          message: `${label} is required for this configuration.`,
          label,
        });
        continue;
      }

      // A declared standard value domain (#5712) moves the enforcement
      // boundary off the option table: `options` is a UI convenience list for
      // a domain-bearing specifier, so the exhaustive check below is skipped
      // and the domain's membership is judged instead (after `pattern`, in its
      // own branch). `knownValueDomain` filters to enforceable members, so a
      // misspelt domain on a hand-built manifest leaves the #5131 semantics
      // in force rather than opening an accept-everything hole.
      const domain = knownValueDomain(spec.valueDomain);

      // A `select`/`radio`/`multiselect` value must be a member of the option
      // table the manifest declares. Until this check existed the `options`
      // list was a front-end convention only — the console dropdown emitted
      // legal values, but `PUT /api/settings/:ns` accepted any string at all,
      // so a script, a migration or AI-authored bootstrap code could write
      // `provider: 'sendgrid'` into a namespace that has no such provider and
      // the write would succeed silently, leaving each consumer to improvise.
      if (!empty && OPTION_BEARING_TYPES.has(type) && !domain) {
        const allowed = declaredOptionValues(spec.options);
        // A manifest with no option table cannot say what is legal. The spec
        // refuses that shape at parse time, but `registerManifest` takes
        // manifests as given (no Zod pass), so skip rather than reject every
        // write to a hand-built manifest — same leniency the unparseable
        // `visible` and invalid `pattern` branches already take.
        if (allowed.length > 0) {
          // Shared with the env path (#5204) — see `firstRejectedOption` for the
          // array/scalar handling and why the result is wrapped.
          const rejected = firstRejectedOption(allowed, value);
          if (rejected) {
            const offending = rejected.value;
            // An option value is not a secret, but `encrypted` is authorable on
            // any specifier — so never echo the rejected value for a key whose
            // contents are held encrypted, in a message that lands in logs.
            const secret = reg.encryptedKeys.has(key);
            const got = secret ? '' : ` Received '${String(offending)}'.`;
            errors.push({
              field: key,
              code: 'invalid_option',
              message: `${label} must be one of: ${allowed.join(', ')}.${got}`,
              label,
              // The allowed set as a discrete constraint, so a client composes
              // its own sentence instead of parsing ours (`FieldError.
              // constraint`, ADR-0114). Key and comma-joined form are the ones
              // the spec's own `{ allowed: 'draft, sent' }` example documents
              // and the record validator already emits for this same code.
              constraint: { allowed: allowed.join(', ') },
              ...(secret ? {} : { value: String(offending) }),
            });
            continue;
          }
        }
      }

      // Shared with the env path (#6580) — see `firstPatternMiss` for the
      // string-shape applicability and `declaredPattern` for the
      // invalid-RegExp tolerance (unchanged: an uncompilable manifest pattern
      // never blocks writes).
      if (!empty) {
        const declared = declaredPattern(spec.pattern);
        if (declared && firstPatternMiss(declared, value)) {
          const hint = typeof spec.description === 'string' ? ` ${spec.description}` : '';
          errors.push({
            field: key,
            code: 'invalid_format',
            message: `${label} does not match the expected format.${hint}`,
            label,
            // The declared pattern, so a client can format its own message
            // rather than parsing ours (`FieldError.constraint`, ADR-0114).
            constraint: { pattern: declared.source },
          });
          continue;
        }
      }

      // A declared standard value domain is enforced at save time (#5712).
      // `pattern` has already spoken above — shape and membership narrow
      // independently and a value must satisfy both — so what arrives here is
      // shape-valid, and the question is purely whether the standard's
      // membership admits it (`Mars/Olympus` is a shape-valid time zone that
      // does not exist; `ZZ` matches `^[A-Za-z]{2}$` and is assigned to
      // nobody). No `FieldErrorCode` member names a standard-domain breach, so
      // it takes `invalid_value` — the catalog's declared slot for "rejected
      // for a reason no other member names" (ADR-0114), the same verdict the
      // step grid reached in #6199. `invalid_option` would be a lie about
      // which set was consulted: the declared options are exactly the list a
      // domain-bearing value may legitimately be outside of.
      if (!empty && domain) {
        const rejected = firstRejectedDomainMember(domain, value);
        if (rejected) {
          const offending = rejected.value;
          const { member, example } = valueDomainPhrasing(domain);
          // Same redaction rule as `invalid_option`, same reason: a domain
          // member is not a secret, but `encrypted` is authorable on any
          // specifier and this message travels back through the API and into
          // logs.
          const secret = reg.encryptedKeys.has(key);
          const got = secret ? '' : ` Received '${String(offending)}'.`;
          errors.push({
            field: key,
            code: 'invalid_value',
            message: `${label} must be a valid ${member} (e.g. '${example}').${got}`,
            label,
            // The declared domain, spelled by the property it comes from
            // (`FieldError.constraint`, ADR-0114), so a client can branch on
            // WHICH membership refused without parsing the sentence.
            constraint: { valueDomain: domain },
            ...(secret ? {} : { value: String(offending) }),
          });
          continue;
        }
      }

      // A declared value window is enforced at save time (#5932). Until this
      // branch existed `min`/`max`/`minLength`/`maxLength` were, like the
      // `options` table before #5131, a front-end convention: the console
      // number input clamps to the declared bounds, so an admin going through
      // the UI could not produce a bad one — but `PUT /api/settings/:ns` is an
      // authorizable public surface, and a script, a migration or AI-authored
      // bootstrap code could write anything at all. The load-bearing case is
      // `auth.password_min_length`, which declares `min: 6` and accepted `1`
      // (and negatives): the value reaches better-auth's password policy and
      // is honoured there, so the declaration was the only thing claiming a
      // floor existed and nothing was holding it.
      //
      // `step` (#6199) is the fifth and last of the value constraints
      // `SpecifierSchema` declares, and it joins the family here rather than
      // getting a branch of its own. The reading that settles it is the
      // schema's own: `step` sits under the SAME "numeric bounds and step"
      // comment as `min`/`max`, so it is authored as a bound and a declared
      // bound binds. Read the other way — a pure `input[type=number]` arrow
      // increment — it would have to have a UI consumer to be doing anything,
      // and it has none: `step` had zero read points anywhere in this repo or
      // in `objectui` when this branch was written, which is a declaration
      // enforcing nothing rather than a declaration enforcing presentation.
      if (!empty) {
        const bounds = declaredBounds(spec);
        const breach = bounds ? firstRangeViolation(bounds, value) : null;
        if (breach) {
          // Same redaction rule as `invalid_option`, same reason: a bound is
          // not a secret, but `encrypted` is authorable on any specifier and
          // this message travels back through the API (and into logs).
          const secret = reg.encryptedKeys.has(key);
          const got = secret ? '' : ` Received '${String(value)}'.`;
          errors.push({
            field: key,
            code: breach.code,
            message: breach.kind === 'length'
              ? `${label} must be within the declared length (${breach.declared}).${got}`
              : breach.kind === 'step'
                ? `${label} must line up with the declared step (${breach.declared}).${got}`
                : `${label} must be within the declared range (${breach.declared}).${got}`,
            label,
            // The declared window as discrete values, so a client composes its
            // own sentence instead of parsing ours (`FieldError.constraint`,
            // ADR-0114) — `{ min, max }` for a numeric window, and
            // `{ minLength, maxLength, actual }` for a length one, the keys
            // the spec's own examples and the record validator already use.
            constraint: breach.constraint,
            ...(secret ? {} : { value }),
          });
        }
      }
    }

    if (errors.length > 0) {
      throw new SettingsValidationError(namespace, errors);
    }
  }

  /**
   * Clear every persisted row in a namespace so values fall back to
   * env/defaults. Env-locked keys are untouched (env wins over rows
   * anyway and refuses writes). Persisted rows are nulled rather than
   * deleted so the audit trail records the reset per key.
   *
   * Returns the number of cleared keys.
   */
  async resetNamespace(namespace: string, ctx: SettingsContext = {}): Promise<number> {
    const payload = await this.getNamespace(namespace, ctx);
    const patch: Record<string, null> = {};
    for (const [key, v] of Object.entries(payload.values)) {
      if (v.source === 'global' || v.source === 'tenant' || v.source === 'user') {
        patch[key] = null;
      }
    }
    const keys = Object.keys(patch);
    if (keys.length > 0) await this.setMany(namespace, patch, ctx);
    return keys.length;
  }

  /** Invoke a declared action (test connection, rotate, …). */
  async runAction(
    namespace: string,
    actionId: string,
    payload: unknown,
    ctx: SettingsContext = {},
  ): Promise<SettingsActionResult> {
    const reg = this.registry.get(namespace);
    if (!reg) throw new UnknownNamespaceError(namespace);
    // [Finding-1] Settings actions (test-connection, rotate, reset, …) are
    // mutating/side-effecting operations — gate them like a write for an
    // enforced (HTTP) caller.
    this.assertPermitted(reg.manifest, 'write', ctx);
    const handler = reg.actions.get(actionId);
    if (!handler) {
      // Built-in fallback: every namespace gets a `reset` action that
      // clears persisted rows (back to env/defaults). Plugins may
      // override it via registerAction for richer behaviour (e.g. the
      // AI plugin re-runs env adapter detection after the clear).
      if (actionId === 'reset') {
        const cleared = await this.resetNamespace(namespace, ctx);
        return {
          ok: true,
          severity: 'info',
          message: cleared > 0
            ? `Cleared ${cleared} saved value(s); environment/default configuration is back in effect.`
            : 'No saved values to clear — already using environment/default configuration.',
        };
      }
      return {
        ok: false,
        severity: 'error',
        message: `No handler registered for action '${actionId}' in '${namespace}'.`,
      };
    }
    const values: Record<string, unknown> = {};
    for (const [key] of reg.scopes) {
      values[key] = (await this.get(namespace, key, ctx)).value;
    }
    try {
      return await handler({ namespace, actionId, values, payload, ctx });
    } catch (err: any) {
      return {
        ok: false,
        severity: 'error',
        message: err?.message ?? 'Action handler threw.',
      };
    }
  }

  // ---------------------------------------------------------------------
  // Persistence helpers (engine or in-memory)
  // ---------------------------------------------------------------------

  private async loadRows(namespace: string, userId: string | null): Promise<SettingsRow[]> {
    if (this.engine) {
      const where: Record<string, unknown> = { namespace };
      if (userId !== null) where.user_id = userId;
      // Settings rows include platform-wide (`global` scope, tenant_id=null)
      // entries; bypass the tenant-scoping audit warning so loads work
      // uniformly across global/tenant/user without log noise. Per-tenant
      // isolation for `tenant`-scope rows is still enforced by the engine
      // once an ExecutionContext.tenantId is plumbed through (Phase 2+).
      const rows = await this.engine.find(this.objectName, {
        where,
        bypassTenantAudit: true,
      } as any);
      return rows.map((r) => ({
        namespace: r.namespace,
        key: r.key,
        scope: r.scope as SpecifierScope,
        user_id: r.user_id ?? null,
        value: r.value ?? null,
        value_enc: r.value_enc ?? null,
        encrypted: Boolean(r.encrypted),
        locked: Boolean(r.locked),
        locked_reason: r.locked_reason ?? null,
        updated_at: r.updated_at,
        updated_by: r.updated_by ?? null,
      }));
    }
    return this.memory.filter(
      (r) =>
        r.namespace === namespace &&
        (userId === null || r.user_id === userId || r.scope === 'tenant' || r.scope === 'global'),
    );
  }

  /**
   * Write one settings row, INSERT-or-UPDATE, and report the `value_enc` the
   * row held **before** the write (`null` when there was no row, or the row
   * carried no handle).
   *
   * ### Why the update is a SYSTEM write (#8030)
   *
   * `sys_setting.value_enc` and `sys_setting.updated_by` are declared
   * `readonly: true` (`packages/platform-objects/src/system/sys-setting.object.ts`),
   * and the engine STRIPS author-declared read-only columns from a
   * **non-system** caller's UPDATE payload (`stripReadonlyFields`, gated on
   * `if (!opCtx.context?.isSystem)` in `packages/objectql/src/engine.ts`). The
   * INSERT path is deliberately exempt from that strip (#3413) — which is
   * exactly why the FIRST write of a secret landed correctly and every later
   * one silently did not: a rotation inserted a fresh `sys_secret` row, got its
   * 200 with a redacted echo and an advanced `updated_at`, and left
   * `value_enc` pointing at the ORIGINAL handle. The leaked credential an
   * admin had just "rotated" was still the one in force.
   *
   * `SettingsService` is a privileged writer: it has already run the
   * manifest's read/write capability gate (`assertPermitted`), the env-lock
   * and upper-scope-lock pre-flight, and `validatePatch` before anything
   * reaches here, and the columns in question are ones IT owns rather than
   * ones a caller forged. So the write is elevated — the same posture, and for
   * the same measured reason, as the roll-up recompute's elevation in
   * `ObjectQL.recomputeSummaries` (#7673): a platform-owned read-only column
   * whose only writer is the platform must be written as the platform.
   *
   * ⚠️ The elevation is deliberately scoped to THIS call and NOT to the field
   * declaration: `value_enc` stays `readonly: true`, so an external caller
   * reaching `sys_setting` directly still cannot repoint a secret handle. That
   * flag is a security control, and removing it is the wrong direction on this
   * defect.
   */
  /**
   * The composite key identifying ONE settings row, in the shape the engine
   * path needs.
   *
   * Extracted rather than repeated (#8262): `reapRotatedSecret`'s verification
   * read has to target **exactly** the row `upsertRow` just wrote. A re-read
   * aimed at a slightly different row would answer a different question while
   * looking correct — and the answer decides whether a ciphertext is deleted.
   */
  private rowIdentity(row: SettingsRow): {
    where: Record<string, unknown>;
    bypass: Record<string, unknown>;
  } {
    return {
      where: {
        namespace: row.namespace,
        key: row.key,
        scope: row.scope,
        user_id: row.user_id ?? null,
      },
      // global rows are platform-wide — bypass the tenant audit warning
      // (we intentionally write tenant_id=null). tenant/user rows still
      // benefit from the warning when ctx.tenantId is missing.
      bypass: row.scope === 'global' ? { bypassTenantAudit: true } : {},
    };
  }

  /** The in-memory store's index for the same composite key. */
  private memoryIndexOf(row: SettingsRow): number {
    return this.memory.findIndex(
      (r) =>
        r.namespace === row.namespace &&
        r.key === row.key &&
        r.scope === row.scope &&
        (r.user_id ?? null) === (row.user_id ?? null),
    );
  }

  /**
   * `value_enc` as a handle-or-nothing. One normalisation for both the value
   * `upsertRow` REPORTS and the value `reapRotatedSecret` COMPARES it against
   * (#8262) — two spellings of "no handle" (`''` vs `null`) diverging across
   * those two call sites would make the comparison decide wrongly.
   */
  private static handleOf(value: unknown): string | null {
    return typeof value === 'string' && value !== '' ? value : null;
  }

  private async upsertRow(row: SettingsRow): Promise<string | null> {
    if (this.engine) {
      const { where, bypass } = this.rowIdentity(row);
      const existing = await this.engine.find(this.objectName, {
        where,
        limit: 1,
        ...bypass,
      } as any);
      if (existing[0]) {
        const previousEnc = (existing[0] as { value_enc?: unknown }).value_enc;
        await this.engine.update(this.objectName, {
          where,
          data: { ...row },
          context: SETTINGS_SYSTEM_WRITE_CONTEXT,
          ...bypass,
        } as any);
        return SettingsService.handleOf(previousEnc);
      }
      await this.engine.insert(this.objectName, { ...row }, bypass as any);
      return null;
    }
    const idx = this.memoryIndexOf(row);
    if (idx >= 0) {
      const previousEnc = this.memory[idx].value_enc;
      this.memory[idx] = row;
      return SettingsService.handleOf(previousEnc);
    }
    this.memory.push(row);
    return null;
  }

  /**
   * Delete the `sys_secret` row a rotated-away handle pointed at (#8030).
   *
   * Reaping rather than accepting the orphans is the security answer, not a
   * tidiness one: the whole point of rotating a leaked SMTP password or
   * provider API key is that the old value stops existing. An orphan row is a
   * decryptable copy of the credential the admin just retired, sitting in
   * `sys_secret` under the same data key, reachable by anyone who can read the
   * table — and it accumulates one row per rotation forever (the filer measured
   * 7 → 8 → 9 across three writes), so the exposure grows with exactly the
   * hygiene we ask operators to practise.
   *
   * Nothing else can reference the handle: ids are minted per `encrypt()` call,
   * `sys_setting.value_enc` is the only column that holds one, and the audit
   * trail records digests (`sha256:…`) rather than handles — so it stays
   * readable after the ciphertext is gone.
   *
   * **Best-effort, and deliberately after the repoint.** The write has already
   * committed by the time this runs; a store that cannot delete (the port's
   * `delete` is optional, so pre-existing fakes and the legacy inline-crypto
   * path simply have none) or a delete that throws must never turn a
   * SUCCESSFUL rotation into an error — the new secret is already in force,
   * which is the property that matters.
   *
   * ## VERIFY the repoint; never infer it (#8262)
   *
   * `previousEnc !== nextEnc` says a new ciphertext was written. It does NOT
   * say the row stopped pointing at the old one — and the two come apart on a
   * `SettingsEngine` adapter that drops `context`: `value_enc` is
   * `readonly: true`, so a non-system UPDATE has it stripped
   * (`stripReadonlyFields`), the row keeps naming `previousEnc`, and deleting
   * on the inference destroys **the ciphertext still in force**.
   * `materialiseRow` then dereferences a dangling handle, gets nothing, and
   * the setting silently reads empty — unrecoverably, because the audit trail
   * records digests rather than handles, so nothing can even name what was
   * lost. That adapter is a documented extension point (see the ⛔ note on
   * `SettingsEngine.update`), which is exactly why the reaper cannot assume
   * the ideal one.
   *
   * So: re-read the row and delete only once storage confirms it no longer
   * names the handle. The criterion is `current !== previousEnc` rather than
   * the narrower `current === nextEnc`, deliberately — under a concurrent
   * rotation the row may already have moved on to a THIRD handle, in which
   * case `previousEnc` is genuinely unreferenced and the narrower test would
   * leak the orphan #8030 exists to prevent. Both refuse the case that
   * matters, where the row still names `previousEnc`.
   *
   * ⚠️ Every refusal branch leaves an ORPHAN, which is the recoverable
   * direction and the one #8103 sweeps. There is no recoverable direction on
   * the other side. And the added read is inside the same best-effort
   * guarantee as the delete: it runs after all cheap guards, only where a
   * destructive delete would otherwise follow, and can never fail the write.
   */
  private async reapRotatedSecret(
    row: SettingsRow,
    previousEnc: string | null,
    nextEnc: string | null,
  ): Promise<void> {
    if (!previousEnc || previousEnc === nextEnc) return;
    // Handles only. The legacy inline-crypto path stores the ciphertext ITSELF
    // in `value_enc`, and there is no `sys_secret` row to reap for it.
    if (!previousEnc.startsWith('sec_')) return;
    const del = this.secretStore?.delete;
    if (!del) return;

    // ── Verification read. Ordered after every cheap guard above so a rotation
    // that cannot reap anything never pays for it. ────────────────────────────
    let current: { found: boolean; handle: string | null };
    try {
      current = await this.readStoredHandle(row);
    } catch (err: any) {
      this.reportReapRefusal(
        `[SettingsService] could not confirm the secret rotation of '${row.namespace}.${row.key}' ` +
          `took effect, so the previous ciphertext '${previousEnc}' was LEFT IN PLACE rather than ` +
          `deleted. The rotation itself SUCCEEDED; that ciphertext is still stored and remains ` +
          `decryptable. Reason: ${err?.message ?? err}`,
      );
      return;
    }
    if (!current.found) {
      this.reportReapRefusal(
        `[SettingsService] could not confirm the secret rotation of '${row.namespace}.${row.key}' ` +
          `took effect — the row could not be read back after the write — so the previous ` +
          `ciphertext '${previousEnc}' was LEFT IN PLACE rather than deleted. It is still stored ` +
          `and remains decryptable.`,
      );
      return;
    }
    if (current.handle === previousEnc) {
      this.reportReapRefusal(
        `[SettingsService] REFUSED to delete rotated secret '${previousEnc}' for ` +
          `'${row.namespace}.${row.key}': the rotation did NOT take effect. The stored row still ` +
          `names that handle, so it is the ciphertext currently IN FORCE and deleting it would ` +
          `destroy the value. The newly written ciphertext (${nextEnc ?? 'none'}) is unreferenced. ` +
          `Cause: the SettingsEngine adapter in use is not forwarding the execution context — ` +
          `sys_setting.value_enc is declared readonly, and the engine strips it from a NON-system ` +
          `UPDATE. Fix the adapter to forward context verbatim, then re-apply the value: as far ` +
          `as storage is concerned this rotation never happened.`,
      );
      return;
    }

    try {
      await del.call(this.secretStore, previousEnc);
    } catch (err: any) {
      // Loud, because the operator's mental model after a rotation is "the old
      // credential is gone" and this is the one branch where it is not.
      this.reportReapRefusal(
        `[SettingsService] rotated secret '${previousEnc}' could not be deleted from ` +
          `sys_secret — the rotation itself SUCCEEDED (the new value is in force), but the ` +
          `previous ciphertext is still stored and remains decryptable. ` +
          `Reason: ${err?.message ?? err}`,
      );
    }
  }

  /**
   * Re-read the row's CURRENT `value_enc` straight from storage (#8262).
   *
   * `found: false` (the row could not be read back at all) is deliberately
   * distinct from `handle: null` (the row exists and holds no handle): the two
   * lead to OPPOSITE decisions in `reapRotatedSecret` — a reset-to-null must
   * still reap, an unreadable row must not.
   */
  private async readStoredHandle(
    row: SettingsRow,
  ): Promise<{ found: boolean; handle: string | null }> {
    if (this.engine) {
      const { where, bypass } = this.rowIdentity(row);
      const rows = await this.engine.find(this.objectName, {
        where,
        limit: 1,
        ...bypass,
      } as any);
      const current = Array.isArray(rows) ? rows[0] : undefined;
      if (!current) return { found: false, handle: null };
      return {
        found: true,
        handle: SettingsService.handleOf((current as { value_enc?: unknown }).value_enc),
      };
    }
    const idx = this.memoryIndexOf(row);
    if (idx < 0) return { found: false, handle: null };
    return { found: true, handle: SettingsService.handleOf(this.memory[idx].value_enc) };
  }

  /**
   * One channel for every branch in which a retired ciphertext outlives the
   * rotation. Loud on purpose: the operator's mental model afterwards is "the
   * old credential is gone", and these are the branches where it is not.
   */
  private reportReapRefusal(message: string): void {
    if (this.logger?.error) this.logger.error(message);
    else console.error(message);
  }

  private async materialiseRow(row: SettingsRow): Promise<unknown> {
    if (row.encrypted) {
      if (!row.value_enc) return null;
      let plain: string;
      try {
        // Phase 3: when the value_enc looks like a sys_secret handle and
        // both the secretStore + cryptoProvider are wired, dereference
        // through sys_secret. Otherwise (legacy rows or in-memory tests)
        // fall back to inline crypto-adapter decryption.
        if (
          this.cryptoProvider &&
          this.secretStore &&
          typeof row.value_enc === 'string' &&
          row.value_enc.startsWith('sec_')
        ) {
          const secret = await this.secretStore.get(row.value_enc);
          if (!secret) return null;
          plain = await this.cryptoProvider.decrypt(
            {
              id: secret.id,
              kmsKeyId: secret.kms_key_id,
              alg: secret.alg,
              version: secret.version,
              ciphertext: secret.ciphertext,
            },
            { namespace: row.namespace, key: row.key },
          );
        } else {
          plain = await this.crypto.decrypt(row.value_enc, {
            namespace: row.namespace,
            key: row.key,
          });
        }
      } catch (err) {
        // Decrypt failures are almost always operational: the crypto
        // provider's data key changed (e.g. InMemoryCryptoProvider
        // generated a fresh ephemeral key after a restart) and the
        // stored AES-GCM auth tag no longer verifies. Bubbling the
        // raw Node error would 500 the entire `getNamespace` request
        // and lock the operator out of the settings UI — including
        // the very inputs they'd use to re-enter the secret. Instead,
        // log once and surface `null` so the field renders as empty
        // and remains editable.
        console.warn(
          `[SettingsService] failed to decrypt ${row.namespace}.${row.key}: ${(err as Error)?.message ?? err}. ` +
            `Returning null so the namespace remains readable; re-save the field to repair.`,
        );
        return null;
      }
      // Try JSON parse so non-string secrets round-trip.
      try {
        return JSON.parse(plain);
      } catch {
        return plain;
      }
    }
    return row.value ?? null;
  }
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

/** Stable stringify so the audit digest is order-independent. */
function stableStringify(input: unknown): string {
  if (input === null || typeof input !== 'object') return JSON.stringify(input);
  if (Array.isArray(input)) return '[' + input.map(stableStringify).join(',') + ']';
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(obj[k])).join(',') + '}';
}

/** Re-typed env coercer (the canonical one lives in settings-service.types). */
function coerceEnvValue(raw: string, hint: unknown): unknown {
  if (typeof hint === 'boolean') return raw === 'true' || raw === '1' || raw === 'yes';
  if (typeof hint === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (Array.isArray(hint) || (hint && typeof hint === 'object')) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return raw;
}
