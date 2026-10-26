/**
 * ObjectUI — object-schema key canonicalization at ingestion
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * ⚠️ The FILE and its exports still say `reference`; the pass no longer does
 * only that. The `reference` / `reference_to` pair was the first tenant, and
 * objectui#7650 added the retired-dialect arm below, which folds ANY undeclared
 * snake twin of a declared `FieldSchema` key. Renaming the exports would be a
 * published-export change across ~20 in-repo citations and belongs to its own
 * card; the two arms are marked so the name cannot mislead a reader who got
 * here from a grep.
 */

import { FIELD_KEY_GUIDANCE, FieldSchema } from '@objectstack/spec/data';

/**
 * Backend object schemas follow the ObjectStack convention and name a
 * relational field's target object `reference`
 * (e.g. `{ type: 'lookup', reference: 'showcase_account' }`) — the only
 * spelling `@objectstack/spec`'s `FieldSchema` declares. Since objectui#11070
 * round 4 it is also the only spelling ObjectUI writes or reads: its types
 * (`LookupFieldMetadata`, `MasterDetailFieldMetadata`, `DetailViewField`), its
 * in-repo emitters, and its readers (`LookupField`, `UserField`, the lookup
 * and user read cells) all spell it `reference`.
 *
 * `normalizeFieldReferenceKeys` FOLDS a foreign `reference_to` (or camelCase
 * `referenceTo`) onto `reference` when — and only when — `reference` is
 * absent, so a stored legacy def still reaches every reader. It never writes
 * `reference_to`. Until round 4 it stamped BOTH snake_case keys onto every
 * relational def, and that stamp was the producer that kept a second spelling
 * alive inside ObjectUI: the readers read `reference_to` because the stamp and
 * the emitters wrote it, and the emitters wrote it because the readers read it.
 * It mutates the field in place — the ObjectStack adapter caches the schema
 * object and re-serves it, so the one pass must stick — and is idempotent. A
 * `reference` that is already set is never overwritten, and the foreign key is
 * left on the def exactly as served: nothing here drops a key (see "Leave arm"
 * below).
 *
 * ## ⭐ Why this file also WARNS — objectui#6837 half 2
 *
 * Maintainer ruling, 2026-08-31 (第 6 场总监席决裁批 #14), 原文照录:
 *
 * > objectui不是前端的项目吗?后端的元数据只要对,前端按协议执行就行了呀
 *
 * Protocol normalization belongs on the SERVER; the front end just executes
 * the protocol. objectstack#13847 landed that half: a `field-reference-to-alias`
 * conversion rewrites stored `reference_to` → `reference` on the serve path and
 * in `os migrate meta`, so a spec-compliant backend now emits `reference` only.
 * This repo's half deleted the per-reader `reference_to` fallback arms that
 * existed to absorb the un-normalized shape.
 *
 * The ruling asked for that deletion to be AUDIBLE rather than silent, and this
 * is the cheap defence-in-depth pin it named, placed here as dispatched.
 * `@objectstack/spec` 17.2.0's `FieldSchema` is strict and refuses
 * `reference_to`, `referenceTo` and `target` by name with `unrecognized_keys`,
 * each carrying its own "did you mean → `reference`" rename (measured on the
 * installed package, with `reference` as the positive control and a nonsense
 * key as the negative one — the nonsense key gets no rename hint, so the hint
 * is alias-table membership, not boilerplate). So a def that reaches this choke
 * point spelling ONLY a legacy key came from a producer the spec would reject,
 * and the producer is where it gets fixed.
 *
 * ## ⛔ WHAT THIS WARNING DOES NOT COVER — state it, do not overclaim it
 *
 * This warning fires ONLY where this file runs, and this file runs at exactly
 * three production call sites, all of them ingestion choke points:
 *
 *   packages/app-shell/src/providers/MetadataProvider.tsx  (`ensureType`, metadata type `object`)
 *   packages/app-shell/src/providers/MetadataProvider.tsx  (`getItem`,    metadata type `object`)
 *   packages/data-objectstack/src/index.ts                 (ObjectStackAdapter.getObjectSchema)
 *
 * All three FOLD the def onto `reference`, so a def that triggers this warning
 * is also a def that still resolves. ⇒ The warning fires precisely where
 * nothing is broken.
 *
 * ⚠️ The third of those is new in objectui#7650 and the count above used to
 * read TWO. The old count was true about where this file RAN and false about
 * the serve surface it was cited for: `MetadataProvider` normalized on its
 * LIST path only, so an object def fetched BY NAME — the published
 * `useMetadataItem` hook, and any cold-cache read behind it — was served with
 * whichever single spelling the producer stored. ⛔ Do not re-derive this list
 * by grepping for the call: derive it from the serve paths that hand an object
 * schema to a reader, and check each one calls in.
 *
 * ⚠️ The BREAK surface is the complement of that: `getObjectSchema` is a
 * required member of the published `DataSource` interface and the readers call
 * it on the generic `dataSource`, so a hand-written schema served through ANY
 * other `DataSource` reaches a reader RAW — it neither passes through here nor
 * warns. Since objectui#11070 round 4 no reader carries a `reference_to` leg,
 * so on that path a def that spells ONLY a legacy key resolves no target: the
 * picker has no object to query and the read cell names nothing. That round's
 * changeset states the break for such a host. Reader-side or shared-resolver
 * diagnostics, which would make it audible, remain an open question on
 * objectui#6837 (options B and C of its table §5).
 *
 * ⛔ Do not describe this pin as making the BYO break audible. It does not.
 *
 * ⭐ The `reference_to` STAMP is retired (objectui#11070 round 4, the seat's
 * answer A to that card's Q1 under the objectui#6837 ruling). An earlier
 * revision of this header kept it as "the only thing standing between a BYO
 * `DataSource` and the break". It stood there only because the readers still
 * read `reference_to`, and they read it because this stamp and ObjectUI's own
 * emitters wrote it; with both ends moved to `reference` it protected nothing.
 * The FOLD onto `reference` is what a served legacy def needs, and it stays.
 */

