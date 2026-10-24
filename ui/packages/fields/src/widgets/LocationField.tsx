import React, { useEffect, useRef, useState } from 'react';
import { Input, EmptyValue, cn } from '@object-ui/components';
import { LocationValueSchema } from '@objectstack/spec/data';
import type { LocationValue } from '@objectstack/spec/data';
import { FieldWidgetComponentProps } from './types.js';
import { toDomProps } from './toDomProps.js';
import { useFieldTranslation } from './useFieldTranslation.js';
// The package's declared shape for a `t` forwarded out of a component into a
// message producer — `file-size-guard.ts` exports it and `FileField` /
// `ImageField` already pass `t as TranslateFn` through it. Imported rather than
// re-declared: a second identical type is a second contract, and the name is
// about the FUNCTION, not about files.
import { type TranslateFn } from './file-size-guard.js';

/**
 * The stored shape of a `type: 'location'` value — RE-EXPORTED from
 * `@objectstack/spec/data`, never re-declared here (objectui#6272).
 *
 * `LocationValue` is `z.input` of the spec's `LocationValueSchema`
 * (`{ lat, lng, altitude?, accuracy? }`), which is what `valueSchemaFor({ type:
 * 'location' })` validates a stored location against. A second local
 * declaration under the spec's own name is objectstack#4115's failure class and
 * is refused by `scripts/check-spec-symbol-derivation.mjs` — it was refused on
 * the closed PR #6418, which is why this is a bare re-export.
 */
export type { LocationValue } from '@objectstack/spec/data';

/**
 * A stored value is a location only when it carries BOTH spec coordinates as
 * finite numbers.
 *
 * ⛔ Deliberately no fallback to the deprecated `{ latitude, longitude }`
 * spelling, and no `|| 0` default on a missing coordinate — both were the
 * defect (objectui#6272, maintainer ruling 2026-08-28 「6272 A1」, option A1
 * chosen explicitly over a read-side compatibility shim):
 *
 *  - reading `latitude`/`longitude` made this widget the one surface that
 *    disagreed with the platform contract. `valueSchemaFor({type:'location'})`
 *    REJECTS `{ latitude, longitude }` (`invalid_type` at `[lat]`, `[lng]`) and
 *    ACCEPTS `{ lat, lng }`, and the display surfaces (`LocationCellRenderer`,
 *    `ObjectMap`) already read `lat`/`lng` first — that is correct by contract,
 *    not tolerance.
 *  - `|| 0` turned every unreadable value into `0, 0`, a VALID coordinate in
 *    the Gulf of Guinea. A field that renders a plausible wrong place is worse
 *    than one that renders nothing: an empty box is visibly unset, `0, 0` is
 *    not. The same applies to a half value — `{ lat }` alone must not invent a
 *    longitude.
 */
function isLocationValue(value: unknown): value is LocationValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const { lat, lng } = value as Record<string, unknown>;
  return isFiniteNumber(lat) && isFiniteNumber(lng);
}

/**
 * A usable numeric component of a location: a real number, never `NaN` or an
 * infinity. Named so the coordinates and the two optional keys below are held
 * to the SAME test rather than to two copies of it that can drift apart.
 */
function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/**
 * Is this candidate emission one the platform's own validator ACCEPTS?
 *
 * The guard above tests that a coordinate is a real number; the spec also
 * constrains its RANGE, and nothing in this widget used to (objectui#6714):
 *
 * ```ts
 * // @objectstack/spec, LocationValueSchema
 * lat: z.number().min(-90).max(90)
 * lng: z.number().min(-180).max(180)
 * ```
 *
 * So typing `999, 999` emitted `{ lat: 999, lng: 999 }` — a value
 * `valueSchemaFor({ type: 'location' })` refuses with `too_big` at BOTH keys.
 * That is the producer direction of the contract-first failure class
 * (AGENTS.md #0.1): a renderer writing what the contract rejects. It is also
 * open to every user who edits a location field, since typing the coordinates
 * is this field's only interaction.
 *
 * ⛔ The bounds are NOT restated here as `-90`/`90` literals. A hand-copied
 * range is a SECOND contract that can drift from the spec silently — the exact
 * shape #0.1 bans — so the spec's own schema is asked instead. It is a
 * memoized lazy schema, so this costs one `safeParse` of a 2–4 key object.
 *
 * Two deliberate consequences of asking the schema rather than testing two
 * bounds by hand:
 *
 *  - The check is on the WHOLE emitted object, so `altitude`/`accuracy` carried
 *    across the edit are held to the contract too. {@link carryOptionalKeys}
 *    already narrows them to finite numbers, so this is a no-op today — it is
 *    the guard that keeps it one.
 *  - `Infinity` is refused as well. `parseFloat('Infinity')` is `Infinity` and
 *    `!isNaN(Infinity)` is `true`, so the format gate alone let it through;
 *    `z.number()` rejects it. Same defect class, same fix, no extra branch.
 *
 * ⚠️ Deliberately NOT wired into {@link isLocationValue}, which is the READ
 * guard. A record that already holds an out-of-range pair keeps RENDERING here,
 * so the person who can correct it can still see it — blanking it would hide
 * the dirty data from its only fixer. objectui#6272's empty render was for a
 * value whose SHAPE this widget cannot read; this shape is readable, it is just
 * not writable. This card is the producer direction only.
 */
