// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tombstones for RETIRED authorable keys (#3855).
 *
 * This file carries BOTH retirement axes: a retired **key** ({@link retiredKey},
 * plus {@link acceptRetiredDefaultResidue} for one that carried a default), and a
 * retired **value** — one member of a `z.enum` ({@link enumWithRetiredValues},
 * #17109). Everything below is the KEY-level rule; the value-level one is
 * documented on its own helper and differs in what it registers, never in how
 * the prescription reads.
 *
 * Removing a key an author can write has one hard requirement: the removal must
 * be **audible**. When these tombstones were introduced, none of the schemas
 * carrying a deprecated alias was `.strict()`, so deleting the key from the Zod
 * object produced no error at all — it produced a **silent strip**, the exact
 * failure mode #3713 → #3743 → #3838 → #3854 spent four PRs eliminating,
 * reintroduced one layer down. `FieldSchema` recorded the trap biting once
 * (`dataQuality` / `cached` outlived their keys by a release and were silently
 * stripped, #3726 / #3733, the ADR-0104 class).
 *
 * The #4001 campaign has since closed many of those shapes with `strictObject`,
 * and on a closed shape a bare deletion is no longer silent — but it is still
 * not enough, which is why tombstones stay. An unknown-key rejection reports
 * only that the key is unrecognised; it cannot carry the FROM → TO mapping, the
 * ADR the removal rests on, or the migration command. **The prescription is the
 * payload**, so both channels below survive the conversion — and on the shapes
 * that are still non-strict, the silent strip above is still the alternative.
 *
 * A tombstone keeps the key declared but makes it unwritable, so the removal
 * lands in the two channels an upgrading author — very often an AI (ADR-0033) —
 * actually reads:
 *
 *   1. **`tsc`.** The input type becomes `never`, so assigning anything to the
 *      key fails to compile at the authoring site, before anything runs.
 *   2. **The parse.** A value reaching the runtime raises the prescription
 *      itself — not a generic "unrecognized key". This matters because upgrades
 *      do not happen in the order we imagine: someone jumping several majors at
 *      once gets the same message as someone stepping one, whereas a load-time
 *      conversion (ADR-0087 D2) only covers N−1 and would have already retired.
 *
 * The prescription — not a "deprecated" label — is the payload. AGENTS.md
 * ("Removing an authorable spec key also requires a tombstone entry … so the
 * rejection itself carries the prescription") names the compile/validation
 * error as the one upgrade channel every consumer is guaranteed to hit: an
 * agent bumping `@objectstack/spec` sees THIS string, not our docs site. Write
 * it as an instruction, with the FROM → TO mapping and the one-line fix.
 *
 * **The `os migrate meta` sentence is standardized — do not choose a verb.**
 * A prescription whose surface an ADR-0087 conversion covers closes with
 * exactly this sentence, whether the conversion STRIPS the key or REWRITES
 * its value (#6856, maintainer-ruled 2026-08-09; reworded #9529,
 * maintainer-ruled 2026-08-18):
 *
 *     Run `os migrate meta --from <N>` to list the mechanical edits for
 *     existing sources; apply them by hand.
 *
 * The sentence states a property of the TOOL — what running it gets you —
 * never the fate of the key. Two rulings shaped it, and both still bind:
 *
 *   - **It must be TRUE of the tool.** The sentence used to promise
 *     "rewrite existing sources automatically", and `os migrate meta` has
 *     never written an authored source file: it replays the conversion
 *     chain over the loaded stack in memory, prints the attributed
 *     mechanical change list (`Applied N mechanical change(s)`, one line per
 *     site), and writes exactly one file — the `--out` JSON snapshot, when
 *     you ask for it. Porting the listed edits into the project's own `.ts`
 *     sources is the author's work, which is why the sentence says so
 *     (#9529; the in-place AST codemod is commissioned separately as #9591,
 *     and the automatic-rewrite claim may return with it).
 *   - **One antecedent.** The retired "rewrite it" spelling was misread over
 *     strip conversions because "it" names either the key or your sources;
 *     "existing sources" names one thing. The KEY's fate belongs in the body
 *     prose ("Delete the key…", "Rename the key to…"), which every
 *     prescription already carries — the sentence never restates it.
 *
 * ONE exception: a conversion that covers only PART of the value keeps the
 * two-clause form naming which part — "… to list the mechanical edits for
 * the <X> case; <what the tool does with the rest>." (model:
 * `ui/dashboard.zod.ts` `compareTo.offset`). Both shapes are pinned
 * class-wide by `retired-key-migrate-sentence.test.ts`; a new spelling
 * fails the pin, not code review.
 *
 * Tombstones age out, exactly like the `UNKNOWN_KEY_GUIDANCE` entries in
 * `data/object.zod.ts`: drop one ~two majors after the removal, by which point
 * it is archaeology rather than an upgrade (the history lives in CHANGELOG.md).
 */

import { z } from 'zod';

/**
 * Declare a key that has been REMOVED from the spec.
 *
 * Accepts only `undefined` — i.e. absence. Any authored value is rejected with
 * `guidance`, and `z.input` types the key as `never` so the same mistake fails
 * `tsc` first.
 *
 * @param guidance - The upgrade prescription. State what replaced the key, the
 *   version that removed it, and the one-line fix — this string IS the migration
 *   doc for anyone who hits it. When an ADR-0087 conversion covers the surface,
 *   close with the house `os migrate meta` sentence (module docblock above —
 *   the wording is pinned, not a choice).
 *
 * @example
 * ```ts
 * conditionalRequired: retiredKey(
 *   '`conditionalRequired` was removed in @objectstack/spec 17.0.0 (#3855). ' +
 *   'Rename the key to `requiredWhen` — the value (a CEL predicate) is unchanged. ' +
 *   'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.',
 * ),
 * ```
 */
export function retiredKey(guidance: string) {
  return z.never({ error: () => guidance }).optional().describe(`[REMOVED] ${guidance}`);
}

/**
 * The inert residue a RETIRED **DEFAULTED** key leaves behind in built
 * artifacts: retired key name → the default the retired schema used to emit,
 * **captured as a literal at retirement time** (#12840).
 *
 * ⛔ Never derive an entry from anything live. The whole point of the capture
 * is that the default no longer exists anywhere in the schema — the tombstone
 * replaced it — so the only trustworthy record of "what the released toolchain
 * materialized" is the literal written down when the key was retired.
 */
export type RetiredDefaultResidue = Readonly<Record<string, boolean | number | string | null>>;

/**
 * Accept a retired defaulted key's EMITTED DEFAULT as inert residue — and
 * strip it — while every other value keeps the tombstone's loud refusal
 * (#12840; maintainer ruling 2026-08-28, recorded on objectstack-ai/cloud#1685).
 *
 * ## The class of retirement this exists for
 *
 * {@link retiredKey} makes a removal audible in both authoring channels (`tsc`
 * `never` + the parse-time prescription). That is the right posture for a key
 * an author WROTE — but a key that carried a Zod `.default(…)` has a third
 * population nobody authored: **every artifact built by a released toolchain
 * has the key MATERIALIZED at its default in every entry**, because the parse
 * that built the artifact emitted the default. Refusing that emitted default
 * sentences every previously built artifact — marketplace packages, installed
 * environments — to death on the next runtime upgrade, over a value that is
 * behaviourally identical to absence for the key's entire history. (The
 * founding case: `allowRestore`/`allowPurge` after #12497 — the published
 * spec 17.x still emitted `false` for both, 75 occurrences in one real
 * artifact whose sources declare neither.)
 *
 * So a retired **defaulted** key discriminates on the VALUE:
 *
 *   - value `===` the retired default → inert residue: accepted, and STRIPPED
 *     before the shape parses, so the normalized output does not carry the key
 *     and a parse → serialize round-trip converges to the clean shape (no
 *     re-emission). The strip is deliberately SILENT — real artifacts carry
 *     the residue once per permission entry, and a per-occurrence notice would
 *     be a 75-line storm that teaches operators to skim; the loud channels for
 *     authored sources (tsc `never`, `os migrate meta`, the D2 conversion)
 *     are unchanged.
 *   - any other value → the untouched {@link retiredKey} refusal, guidance
 *     byte-for-byte: the key stays a tombstone in the shape, and this wrapper
 *     never runs on a non-default value, so the prescription and the
 *     `expected: 'never'` issue shape are exactly what the retirement ruled.
 *
 * ## Nothing is un-retired
 *
 * The authoring surface keeps every refusal the retirement established: the
 * shape still declares the key as a {@link retiredKey} tombstone (`z.input`
 * stays `never`, so writing the key in TypeScript source fails `tsc` exactly
 * as before), the JSON-schema/authorable-surface artifacts still publish the
 * `[REMOVED]` tombstone row, and a non-default value is refused with the
 * original prescription everywhere. What changes is only the disposition of
 * the **emitted default in already-parsed data** — provenance that JSON cannot
 * carry, which is why the discrimination is by value, as ruled.
 *
 * ## Mechanism and placement
 *
 * A `z.preprocess` stage ahead of the closed shape (the `ViewMetadataSchema` /
 * `translation` retired-dialect precedent — every schema walker resolves a
 * preprocess pipe to its OUT side via `pipeAuthorableSide`, #4488/#5074/#5317).
 * The strip is copy-on-write: an input without residue passes through by
 * reference. The wrapper preserves a read-through `shape` (the inner shape is
 * the authorable truth), but it is NOT a `ZodObject` — `.extend()` a
 * tolerance-wrapped schema by extending the inner object and re-wrapping, the
 * way `EffectiveObjectPermissionSchema` does.
 *
 * The next retirement of a defaulted key reuses this helper with its own
 * captured literal instead of re-inventing the judgement.
 */
export function acceptRetiredDefaultResidue<S extends z.ZodObject<z.ZodRawShape>>(
  schema: S,
  residue: RetiredDefaultResidue,
): z.ZodType<z.output<S>, z.input<S>> & { readonly shape: S['shape'] } {
  const keys = Object.keys(residue);
  const strip = (body: unknown): unknown => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return body;
    let out: Record<string, unknown> | undefined;
    for (const key of keys) {
      if (
        Object.prototype.hasOwnProperty.call(body, key) &&
        (body as Record<string, unknown>)[key] === residue[key]
      ) {
        out ??= { ...(body as Record<string, unknown>) };
        delete out[key];
      }
    }
    return out ?? body;
  };
  const pipe = z.preprocess(strip, schema);
  // Read-through `shape` so shape-reading consumers (and the walkers' duck
  // tests) see the inner authorable shape. Lazy: never forces a lazySchema
  // proxy at construction. Note `.describe()`/`.optional()` clones do not
  // carry this instance property — it exists on the exported instance only.
  Object.defineProperty(pipe, 'shape', {
    configurable: true,
    get: () => schema.shape,
  });
  return pipe as unknown as z.ZodType<z.output<S>, z.input<S>> & { readonly shape: S['shape'] };
}

// ============================================================================
// VALUE-level retirement — the sibling axis (#17109)
// ============================================================================

/**
 * Retired enum MEMBER → the prescription an author who writes it meets.
 *
 * Free text, exactly like {@link retiredKey}'s `guidance`, and written to the
 * same five conventions (the `spec-property-retirement` skill, §2 "guidance
 * 字符串怎么写"): the fully-qualified name in backticks first, the version and
 * ADR that removed it, a clause saying why it went, an imperative fix, and —
 * where an ADR-0087 conversion covers the surface — the house `os migrate
 * meta` sentence. That sentence is pinned class-wide by
 * `retired-key-migrate-sentence.test.ts`, which is a plain TEXT scan over
 * string literals in `packages/spec/src` with no dependency on `retiredKey()`
 * — so a value retirement's prescription is judged by the same pin as a key
 * retirement's, for free, wherever in the tree it is declared.
 *
 * ⛔ Not a structured `{ from, to }` record. The machine-readable channel for
 * a retirement already exists one layer out — the ADR-0087 conversion registry
 * and the generated upgrade guide — and the message's job is the one thing
 * those cannot do: reach the author standing in front of a parse error. A
 * second vocabulary for the same fact is how the two drift apart.
 */
export type RetiredValueGuidance = Readonly<Record<string, string>>;

/**
 * Declare an enum whose vocabulary has been NARROWED: `z.enum(values)` with a
 * named refusal carrying the migration prescription for each member the
 * narrowing retired (#17109, maintainer ruling 2026-09-09 — the generic
 * helper, ⛔ deliberately not a refinement on the one enum that surfaced it).
 *
 * ## The gap this closes
 *
 * {@link retiredKey} retires a **key**. It has no counterpart for a **value**,
 * and the three removal routes in the `spec-property-retirement` skill (§2)
 * all address keys — none applies to "the def survives, one member leaves".
 * Two enums had already reached for the same hand-rolled shape independently
 * (`data/hook-body.zod.ts` `HookBodyCapability.crypto.hash`, `data/object.zod.ts`
 * `managedBy: 'system'`), each re-deriving the same judgement in its own
 * comment; meanwhile `spec-changes.json` twice records the opposite
 * conclusion — "a removed ENUM MEMBER cannot carry a retiredKey() fix-it
 * error the way an authorable object key can" (`data.field.changed`, #4673;
 * `owd-full-alias-removed`) — and those two retirements shipped with no
 * prescription at all. One mechanism, so the diagnosis reads the same
 * everywhere and the next narrowing does not have to re-decide.
 *
 * ## Both authoring channels, same as a key tombstone
 *
 *   1. **`tsc`.** The retired member is absent from `values`, so `z.input` no
 *      longer admits it and writing it fails to compile at the authoring site.
 *      This falls out of the shape rather than being added to it — the retired
 *      member is declared in `retired`, never in `values`, and the helper
 *      refuses the two lists overlapping.
 *   2. **The parse.** A value reaching the runtime raises the prescription
 *      itself instead of zod's anonymous `Invalid option: expected one of …`.
 *      Only the retired member gets it: everything else keeps zod's own
 *      message, which already lists the legal tokens — telling the author of
 *      `variant: 'headng'` that their value "was removed" would misinform.
 *
 * ## What composes, and what it does about a default
 *
 * The return value is a plain `ZodEnum`, so `.describe()`, `.optional()`,
 * `.default(…)`, `.meta()` and every schema walker behave exactly as they do
 * on `z.enum(…)` — the retirement rides on the enum's own error map and adds
 * no wrapper for anything to resolve through. On a **defaulted** enum an
 * omitted key still materializes the default untouched (absence never meets
 * the refusal); an explicitly authored retired member still refuses. The one
 * case this helper does NOT cover is a retired member that WAS the default —
 * then every artifact a released toolchain built carries it materialized, and
 * the judgement for that population is {@link acceptRetiredDefaultResidue}'s,
 * not this one's.
 *
 * ## Registration
 *
 * Nothing here registers itself, and the key-level ledgers have no row shape
 * for a value: `RETIRED_KEYS_BY_MAJOR` is keyed `'<defKey>:<name>'` (a key),
 * and the liveness ledger is walked per schema PROPERTY, which a member is
 * not. Per the skill's §2 table, an enum-value narrowing is also byte-invisible
 * to all four generated ratchets — the def, its exports and its key are all
 * unchanged. So the declaration channels a narrowing owes are its ADR-0087
 * conversion and its changeset, and the prescription below is the only one an
 * author meets directly. ⚠️ Declaring a member retired here does not narrow
 * anything by itself: delete it from `values` in the same edit, which is what
 * the construction-time refusal enforces.
 *
 * @param values - The enum's LIVE vocabulary, retired members already removed.
 * @param retired - Retired member → its prescription. Must be non-empty, and
 *   must not name anything still in `values`.
 *
 * @example
 * ```ts
 * export const HookBodyCapability = enumWithRetiredValues(
 *   ['api.read', 'api.write', 'api.transaction', 'crypto.uuid', 'log'],
 *   { 'crypto.hash': CRYPTO_HASH_RETIRED },
 * );
 * ```
 */
export function enumWithRetiredValues<const T extends readonly [string, ...string[]]>(
  values: T,
  retired: RetiredValueGuidance,
) {
  const names = Object.keys(retired);
  if (names.length === 0) {
    throw new Error(
      'enumWithRetiredValues: no retired member declared — a retirement wrapper that can never fire '
      + 'is a declaration with no enforcement; call `z.enum()` directly instead.',
    );
  }
  const live = new Set<string>(values);
  const overlap = names.filter((name) => live.has(name));
  if (overlap.length > 0) {
    throw new Error(
      `enumWithRetiredValues: ${overlap.map((n) => `'${n}'`).join(', ')} declared retired but still listed `
      + 'in the enum — the enum accepts the value, so the prescription can never fire. Delete the member '
      + 'from `values`; the retirement is what removes it.',
    );
  }
  const blank = names.filter((name) => retired[name]?.trim() === '' || retired[name] === undefined);
  if (blank.length > 0) {
    throw new Error(
      `enumWithRetiredValues: ${blank.map((n) => `'${n}'`).join(', ')} declared retired with an empty `
      + 'prescription — the prescription IS the migration doc for whoever hits it. State what replaced '
      + 'the member, the version that removed it, and the one-line fix.',
    );
  }
  return z.enum(values, {
    // `hasOwnProperty`, never a bare `retired[input]`: a plain object literal
    // inherits `constructor`, `toString` and friends from Object.prototype, so
    // the bare lookup answers an author's `variant: 'constructor'` with a
    // FUNCTION where this map's contract is `string | undefined`. Measured on
    // zod 4.4.3: zod ignores a non-string return and falls back to its own
    // message, so the guard buys nothing OBSERVABLE today — it keeps the map
    // honest instead of resting on that leniency, and the pin for it asks this
    // map directly rather than through a parse. `typeof === 'string'` guards
    // the same lookup against a non-string input (a number, an object).
    error: (issue) =>
      (typeof issue.input === 'string'
      && Object.prototype.hasOwnProperty.call(retired, issue.input)
        ? retired[issue.input]
        : undefined),
  });
}