/**
 * ## ⭐ THE RETIRED-DIALECT ARM — objectui#7650
 *
 * The `reference` pair above is one instance of a general problem this file is
 * now the choke point for. objectui#7650 measured the shape of it:
 *
 * > The strict schema gates the WRITE door — `PUT /api/v1/meta/object/:name`
 * > refuses a document carrying an undeclared key. It does not gate the READ
 * > door.
 *
 * `ObjectStackAdapter.getObjectSchema` fetches the object document and returns
 * it with exactly two mutations applied and NO `ObjectSchema.parse` anywhere on
 * the path. So a document stored BEFORE a key was tightened is served, verbatim,
 * to every consumer, forever — it cannot be re-saved through the strict door,
 * but nothing ever asks it to be.
 *
 * That is why "no spec-compliant producer can emit this key" and "this consumer
 * read can never fire" are DIFFERENT claims. Several retirement cards in this
 * family (objectui#7155, #7166, #7435) narrowed consumer reads to the camelCase
 * spelling on the strength of the first claim alone. This arm supplies the
 * second half for them, exactly as objectui#6837 half 2 supplied it for
 * `reference_to`: the legacy spelling is canonicalised ONCE, here, at ingestion,
 * and never at a consumer.
 *
 * ## How the fold is DERIVED, and why it is not a table
 *
 * Maintainer route ruling (2026-09-09, objectui#7650 comment 5605081157): fold
 * by the spec's OWN alias-probe rule — lowercase, strip `_`, `-` and space —
 * matched EXACTLY against `FieldSchema`'s declared key set, which this repo can
 * read off `FieldSchema.shape`.
 *
 * Two properties of that rule are the reason it was chosen over a hand-written
 * three-row table:
 *
 *   - `id_field` needs NO special case. It probes to `idfield`, which matches no
 *     declared key — `FieldSchema` has no `idField`, the spec's only `idField`
 *     sits on `InlineGridColumnSchema` — so it lands in the leave arm on its
 *     own. `title_format` likewise (no declared `titleFormat`).
 *   - A TYPO is not folded. `sortible` probes to `sortible`, which matches no
 *     declared key, so it is left alone. ⛔ This is why the spec's published
 *     `lintAuthoredRecordKeys` is NOT called here: it falls through to a
 *     Levenshtein matcher when no `to` row exists, and would answer "did you
 *     mean `sortable`?" for that typo. A serve path that silently CORRECTS a
 *     typo is worse than the defect it is fixing.
 *
 * ⚠️ "Leave arm", not "drop arm" in the destructive sense: a key this arm does
 * not fold is left on the document EXACTLY as served. Nothing here removes a
 * key or a value. Dropping the legacy key was weighed on objectui#7650 and
 * REFUSED — a stored legacy document would lose the value instead of arriving
 * canonical, and silent data loss on a serve path is the worst of the shapes.
 *
 * ⭐ The leave arm is no longer SILENT, which is the other half of that
 * sentence: the document keeps the value, and the consumers narrowed to the
 * canonical spelling by objectui#7155 / #7166 / #7435 read none of it (not
 * every consumer was narrowed — the kept retired-spelling readers are named in
 * {@link warnUnfoldableRetiredKey}'s docblock). See
 * {@link warnUnfoldableRetiredKey} (objectui#8938) for the diagnostic maintainer
 * ruling item 3 asked for, and for the two cases it deliberately stays out of.
 *
 * ## ⛔ The WIDTH of this arm is measured, never declared
 *
 * This arm accepts one spelling rule applied to `FieldSchema`'s WHOLE declared
 * key set, so its width is a property of the linked `@objectstack/spec` and
 * grows with it — ⛔ it is not the handful of keys the cards that asked for it
 * happened to name, and ⛔ no count of it belongs in prose here or in a
 * changeset (objectui#8938; AGENTS.md #9). The instrument that re-derives it is
 * the pin named `the width IS the spec's declared key set, not a list anyone
 * typed`, which drives every snake twin the live spec implies through this
 * choke point.
 *
 * ## `id_field`: never folded, and the diagnostic carries the spec's own reason
 *
 * `@objectstack/spec`'s `FIELD_KEY_GUIDANCE` publishes an `id_field` row with a
 * `why` and no `to`: a retirement, not a rename. So `id_field` is still never
 * folded and nothing here reads an `idField`. What the row changes is the
 * `no-declared-twin` diagnostic, which appends that `why`, read off the
 * installed spec when the warning is emitted ({@link warnUnfoldableRetiredKey};
 * objectui#7650). Two other ways of getting the sentence there were refused on
 * the card, and neither refusal moves: quoting it from a local copy (a second
 * copy of contract prose is the drift AGENTS.md #0.1 exists to stop), and
 * reading it optionally with a local fallback (an invisible fallback that
 * silently degrades on an older spec is this card's own defect class). The read
 * is therefore unconditional: on a spec without the row it throws in dev rather
 * than printing less.
 *
 * ## What this arm deliberately does NOT do
 *
 * ⛔ It never overwrites. A canonical key the producer already set keeps the
 * producer's value, whatever the legacy twin says — the same rule the
 * `reference` arm follows, for the same reason.
 * ⛔ It never folds a key `FieldSchema` already declares: those are canonical by
 * definition and skipping them is what keeps the pass idempotent.
 * ⛔ It folds nothing onto an AMBIGUOUS probe. If two declared keys ever collide
 * under the probe rule, that probe folds nothing rather than picking one.
 * Measured on 17.3.0: 74 declared keys, zero collisions. The guard is here so a
 * later spec addition cannot silently start choosing.
 */