function isSpecAcceptedLocation(candidate: LocationValue): boolean {
  return LocationValueSchema.safeParse(candidate).success;
}

/**
 * Build the value emitted for a freshly typed coordinate pair, carrying the
 * spec's two OPTIONAL keys across the edit (objectui#6664).
 *
 * The box edits `lat`/`lng` only, but a stored location may also carry
 * `altitude` and `accuracy` — both declared by `LocationValueSchema`, and both
 * registered on the platform's authorable surface, so a customer may write
 * them. Rebuilding the emission as a bare `{ lat, lng }` dropped them silently
 * the moment anyone retyped the coordinates, with nothing to warn them.
 *
 * ⛔ The carry is a KEY-BY-KEY pick out of an already-valid `LocationValue`,
 * and deliberately NOT a spread of `previous` (nor `Object.assign`): a stored
 * record may still hold the retired `{ latitude, longitude }` spelling, and
 * spreading it would carry that dialect straight back into the emitted object
 * and undo objectui#6272's rename. The spec schema cannot be that guard —
 * `LocationValueSchema` is a plain, NON-STRICT `z.object`, so it ACCEPTS a
 * polluted object and merely strips the unknown keys from its own parsed
 * OUTPUT, while the value handed to `onChange` keeps them. Both facts are
 * pinned in `__tests__/LocationField.optionalKeys.test.tsx`.
 *
 * Each optional key is taken only when it is a usable number. Measured against
 * the spec: `z.number()` rejects `NaN`, `Infinity` and a numeric string alike
 * (`invalid_type` at `[altitude]`), so carrying one of those forward would make
 * this widget emit a value the platform's own validator refuses. Leaving it
 * behind is a NARROWING — this emits less than it was handed, never more — not
 * a tolerant fallback of the kind AGENTS.md #0.1 bans.
 */
function carryOptionalKeys(lat: number, lng: number, previous: unknown): LocationValue {
  const emitted: LocationValue = { lat, lng };
  if (!isLocationValue(previous)) return emitted;
  if (isFiniteNumber(previous.altitude)) emitted.altitude = previous.altitude;
  if (isFiniteNumber(previous.accuracy)) emitted.accuracy = previous.accuracy;
  return emitted;
}

/**
 * The canonical `"lat, lng"` text for a stored value — empty for anything this
 * widget cannot read (objectui#6272's unreadable shapes included).
 */
function coordinateText(value: unknown): string {
  return isLocationValue(value) ? `${value.lat}, ${value.lng}` : '';
}