const aliasProbe = (key: string): string => key.toLowerCase().replace(/[_\-\s]/g, '');

/** Memoized `FieldSchema` readings — see {@link fieldKeyFolds}. */
let declaredFieldKeys: ReadonlySet<string> | null = null;
let probeFolds: ReadonlyMap<string, string> | null = null;
let collidingProbes: ReadonlyMap<string, readonly string[]> | null = null;

/**
 * `probe -> canonical declared key`, derived once from `FieldSchema.shape`.
 *
 * Derived rather than listed on purpose: a table would have to be edited every
 * time the spec grows a camel key whose snake twin is still in stored
 * documents, and the edit that does not happen is the bug.
 *
 * ⛔ Deliberately NOT reset-able and deliberately not exported: the key set is a
 * property of the linked `@objectstack/spec`, so it cannot change while the
 * process runs, and a reset hook would be public API bought for nothing. The
 * collision guard above is therefore unexercised BY CONSTRUCTION today — the
 * pin that keeps it honest asserts the zero-collision precondition against the
 * real spec, so the day a collision appears the pin says so before the guard
 * has to.
 */
function fieldKeyFolds(): ReadonlyMap<string, string> {
  if (probeFolds) return probeFolds;
  const declared = Object.keys(FieldSchema.shape as Record<string, unknown>);
  const seen = new Map<string, string[]>();
  for (const key of declared) {
    const probe = aliasProbe(key);
    seen.set(probe, [...(seen.get(probe) ?? []), key]);
  }
  const folds = new Map<string, string>();
  const collisions = new Map<string, readonly string[]>();
  // Same partition as before — a probe two declared keys share folds NOTHING —
  // but the colliding keys are now kept rather than flattened to a `null`, so
  // the diagnostic below can say WHICH declared keys the probe could not choose
  // between instead of reporting the refusal as an unrecognised spelling
  // (objectui#8938).
  for (const [probe, keys] of seen) {
    if (keys.length === 1) folds.set(probe, keys[0] as string);
    else collisions.set(probe, keys);
  }
  declaredFieldKeys = new Set(declared);
  collidingProbes = collisions;
  probeFolds = folds;
  return folds;
}

/**
 * Warn once per (OBJECT, field, legacy spelling, canonical) — same four-segment
 * reasoning as {@link warnedLegacyOnly}, which the docblock below sets out.
 */
const warnedRetiredSpelling = new Set<string>();

/**
 * Warn once per (OBJECT, field, spelling, REASON) — see
 * {@link warnUnfoldableRetiredKey}. The reason is in the key because the three
 * refusals are three different fixes, and a def can hit more than one of them.
 */
const warnedUnfoldableSpelling = new Set<string>();

/** Why the choke point left an undeclared key where it was. */
type UnfoldableReason = 'no-declared-twin' | 'ambiguous-probe' | 'canonical-occupied';

/**
 * ## ⭐ THE DIAGNOSTIC FOR A SPELLING THIS CHOKE POINT CANNOT FOLD — objectui#8938
 *
 * Maintainer ruling item 3 (objectui#7650, comment 5572018999) asked the
 * execution for "a loud diagnostic (not a silent drop) for a spelling the choke
 * point cannot fold". The fold arm shipped with a warning for the spelling it
 * CAN fold ({@link canonicalizeRetiredFieldKeys}) and nothing for the one it
 * cannot, which is the half the ruling named: a key that folds still reaches
 * every consumer, while a key that does not fold reaches none of the consumers
 * of the declared spellings.
 *
 * ⛔ "Not a silent DROP" is about the reader, not about the document. Nothing
 * here removes a key or a value — the leave arm is lossless and stays lossless.
 * What is lost is the READ by those consumers: the retirement cards in this
 * family (objectui#7155, #7166, #7435) narrowed them to the canonical spelling,
 * so a value that never reaches a canonical key is a value none of them reads.
 * That is the silence this makes audible.
 *
 * ⚠️ Not NO reader, and the line never says so (objectui#7650). Some reads of a
 * retired spelling were KEPT on purpose and still see a value this arm leaves
 * alone. For the two `no-declared-twin` keys: `resolveActionParam` in
 * `@object-ui/fields` reads `id_field` and `title_format` (objectui#7435
 * kept them; its pin `resolveActionParams.declaredLookupLegs-7435.test.ts`
 * calls them the snake spellings that must keep working), and
 * `resolveGroupByLabels` in `@object-ui/plugin-charts` reads
 * `fieldDef.id_field || 'id'`. Those two are named, not counted: other kept
 * snake reads exist (`deriveColumns` in `@object-ui/plugin-form` reads
 * `reference_field`, for one), and nothing re-derives a complete list. So the
 * line claims only what holds for every refusal: a consumer that reads only
 * declared spellings will not see the value. Retiring any of those reads is a
 * separate decision, not taken here.
 *
 * ## The three refusals, and why each is a different sentence
 *
 *   - `no-declared-twin` — `FieldSchema` declares neither the key nor anything
 *     sharing its alias probe. `id_field` and `title_format` land here by the
 *     derived rule rather than by an exclusion, and so does a typo (`sortible`):
 *     ⛔ the diagnostic deliberately does NOT offer a near match, for the same
 *     reason the fold does not — the spec's `lintAuthoredRecordKeys` falls
 *     through to a Levenshtein matcher, and a serve path that suggests a
 *     correction is one revision away from applying it. For `id_field` alone
 *     the line also carries the reason the spec publishes for that exact
 *     spelling, `FIELD_KEY_GUIDANCE.id_field.why`, read unconditionally where
 *     the line is built: the contract's own sentence about the key, not a near
 *     match this path computed. The spec keys that row snake_case on purpose —
 *     a `why` row matches only the exact authored spelling.
 *   - `ambiguous-probe` — two or more declared keys share the probe, so the
 *     fold refuses to choose. Unreachable against a spec with no collision;
 *     the pin that exercises it substitutes a colliding `FieldSchema`.
 *   - `canonical-occupied` — the declared twin is already on the def carrying a
 *     DIFFERENT value, and the fold never overwrites a value the producer set.
 *     The producer's value is served under the declared key, the retired one
 *     reaches no consumer of the declared spelling (a kept snake read can still
 *     see it — see above), and NOTHING said so before this. ⛔ Same value under
 *     both spellings is NOT this case: that is the state this pass leaves
 *     behind on its own second run, and reporting it would make every
 *     re-normalization of a correctly folded def noisy.
 *
 * ## ⛔ What it does NOT fire on — the two exclusions that keep it honest
 *
 *   - A key that DID fold. That case is {@link canonicalizeRetiredFieldKeys}'s
 *     own warning, and firing here as well would report a def that works
 *     exactly as loudly as one that does not.
 *   - `reference_to` / `referenceTo`, which probe onto no declared key and
 *     would otherwise report as `no-declared-twin` while the reference arm was
 *     in the middle of folding them onto `reference`. They have their own arm and their own
 *     diagnostic ({@link warnOnLegacyOnlyReference}, objectui#6837).
 *
 * Dev-only and memoised, the discipline both existing warnings already use: the
 * adapter re-serves a cached schema and `MetadataProvider` re-normalizes on
 * every metadata refresh, so a warning that floods is a warning that gets muted.
 */