/**
 * The one place this widget says what "a number" is (objectui#6715).
 *
 * ⚠️ This is `parseFloat`'s OWN grammar, ANCHORED — not a second, stricter
 * notion of a number invented here. `parseFloat` reads the longest PREFIX of
 * its argument matching this grammar and returns what it got, discarding the
 * rest; the anchors are what turn "there is a number at the front" into "the
 * whole text IS that number". Nothing else about the reading changes, which is
 * why {@link parseDraft} still asks `parseFloat` for the value itself.
 *
 * The defect the anchors exist for: `parseFloat('12abc')` is `12`, so
 * `"12abc, 34"` emitted `{ lat: 12, lng: 34 }` — a coordinate the user never
 * typed, which `valueSchemaFor({ type: 'location' })` ACCEPTS, so unlike
 * objectui#6714 no downstream check could ever catch it. Measured on
 * `b76ca6764` through a real `ObjectForm`: `dataSource.create` was handed
 * `{"lat":12,"lng":34}` with `aria-invalid="false"` and no diagnostic drawn.
 * Truncation is not confined to obvious junk, either — the same reading turns
 * `"0x10"` into `0` (objectui#6272's `|| 0`, arriving through a different
 * door) and `"12.5 N, 34 E"` into `{ lat: 12.5, lng: 34 }`, dropping the
 * hemisphere so a southern coordinate would be stored as a northern one.
 *
 * ⛔ `Number()` is NOT this test, although it looks like the same idea: it
 * reads `'0x10'` as `16`, `'0b11'` as `3` and `''` as `0`. A hex literal is
 * not a coordinate notation, and none of those readings is what was typed.
 *
 * ⛔ Nor is this degree/hemisphere PARSING. `12°N` stays refused, deliberately
 * — the maintainer ruling of 2026-08-29 adopts the refusal and declines the
 * notation, because the paste route is unmeasured; it is its own feature card
 * if real demand arrives.
 *
 * `Infinity` IS in the grammar, deliberately. `parseFloat` reads it whole, so
 * it carries no residue and this gate has nothing to say about it; it is
 * refused one step later by {@link isSpecAcceptedLocation}, exactly as it is
 * today (objectui#6714). The range arm keeps its own case rather than having
 * it quietly moved into this one.
 */