function warnUnfoldableRetiredKey(
  reason: UnfoldableReason,
  key: string,
  detail: string,
  fieldName: string | undefined,
  objectName: string | undefined,
  f: Record<string, unknown>,
): void {
  if (!isDev()) return;
  const named = fieldName ?? (typeof f.name === 'string' ? f.name : '(unnamed field)');
  const owner = objectName ?? '(unknown object)';
  const memo = `${owner}:${named}:${key}:${reason}`;
  if (warnedUnfoldableSpelling.has(memo)) return;
  // ⛔ No `?.` and no `??` here: a spec without the row throws before the memo
  // is taken, rather than warning with less (objectui#7650).
  const published =
    reason === 'no-declared-twin' && key === 'id_field'
      ? ` \`@objectstack/spec\`'s \`FIELD_KEY_GUIDANCE\` gives the reason: ${FIELD_KEY_GUIDANCE.id_field.why}`
      : '';
  warnedUnfoldableSpelling.add(memo);
  console.warn(
    `[ObjectUI] Object \`${owner}\`, field \`${named}\`: the ingestion choke point CANNOT ` +
      `canonicalize the retired spelling \`${key}\`. ${detail}${published} The key and its value are LEFT ` +
      `on the def exactly as served — nothing is dropped here — but a consumer that reads only ` +
      `the spellings \`@objectstack/spec\`'s \`FieldSchema\` declares will not see this value. ` +
      `Fix the PRODUCER, or migrate the stored document. (maintainer ruling item 3 on ` +
      `objectui#7650; objectui#8938)`,
  );
}

/**
 * Stamp the canonical spelling for every retired-dialect key on one field def.
 *
 * Runs for EVERY field def, not only relational ones: `display_field` and
 * friends live on fields that carry no relationship target at all, so gating
 * this on the reference arm's early return would have covered almost nothing.
 *
 * `Object.keys` snapshots before the loop, so the canonical keys stamped inside
 * it are never themselves re-examined.
 */
function canonicalizeRetiredFieldKeys(
  f: Record<string, unknown>,
  fieldName?: string,
  objectName?: string,
): void {
  const folds = fieldKeyFolds();
  for (const key of Object.keys(f)) {
    if (declaredFieldKeys!.has(key)) continue;
    const value = f[key];
    // Nothing to carry across and nothing to lose: no fold, and no diagnostic
    // either — the reader is not missing a value that was never there.
    if (value === undefined) continue;
    // The reference arm's own keys are handled (and warned about) below; they
    // probe onto no declared key, so without this they would report here as an
    // unfoldable spelling while that arm was about to fold them.
    if (REFERENCE_ARM_KEYS.has(key)) continue;
    const probe = aliasProbe(key);
    const canonical = folds.get(probe);
    if (canonical === undefined) {
      const colliding = collidingProbes!.get(probe);
      if (colliding) {
        warnUnfoldableRetiredKey(
          'ambiguous-probe',
          key,
          `Its alias spelling is shared by MORE THAN ONE key \`FieldSchema\` declares ` +
            `(${colliding.map((c) => `\`${c}\``).join(', ')}), so the fold refuses to choose ` +
            `between them rather than picking one.`,
          fieldName,
          objectName,
          f,
        );
      } else {
        warnUnfoldableRetiredKey(
          'no-declared-twin',
          key,
          `\`FieldSchema\` declares neither \`${key}\` nor any key sharing its alias spelling ` +
            `(lowercased, with \`_\`, \`-\` and spaces removed), so there is no canonical key ` +
            `to fold it onto — and this path deliberately does not guess a near match.`,
          fieldName,
          objectName,
          f,
        );
      }
      continue;
    }
    if (f[canonical] !== undefined) {
      // ⛔ Only when a value is actually being lost. `f[canonical] === value` is
      // the state this pass itself leaves behind — it stamps by reference and
      // the adapter re-serves a cached schema, so reporting it would fire on
      // every re-normalization of a def that folded perfectly the first time.
      // The idempotence pin in the objectui#7650 suite is what measures this.
      if (f[canonical] !== value) {
        warnUnfoldableRetiredKey(
          'canonical-occupied',
          key,
          `\`FieldSchema\` declares \`${canonical}\`, and this def already carries a ` +
            `DIFFERENT value under it; the producer's value stands, because this choke point ` +
            `never overwrites one.`,
          fieldName,
          objectName,
          f,
        );
      }
      continue;
    }
    f[canonical] = value;
    if (!isDev()) continue;
    const named = fieldName ?? (typeof f.name === 'string' ? f.name : '(unnamed field)');
    const owner = objectName ?? '(unknown object)';
    const memo = `${owner}:${named}:${key}:${canonical}`;
    if (warnedRetiredSpelling.has(memo)) continue;
    warnedRetiredSpelling.add(memo);
    console.warn(
      `[ObjectUI] Object \`${owner}\`, field \`${named}\` carries the retired spelling ` +
        `\`${key}\`. \`@objectstack/spec\`'s \`FieldSchema\` declares \`${canonical}\` and ` +
        `does not declare \`${key}\`, so a producer emitting it would be refused at the ` +
        `metadata write door. ObjectUI stamps \`${canonical}\` here so this stored def still ` +
        `renders, but the consumers no longer carry a \`${key}\` fallback of their own — fix ` +
        `the PRODUCER, or migrate the stored document. (objectui#7650)`,
    );
  }
}