const WHOLE_NUMBER_TEXT = /^[+-]?(?:Infinity|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/;

/** The two coordinates, in the order they are typed, named for the diagnostic. */
const COORDINATE_LABELS = ['latitude', 'longitude'] as const;

/** Which coordinate a half is — the key half of `COORDINATE_LABELS`. */
type CoordinateLabel = (typeof COORDINATE_LABELS)[number];

/**
 * One half of the typed pair that carried non-numeric residue.
 *
 * `label` is the COORDINATE_LABELS member, not free text: since `320374d2a`
 * it selects a locale key, so widening it to `string` would make
 * {@link coordinateName}'s branch fall through to `longitude` silently.
 */
type ResidueHalf = { label: CoordinateLabel; text: string };

/**
 * What the typed text means to this widget, as ONE reading (objectui#6716).
 *
 * The outcomes are exactly the ones the emission rule already had — cleared /
 * not a coordinate pair / a pair — lifted out of `handleChange` so the
 * DRAFT-SYNC guard below judges the text by the same rule that decides whether
 * to emit it. Two copies of "is this a coordinate pair" would be two
 * contracts, and the one in the effect would be the one nobody tests.
 *
 * objectui#6715 adds a fourth, `residue`, splitting what used to be one
 * reading of "the half is a number" into the two different things `parseFloat`
 * was conflating: no number at the front at all (still `unparsable`, still the
 * pre-existing FORMAT arm) versus a number at the front with text after it.
 * Only the second is new; the first keeps its message and its #6716 pins.
 */
type ParsedDraft =
  | { kind: 'cleared' }
  | { kind: 'unparsable' }
  | { kind: 'residue'; residue: ResidueHalf[] }
  | { kind: 'pair'; lat: number; lng: number };

function parseDraft(text: string): ParsedDraft {
  if (!text.trim()) return { kind: 'cleared' };
  const parts = text.split(',').map(p => p.trim());
  if (parts.length !== 2) return { kind: 'unparsable' };
  const lat = parseFloat(parts[0]);
  const lng = parseFloat(parts[1]);
  // No number at the front of a half AT ALL (`abc`, `NaN`, `--1`): the
  // pre-existing FORMAT arm, deliberately left where it was so its sentence
  // and its objectui#6716 pins keep saying exactly what they said.
  if (isNaN(lat) || isNaN(lng)) return { kind: 'unparsable' };
  // A number at the front, but not all the way to the end (objectui#6715).
  const residue = COORDINATE_LABELS
    .map((label, i): ResidueHalf => ({ label, text: parts[i] }))
    .filter(half => !WHOLE_NUMBER_TEXT.test(half.text));
  if (residue.length > 0) return { kind: 'residue', residue };
  return { kind: 'pair', lat, lng };
}

/**
 * Does the text in the box already MEAN the stored value?
 *
 * Compared by meaning, not by string: `"30.270, 120.150"` and
 * `"30.27, 120.15"` denote the same coordinate, and rewriting the first into
 * the second while someone is typing moves their caret for no reason. This is
 * the same property `ObjectField`'s sync effect tests with a `JSON.stringify`
 * round-trip, expressed for a coordinate pair.
 */
function draftDenotes(text: string, value: unknown): boolean {
  const parsed = parseDraft(text);
  if (parsed.kind === 'cleared') return !isLocationValue(value);
  // Text this widget REFUSES denotes no stored value — `unparsable`, and since
  // objectui#6715 `residue` too. Written as "not a pair" rather than as a list
  // of refusal kinds, so a future arm cannot be forgotten here.
  if (parsed.kind !== 'pair') return false;
  return isLocationValue(value) && value.lat === parsed.lat && value.lng === parsed.lng;
}

/**
 * What the box says when it refused text that is not a coordinate pair
 * (objectui#6716) — the arm that has been silent since long before #6714.
 *
 * ⛔ Deliberately NOT the published `error` slot's text. `error`
 * (objectui#3222) has exactly one author — the form renderer, from
 * react-hook-form — and its text is drawn by `<FormMessage/>`. This sentence
 * belongs to the widget's own refusal state; see it for why no host can
 * produce one.
 *
 * It names the format AND shows it, because the format is the whole content of
 * this refusal: the pair is what the box cannot read.
 *
 * objectui#6755 — the sentence is a locale KEY as of the 2026-08-29 ruling, not
 * a literal. The `en` value in `FIELD_DEFAULTS` is byte-identical to the literal
 * it replaces, so English and provider-less rendering are unchanged and
 * objectui#6716's pins keep saying exactly what they said.
 */
function refusedFormatMessage(t: TranslateFn): string {
  return t('fields.location.refusedFormat');
}

/**
 * What the box says when the pair PARSED but the platform refuses its range.
 *
 * ⛔ The bounds are NOT written here, for the same reason
 * {@link isSpecAcceptedLocation} does not test them by hand: a hand-copied
 * range is a second contract that drifts silently (AGENTS.md #0.1). The
 * sentence is built from the SPEC's own issues, so the day the schema moves,
 * this message moves with it.
 *
 * objectui#6755 keys the FRAME — the part this widget authors — and leaves
 * `{{detail}}` as whatever the spec said. That division is deliberate and is
 * the honest limit of this card: the interpolated complaint is the schema's own
 * text, so translating it belongs to whoever owns those messages, not to a
 * widget that must not restate them.
 */
function refusedRangeMessage(t: TranslateFn, candidate: LocationValue): string {
  const parsed = LocationValueSchema.safeParse(candidate);
  if (parsed.success) return '';
  const detail = parsed.error.issues
    .map(issue => `${issue.path.join('.') || 'value'}: ${issue.message}`)
    .join('; ');
  return t('fields.location.refusedRange', { detail });
}

/**
 * What the box says when a half of the pair is only PARTLY a number
 * (objectui#6715).
 *
 * ⛔ Deliberately NOT {@link refusedFormatMessage}. "Enter a latitude,
 * longitude pair" is unusable advice to someone who typed `12abc, 34`: they
 * DID type a pair, and that sentence gives them nothing to correct. This
 * refusal names the half that could not be read and quotes it back, because
 * the residue IS the content of this refusal — the same principle by which the
 * format arm names the format and the range arm reports the spec's own
 * complaint.
 *
 * ⛔ It does not suggest a notation to convert FROM (no `12°N` advice): the
 * ruling declines that parse, so pointing at it would advertise a route this
 * widget refuses.
 *
 * `320374d2a` — keyed, closing the gap objectui#6755's scope lock left open:
 * that ruling was written before this arm existed, so it named three sentences
 * and this is the fourth. All three arms share ONE `<p>` and one
 * `refusalError`, so leaving this one a literal made a single line speak the
 * reader's language on two arms and English on the third.
 *
 * ⭐ ARITY — the one question the other two arms did not have to answer.
 * `verb` was English GRAMMAR (`is not a number` / `are not numbers`), and a
 * pack whose plural rules differ cannot inflect around an English verb form
 * handed to it through a hole. So the verb is not a hole: it lives inside two
 * SIBLING KEYS picked here, at the call site.
 *
 * ⛔ Deliberately NOT i18next's `_one`/`_other` suffixes — and not because of
 * any plural convention: this is not a COUNT. The two values interpolate
 * different holes (one half, or both halves with `{{otherName}}` /
 * `{{otherText}}`), so the arm selects on which halves the residue holds, a
 * structural choice a count family cannot express. Every count label in this
 * repo is an i18next family since objectui#11445 retired the code-selected
 * `xxxCountOne` pairs; `count-families-11445.test.ts` pins that, and this pair
 * carries no `{{count}}`, so it is outside that rule by construction.
 *
 * The arity here is exactly binary and always will be: `residue` is
 * `COORDINATE_LABELS` filtered, and a draft that is not two comma-separated
 * parts never reaches this arm. So `ar` can use its DUAL in the two-half value,
 * which is precisely what an English `verb` hole made impossible.
 *
 * `named`'s two components are split the same way rather than pre-joined:
 * `' and '` was an English conjunction and `latitude`/`longitude` are
 * translatable nouns (every pack already spells them inside its own
 * `refusedFormat`). The nouns are keyed ONCE each and interpolated into both
 * values, so no locale has to keep two spellings of the same word in step. The
 * only holes carrying untranslated data are `{{text}}`/`{{otherText}}` — the
 * characters the person actually typed, which no pack should touch.
 */
function refusedResidueMessage(t: TranslateFn, residue: readonly ResidueHalf[]): string {
  const [first, second] = residue.map(half => ({ name: coordinateName(t, half.label), text: half.text }));
  if (!second) return t('fields.location.refusedResidueOne', { name: first.name, text: first.text });
  return t('fields.location.refusedResidue', {
    name: first.name,
    text: first.text,
    otherName: second.name,
    otherText: second.text,
  });
}

/**
 * The reader's word for one coordinate.
 *
 * ⛔ Written as a branch over STRING LITERALS rather than a computed
 * `t(`fields.location.${label}`)`: `check:i18n-keys` and `check:i18n-dead-keys`
 * both read `t()` literals, so a template key would be invisible to the gate
 * that proves it resolves AND to the one that proves it is still used.
 */
function coordinateName(t: TranslateFn, label: CoordinateLabel): string {
  return label === 'latitude' ? t('fields.location.latitude') : t('fields.location.longitude');
}

/**
 * The box's own hint when the field author declared no `placeholder`
 * (objectui#8149): the pair this widget reads, in the reader's words.
 *
 * objectui#6755 ruled that a widget's own refusal sentence is keyed; this
 * extends that principle to the widget's own placeholder copy, as objectui#3342
 * did for `TagsField`'s. Before it, a zh form showed the English literal
 * `latitude, longitude` in the box while the refusal one line beneath it named
 * the same coordinate in Chinese — `320374d2a` had already keyed the nouns.
 *
 * ⭐ Two halves, two owners:
 *
 *  - The WORDS are the locale's. They are the same two noun keys
 *    {@link coordinateName} reads for the residue refusal, so a pack spells each
 *    coordinate in exactly one place and the box and its refusal cannot name it
 *    differently. No new key: every pack already carries both nouns.
 *  - The ORDER and the SEPARATOR are this widget's INPUT GRAMMAR, not
 *    punctuation. {@link parseDraft} splits on an ASCII `,` and reads the first
 *    part as the latitude — the order of `COORDINATE_LABELS`, which this reads.
 *    So both are written here, and ⛔ deliberately NOT handed to a pack through
 *    a joiner key (the `validation.formInvalidJoiner` shape) or through a pair
 *    value such as `{{latitude}}, {{longitude}}`. Either would let a pack
 *    re-punctuate the pair with its own script's comma — U+FF0C in zh, U+3001
 *    in ja, U+060C in ar — and `parseDraft` refuses every one of those as not a
 *    pair, so the hint would teach a format this box will not read.
 *
 * That is how objectui#8148 settled the comma-decimal concern for the example
 * digits: the widget fills them in ASCII, so no pack spells a digit and the
 * collision cannot occur rather than being avoided by good behaviour. Here no
 * pack spells the separator. It is also the separator each pack's own
 * `fields.location.refusedFormat` example is written with; both facts are
 * pinned in `__tests__/LocationField.placeholderI18n-8149.test.tsx`.
 *
 * English and provider-less rendering are byte-identical to the literal this
 * replaces: the `en` nouns and their `FIELD_DEFAULTS` rows are `latitude` and
 * `longitude`.
 */
function placeholderPair(t: TranslateFn): string {
  return COORDINATE_LABELS.map(label => coordinateName(t, label)).join(', ');
}

/**
 * LocationField - Geographic coordinate input for a `type: 'location'` value.
 *
 * Reads and writes `@objectstack/spec`'s `LocationValue` (`{ lat, lng }`) and
 * displays it as the comma-separated pair a user types. The coordinates are
 * still called latitude and longitude to a human — only the STORED key names
 * are the spec's (objectui#6272), which is why the placeholder names the two
 * coordinates rather than the `lat`/`lng` keys. That is a statement about KEY
 * NAMES, not about language: the placeholder's words are the reader's, from
 * the locale packs (objectui#8149, {@link placeholderPair}).
 *
 * ⚠️ BREAKING (objectui#6272): a record stored in the deprecated
 * `{ latitude, longitude }` spelling — including one this widget itself wrote
 * before the flip — now renders EMPTY here until it is re-saved or fixed at the
 * data layer. It keeps rendering correctly in detail views and on the map,
 * which read the spec spelling first. That cost was presented and accepted as
 * part of the A1 ruling; it is not an oversight to route around with a shim.
 */
export function LocationField({ value, onChange, field, readonly, error, ...props }: FieldWidgetComponentProps<LocationValue | null>) {
  const config = field;

  /**
   * The text in the box, held HERE rather than re-derived from `value` on every
   * render (objectui#6716).
   *
   * ⚠️ This is the one piece of controlled-input semantics this card changes,
   * and it was taken on a measurement, not on taste. With the box's value
   * derived straight from `value`, a refusal means no state update follows the
   * change event, so React restores the control in the SAME tick and the typed
   * text is gone before anything can be said about it. Measured on
   * `faac0d935`, typing a perfectly valid `30.27, 120.15` one character at a
   * time: the box read `""` after all 13 keystrokes, `dataSource.create` was
   * called with `place: null`, and a refusal diagnostic — which each of those
   * keystrokes legitimately triggers, since `"3"` is not a pair — stayed lit
   * through 12 of them. A diagnostic with no draft to point at cannot tell
   * "refused" from "still typing", so announcing the refusal REQUIRES holding
   * the text that was refused. `ObjectField` couples the two for the same
   * reason.
   */
  const [draft, setDraft] = useState(() => coordinateText(value));

  /**
   * This widget's OWN refusal state (objectui#6716).
   *
   * Named `refusalError`, NOT `error`: `error` is the published validation slot
   * on the widget contract (objectui#3222) and is destructured above — it keeps
   * exactly one author, the form renderer. The same discipline, and the same
   * two-name shape, as `ObjectField`'s `parseError`.
   *
   * It has to live here because no host can produce it: a refusal means
   * `onChange` never fires, so the typed text never becomes a form value and
   * `buildValidationRules` — which compiles value-shaped rules — is handed
   * `undefined`. That was measured on this card before the route was chosen: a
   * real `location` branch installed in `buildValidationRules` saw `undefined`
   * in both refusal arms, while the same branch fired correctly for a STORED
   * out-of-range pair. `buildValidationRules` HAS a `location` branch as of
   * objectui#6744 — for that STORED case, never for these refusal arms — and
   * this card did not give it one.
   */
  const [refusalError, setRefusalError] = useState<string | null>(null);
  // objectui#6755 — the two keyed arms below read their sentences from the
  // package's locale channel. Called with the other hooks, ABOVE the readonly
  // early return, so hook order is the same on both branches.
  const { t } = useFieldTranslation();

  /**
   * Adopt a value that changed OUTSIDE this box — a record finishing its load,
   * a host resetting the form.
   *
   * ⚠️ The trigger is the VALUE changing, tracked against what this widget last
   * saw — never "the draft disagrees with the value". That second rule was
   * written first and measured wrong: a host that does not echo an emission
   * back (an `onChange` spy, a debounced or normalising host) leaves `value`
   * behind the draft permanently, so the rule fired on every keystroke and
   * erased the text as it was typed — the very defect this card is fixing,
   * moved into its fix. Driving the standalone widget caught it: typing
   * `30.27, 120.15` left `20.15` in the box.
   *
   * Two guards then decide whether an external change is worth overwriting
   * what the person is holding:
   *
   *  - the draft is text this widget REFUSED ⇒ leave it standing. It is the
   *    text the diagnostic is about, and an unsaved edit is not a background
   *    refresh's to discard (AGENTS.md #8).
   *  - the draft already DENOTES the new value ⇒ leave the user's own spelling
   *    alone (see {@link draftDenotes}).
   */
  const lastSeenValue = useRef(value);
  useEffect(() => {
    if (Object.is(lastSeenValue.current, value)) return;
    lastSeenValue.current = value;
    if (refusalError) return;
    if (draftDenotes(draft, value)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Required for controlled component sync
    setDraft(coordinateText(value));
  }, [value, draft, refusalError]);

  if (readonly) {
    // The STORED value, never the draft: a readonly field renders what is
    // saved, and nothing can have been typed into it.
    return <span className="text-sm">{coordinateText(value) || <EmptyValue />}</span>;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const text = e.target.value;
    // The box keeps what was typed — including text about to be refused, which
    // is the only thing the diagnostic below can point at (objectui#6716).
    setDraft(text);

    const parsed = parseDraft(text);
    if (parsed.kind === 'cleared') {
      setRefusalError(null);
      onChange(null);
      return;
    }

    if (parsed.kind === 'unparsable') {
      // The text is not a coordinate pair. The prior value stands — and since
      // objectui#6716 the box says so instead of swallowing the edit.
      setRefusalError(refusedFormatMessage(t as TranslateFn));
      return;
    }

    if (parsed.kind === 'residue') {
      // objectui#6715: a half that is only PARTLY a number is a NON-COORDINATE,
      // not a number to truncate. Refused, and announced through the very same
      // `setRefusalError` the other two arms use — a third SILENT refusal is
      // precisely the defect objectui#6716 had just finished removing, which is
      // why this card was held until #6716 landed.
      setRefusalError(refusedResidueMessage(t as TranslateFn, parsed.residue));
      return;
    }

    // The typed pair replaces `lat`/`lng`; `altitude`/`accuracy` survive the
    // edit (objectui#6664). Key-by-key, never a spread — see above.
    const emitted = carryOptionalKeys(parsed.lat, parsed.lng, value);
    // objectui#6714: the SAME refusal applied to text that isn't a coordinate
    // pair, extended from format to RANGE. Measured before choosing this:
    // nothing downstream rejects or repairs the value — a real `ObjectForm`
    // submit hands `{ lat: 999, lng: 999 }` straight to `dataSource.create`,
    // with no error raised anywhere — so refusing HERE is the only thing
    // standing between a typo and storage.
    if (isSpecAcceptedLocation(emitted)) {
      setRefusalError(null);
      onChange(emitted);
      return;
    }
    // objectui#6716: the refusal STANDS — this card does not reverse #6714. It
    // only stops the refusal from being silent.
    setRefusalError(refusedRangeMessage(t as TranslateFn, emitted));
  };

  return (
    <div className="space-y-1">
      <Input
        // DOM pass-through onto the real focusable control (objectui#3318).
        {...toDomProps(props)}
        type="text"
        value={draft}
        onChange={handleChange}
        // The author's declared placeholder wins; otherwise the widget's own
        // hint, in the reader's nouns (objectui#8149).
        placeholder={config?.placeholder || placeholderPair(t as TranslateFn)}
        disabled={readonly || props.disabled}
        className={cn(refusalError ? 'border-red-500 focus-visible:ring-red-500' : '', props.className)}
        // AFTER the spread so this widget's own computation wins: `error` is
        // the published validation slot (#3222) the HOST authors, and
        // `refusalError` is this widget's own refusal, which no host can
        // produce (objectui#6716). Same OR, and same reason, as `ObjectField`.
        aria-invalid={!!error || !!refusalError}
      />
      {refusalError && <p className="text-xs text-red-500">{refusalError}</p>}
    </div>
  );
}