/**
 * Warn once per (OBJECT name, field name, legacy spelling, target VALUE) rather
 * than once per call: the adapter re-serves a cached schema and
 * `MetadataProvider` re-normalizes on every metadata refresh, and a warning
 * that floods the console is a warning that gets muted.
 *
 * All four segments are load-bearing, and each is here because dropping it
 * makes the warning name less than a whole producer site:
 *
 *   - OBJECT — the same field name (`owner`, `account_id`) lives on many
 *     objects, and each is a SEPARATE place to fix. Keyed on the field alone
 *     the memo reports the first object and goes quiet for every other one,
 *     while the message names a field the reader then has to go hunting for.
 *     `normalizeSchemaReferenceKeys` has `schema.name` in hand, so the whole
 *     address is available for free.
 *   - FIELD and SPELLING — one line per mis-spelled key, so a producer with
 *     three broken fields gets three fixes, not one and a silence.
 *   - VALUE — a field carrying two different stale targets reports both. This
 *     mirrors `column-identity.ts`'s `warnedConflicts` memo, which keys on the
 *     value for exactly this reason.
 *
 * ⚠️ A def normalized OUTSIDE a schema (a bare `normalizeFieldReferenceKeys`
 * call) has no object to name; it warns under a placeholder rather than being
 * silently merged with a real object's entry.
 */
const warnedLegacyOnly = new Set<string>();

/** Reset the warn-once memos. Exported for tests. */
export function resetReferenceKeyWarnings(): void {
  warnedLegacyOnly.clear();
  warnedRetiredSpelling.clear();
  warnedUnfoldableSpelling.clear();
}

const isDev = (): boolean =>
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV !==
  'production';

/** The two spellings no contract declares, in the order the fold prefers them. */
const LEGACY_REFERENCE_KEYS = ['reference_to', 'referenceTo'] as const;

/**
 * The same two, as a set the retired-dialect arm tests before it reports a key
 * as unfoldable — they are handled by the reference arm below, not left
 * (objectui#8938).
 */
const REFERENCE_ARM_KEYS: ReadonlySet<string> = new Set<string>(LEGACY_REFERENCE_KEYS);

/**
 * Dev-mode only: say out loud that a def arrived spelling ONLY a legacy key.
 *
 * Non-breaking by construction: changes no types, rejects nothing, drops no
 * key, and is a no-op under `NODE_ENV=production`. The fold still runs, so the
 * def still resolves its target — this only makes the producer's bug visible
 * instead of absorbing it silently.
 */
function warnOnLegacyOnlyReference(
  f: Record<string, unknown>,
  fieldName?: string,
  objectName?: string,
): void {
  if (!isDev()) return;
  if (f.reference !== undefined) return;
  const spelled = LEGACY_REFERENCE_KEYS.filter((k) => f[k] !== undefined && f[k] !== '');
  if (spelled.length === 0) return;
  const named = fieldName ?? (typeof f.name === 'string' ? f.name : '(unnamed field)');
  const owner = objectName ?? '(unknown object)';
  for (const key of spelled) {
    const memo = `${owner}:${named}:${key}:${String(f[key])}`;
    if (warnedLegacyOnly.has(memo)) continue;
    warnedLegacyOnly.add(memo);
    console.warn(
      `[ObjectUI] Object \`${owner}\`, field \`${named}\` declares its relationship target as ` +
        `\`${key}: '${String(f[key])}'\` and does NOT carry \`reference\`. ` +
        `\`reference\` is the only spelling the protocol declares: ` +
        `\`@objectstack/spec\`'s \`FieldSchema\` refuses \`${key}\` by name with ` +
        `\`unrecognized_keys\` ("Did you mean \`${key}\` -> \`reference\`?"). ` +
        `ObjectUI stamps \`reference\` here so this def still renders, but the ` +
        `readers no longer carry a \`${key}\` fallback of their own — fix the ` +
        `PRODUCER to emit \`reference\`, or serve the def through a backend that ` +
        `normalizes it (objectstack#13847 does this on the serve path and in ` +
        `\`os migrate meta\`). Maintainer ruling 2026-08-31: protocol ` +
        `normalization belongs on the server, the front end just executes the ` +
        `protocol. (objectui#6837)`,
    );
  }
}

export function normalizeFieldReferenceKeys<T>(
  fieldDef: T,
  fieldName?: string,
  objectName?: string,
): T {
  if (!fieldDef || typeof fieldDef !== 'object') return fieldDef;
  const f = fieldDef as Record<string, unknown>;
  // Runs FIRST and unconditionally: the retired dialect is not relational, so
  // the reference arm's early return below would skip almost every def that
  // needs it (objectui#7650).
  canonicalizeRetiredFieldKeys(f, fieldName, objectName);
  // The reference arm is a FOLD, never a stamp (objectui#11070 round 4): a
  // producer's `reference` stands, and only a def that lacks it gains one from
  // a foreign spelling. `reference_to` is never written, and the foreign key is
  // left where it was.
  if (f.reference !== undefined) return fieldDef;
  const legacy = f.reference_to ?? f.referenceTo;
  if (legacy == null || legacy === '') return fieldDef;
  warnOnLegacyOnlyReference(f, fieldName, objectName);
  f.reference = legacy;
  return fieldDef;
}

/**
 * Apply {@link normalizeFieldReferenceKeys} to every field of an object
 * schema — BOTH arms: the `reference` fold and the retired dialect. Accepts
 * both field-container shapes the metadata API serves — a `name → def` map or
 * an array of defs — and tolerates anything else by returning the input
 * untouched. Mutates in place; idempotent.
 *
 * This is meant to run at the choke point where object schemas enter the
 * client (`ObjectStackAdapter.getObjectSchema`, the app-shell metadata
 * provider), so no consumer needs a dual-key fallback of its own.
 *
 * Field NAMES and the OBJECT name are forwarded so the dev-mode warning above
 * can name the whole producer site rather than half of it: the map form keys
 * the def by name, the array form carries it as `def.name`, and the object name
 * comes off `schema.name`.
 */
export function normalizeSchemaReferenceKeys<T>(schema: T): T {
  const fields =
    schema && typeof schema === 'object' ? (schema as { fields?: unknown }).fields : null;
  if (!fields || typeof fields !== 'object') return schema;
  const objectName =
    typeof (schema as { name?: unknown }).name === 'string'
      ? ((schema as { name?: string }).name as string)
      : undefined;
  if (Array.isArray(fields)) {
    for (const def of fields) normalizeFieldReferenceKeys(def, undefined, objectName);
  } else {
    for (const [name, def] of Object.entries(fields as Record<string, unknown>)) {
      normalizeFieldReferenceKeys(def, name, objectName);
    }
  }
  return schema;
}
