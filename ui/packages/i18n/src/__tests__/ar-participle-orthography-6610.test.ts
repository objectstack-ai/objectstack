/**
 * objectui#6610 — the `ar` pack wrote the منقوص active participle of جرى two
 * ways at once: `جارٍ` on 92 values and `جاري` on 8.
 *
 * They are **one word in two spellings**, differing by a single code point at
 * the end of the first word — U+064D (tanwīn kasr, the yāʾ dropped) against
 * U+064A (the yāʾ retained) — not two translations. It was same-screen visible:
 * `app-shell`'s `LoadingScreen.tsx` rendered `console.initializing` as the
 * heading over the three `console.loadingSteps.*` as a list (retired with the
 * step list by objectui#12187) and `console.actions.retrying` on the retry
 * button — four values that all said
 * `جاري` — while the console around them had already said `جارٍ` on
 * `dashboard.loading`, `list.loading`, `detail.loadingAttachments` and
 * `console.ai.*`.
 *
 * ## ⛔ Why the 92:8 majority is NOT the argument
 *
 * A distribution cannot rule orthography, and this participle's ending is
 * genuinely **not invariant across syntactic positions** — an اسم منقوص
 * declines three ways:
 *
 *   - indefinite, nominative or genitive → the yāʾ **drops**, the rāʾ takes
 *     tanwīn kasr: `جارٍ`;
 *   - indefinite, **accusative** → the yāʾ is **kept**, with tanwīn fatḥ:
 *     `جاريًا`;
 *   - **definite** (with ال) or **annexed** (as a مضاف) → the yāʾ is **kept**:
 *     `الجاري` / `الجارية`.
 *
 * So "the 8 are correct in their own context" was a live possibility and had to
 * be falsified rather than out-voted. Four measurements did it, and the pins
 * below are what keeps each of them from rotting:
 *
 * 1. **The pack already distinguishes the positions, correctly.** Values that
 *    keep the yāʾ are in positions that require it —
 *    `console.ai.connectionStalled` is the khabar of لا يزال, hence accusative,
 *    hence `جاريًا`; `marketplace.installedAdditiveNote` is attributive on a
 *    definite noun, hence `الجارية`. A pack that were simply yāʾ-blind could not
 *    have got these right, so `جارٍ` elsewhere is a position-sensitive choice,
 *    not a house tic. They are pinned by name below so a later sweep cannot
 *    "normalise" them too.
 *
 *    ⚠️ There were THREE. `empty.appNotAvailableDescription` was the khabar of
 *    ما زال (`جارياً`, the tanwīn written on the alef) — and objectui#9262
 *    retired the clause it sat in, because that clause asserted a publish this
 *    screen had never measured. The row went with the sentence, not with the
 *    rule: nothing about the orthography changed, and a value that reintroduces
 *    an accusative participle belongs back in `YA_IS_CORRECT` with its reason.
 *    ⛔ Do NOT "restore" it by editing the `ar` value — the English it
 *    translates no longer says it.
 *
 * 2. **None of the 8 was in such a position.** All eight opened their string —
 *    nothing governed them into the accusative — none carried ال, and in none
 *    was the participle the مضاف: the maṣdar after it is the delayed subject
 *    (مبتدأ مؤخر) of a fronted indefinite predicate (خبر مقدم), which is
 *    nominative and indefinite. The annexed reading would turn a status message
 *    into a bare noun phrase with no predication, which is not what the `en`
 *    says (`Refreshing…`, `Loading grid…`, `Connecting to data source`).
 *
 * 3. **The minimal pairs settle it.** Both syntactic frames — participle +
 *    definite noun, and participle + indefinite maṣdar heading an iḍāfa —
 *    occurred on **both** sides of the split, five of them with a word-for-word
 *    identical continuation. `grid.refreshing` was `جاري التحديث…` while
 *    `list.refreshing` was `جارٍ التحديث…`: the same two words, one code point
 *    apart. Two spellings of one phrase cannot both be contextually correct.
 *    That pair is pinned below as the evidence it is.
 *
 * 4. **The 92 needed nothing.** None of them followed an accusative governor
 *    (كان / ما زال / لا يزال / إن …); the detector that says so is the same one
 *    that *did* flag all three yāʾ-keeping values in (1), so its zero is a
 *    measurement rather than a silence.
 *
 * ⇒ The 8 were the errors. They were converged onto `جارٍ`, taking the pack to
 * 100:0.
 *
 * ## Why this is a NEW block and not an extension of objectui#5972's
 *
 * #5972 pinned per-language uniformity across the merged `Loading…` group, and
 * it converged the two `ar` members of that group (`common.loading`,
 * `detail.loading`) onto `جارٍ`. The obvious-looking move — widen that gate to
 * cover these 8 — **cannot be made**, and the reason is structural rather than
 * stylistic: that gate *derives* its population from `en`
 * (`value === 'Loading…'`) and asserts the derived set is exactly the ten keys
 * it names. None of these 8 has that `en` value (`Loading grid…`, `Refreshing…`,
 * `Loading chart…`, `Initializing application…`, `Connecting to data source`,
 * `Loading configuration`, `Preparing workspace`, `Retrying…`), so adding them
 * to `LOADING_GROUP` would break the derivation check that is that gate's own
 * anti-vacuity guard. The orthography split simply does not respect an
 * `en`-value boundary — it is a property of one pack's spelling, not of a group
 * of shared strings.
 *
 * So this is the move `de-quote-pairing-3876.test.ts` made instead: a per-key
 * list becomes a **pack-wide invariant** ("no U+0022 anywhere in `de`" there;
 * "no bare `جاري` anywhere in `ar`" here). It needs no per-key maintenance — a
 * ninth value arriving with the yāʾ fails by key name without anyone editing
 * this file, which is the whole point, since the edit alone would have left the
 * ninth to be written tomorrow.
 *
 * ## Why the three script gates cannot see any of this
 *
 * `all-locales-key-parity` compares key sets and placeholder shapes,
 * `check-i18n-call-site-keys.mjs` asks only whether a key resolves, and
 * `check-i18n-en-drift.mjs` fires on an **`en` value change** — the `en` side of
 * all eight is untouched and always has been, so no drift event ever existed.
 * Value-level orthography in a non-Latin pack is invisible to all three, which
 * is why the invariant has to live in a test.
 *
 * ## What this file deliberately does NOT rule on
 *
 * **Gender agreement.** Nine values put the masculine participle before a
 * feminine maṣdar (`إعادة`, `إضافة`, `تهيئة`, `الموافقة`, `المعالجة`); strict
 * agreement would want `جارية`. The impersonal frozen `جارٍ` is standard MSA UI
 * register, and — load-bearing here — the pack applied it **uniformly on both
 * sides of this split**, so it was never a distinguishing factor between the 8
 * and the 92 and it is not a same-screen inconsistency. Ruling it needs an
 * Arabic desk; this file's green is not a claim about it.
 *
 * **The other nine packs.** This is an `ar` spelling rule. No key set and no
 * placeholder shape moved, so nothing here reaches them.
 */
import { describe, expect, it } from 'vitest';

import { builtInLocales } from '../locales/index';

// Spelled from code points, not pasted: U+064D and U+064A are the entire
// difference this file is about, and one of them is a combining mark that
// renders as a hair-thin diacritic (or as nothing at all in a plain terminal).
// A reader must be able to tell the two constants apart without trusting a font.
const JEEM = 'ج'; // ج
const ALEF = 'ا'; // ا
const RA = 'ر'; // ر
const YA = 'ي'; // ي  ARABIC LETTER YEH
const ALEF_MAQSURA = 'ى'; // ى  ARABIC LETTER ALEF MAKSURA
const KASRATAN = 'ٍ'; // ٍ   ARABIC KASRATAN (tanwīn kasr)

/** جارٍ — indefinite nominative/genitive منقوص: yāʾ dropped, rāʾ takes tanwīn. */
const JAARIN = JEEM + ALEF + RA + KASRATAN;
/** جاري — the yāʾ-retaining spelling this pass retired from standalone use. */
const JAARI = JEEM + ALEF + RA + YA;
/** جارى — the same error written with alef maqsura instead of yāʾ. */
const JAARA = JEEM + ALEF + RA + ALEF_MAQSURA;
/** جار — the skeleton alone, i.e. the tanwīn dropped outright. */
const JAAR = JEEM + ALEF + RA;

/**
 * A run of Arabic script, marks included. `\p{M}` is listed explicitly rather
 * than left to `\p{Script=Arabic}` so the class does not depend on how a given
 * engine assigns the script property to combining marks, and U+0640 (tatweel,
 * general category Lm) is added because it is a letter-joiner that can sit
 * inside a word. The `u` flag is mandatory — without it `\p{…}` is not a
 * property escape at all.
 */
const ARABIC_RUN = /[\p{Script=Arabic}\p{M}ـ]+/gu;
/** Marks and tatweel — everything that is written on a word without being a letter of it. */
const MARKS = /[\p{M}ـ]/gu;

/** A token's bare letter skeleton: diacritics and tatweel removed. */
const skeleton = (token: string): string => token.replace(MARKS, '');

/** Every string leaf of a pack, as `[dotted.path, value]`. */
function flatten(pack: unknown, prefix = ''): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(pack as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.push([path, v]);
    else if (v && typeof v === 'object') out.push(...flatten(v, path));
  }
  return out;
}

const at = (pack: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], pack);

const AR = flatten(builtInLocales.ar);

/**
 * The three misspellings of the standalone participle, and why each is one.
 * A leading و / ف (the two conjunctions that attach to a following word) is
 * stripped before the comparison so `وجاري` is caught too.
 *
 * ⛔ The preposition-prefixed forms (بـ / لـ / كـ) are deliberately NOT stripped:
 * `جاري` is also a real word meaning "my neighbour" (جار + the ـي possessive),
 * and `لجاري` is its natural shape. That homograph has never appeared in this
 * pack and would be an exemption row if it ever did, but widening the strip
 * would trade a real zero for a rule that can fire for the wrong reason.
 */
function offendingForm(token: string): string | null {
  const bare = skeleton(token).replace(/^[وف]/u, ''); // strip leading و / ف
  if (bare === JAARI) return `${JAARI} (the yāʾ retained — indefinite nominative drops it)`;
  if (bare === JAARA) return `${JAARA} (alef maqsura for the yāʾ)`;
  // The skeleton with no tanwīn at all. `جار` on its own is also the noun
  // "neighbour", which this pack has never used; see the note above.
  if (bare === JAAR && !token.includes(KASRATAN)) return `${JAAR} (the tanwīn dropped entirely)`;
  return null;
}

/** Every offending occurrence in a pack, as readable rows. */
function offendersIn(pack: Array<[string, string]>): string[] {
  const out: string[] = [];
  for (const [key, value] of pack) {
    for (const token of value.match(ARABIC_RUN) ?? []) {
      const why = offendingForm(token);
      if (why) out.push(`${key}: ${JSON.stringify(token)} — ${why} — in ${JSON.stringify(value)}`);
    }
  }
  return out;
}

/** Standalone `جارٍ` occurrences — the form the pack converged on. */
function correctCount(pack: Array<[string, string]>): number {
  let n = 0;
  for (const [, value] of pack) {
    for (const token of value.match(ARABIC_RUN) ?? []) {
      if (skeleton(token) === JAAR && token.includes(KASRATAN)) n++;
    }
  }
  return n;
}

/**
 * The values this card converged that are still in the pack, with what they
 * say now. A census of what actually moved, next to the rule — so the record
 * is readable here and not only in the PR that made it.
 *
 * Eight converged; five remain. objectui#12187 retired the three
 * `console.loadingSteps.*` with the boot screen's step list (the keys left the
 * pack, so their rows left this list), and gave `console.initializing` new
 * copy — still the standalone participle followed by an indefinite maṣdar
 * heading an iḍāfa, the frame this card ruled on, so it stays pinned here in
 * the converged spelling.
 *
 * ⚠️ `chart.loading` stands `[needs-review]` in `check:i18n-dead-keys` — its only
 * textual references are this file and `ellipsis-glyph-3878.test.ts`. That
 * report is not a gate and every hit wants a sampled human check before
 * deletion (objectui#4658), so nothing is done about it here. If it is ever
 * retired, this row and its `ellipsis-glyph-3878.test.ts` twin have to be
 * deleted with it — a deliberate act, which is why the pin fails loudly rather
 * than skipping an absent key.
 */
const CONVERGED: Array<[string, string]> = [
  ['grid.loading', `${JAARIN} تحميل الشبكة…`],
  ['grid.refreshing', `${JAARIN} التحديث…`],
  ['chart.loading', `${JAARIN} تحميل الرسم البياني…`],
  ['console.initializing', `${JAARIN} فتح وحدة التحكم…`],
  ['console.actions.retrying', `${JAARIN} إعادة المحاولة…`],
];

/**
 * The occurrences that legitimately KEEP the yāʾ, with the grammar that makes
 * each legitimate. These are the reason the majority argument was not the
 * argument, and pinning them is what stops a future "normalise the pack" sweep
 * from flattening a correct distinction into a real grammatical error — which
 * would be strictly worse than the inconsistency this card removed.
 */
const YA_IS_CORRECT: Array<[string, string, string]> = [
  ['console.ai.connectionStalled', 'جاريًا', 'khabar of لا يزال → accusative → tanwīn fatḥ on a kept yāʾ'],
  ['marketplace.installedAdditiveNote', 'الجارية', 'attributive on a definite noun (النواة) → definite → yāʾ kept'],
];

describe('objectui#6610 — the ar pack spells the منقوص participle جارٍ and only جارٍ', () => {
  it('the matcher can tell the four forms apart — controls before any zero', () => {
    // Every zero below is only worth as much as the counter that produced it.
    // These probes run the real `offendingForm` over synthetic strings, so a
    // regex that silently matched nothing — or that matched the substring trap —
    // fails here rather than reading as a clean pack.
    const tokensOf = (s: string) => s.match(ARABIC_RUN) ?? [];
    const flags = (s: string) => tokensOf(s).map(offendingForm).filter(Boolean);

    // The skeleton function must actually strip, or every comparison above is
    // against an unstripped token and nothing can ever match.
    expect(skeleton(JAARIN)).toBe(JAAR);
    expect(skeleton('جاريًا')).toBe('جاريا');

    // POSITIVE: each of the three retired spellings is seen.
    expect(flags(`${JAARI} التحميل…`), 'the yāʾ spelling must be caught').toHaveLength(1);
    expect(flags(`${JAARA} التحميل…`), 'the alef-maqsura spelling must be caught').toHaveLength(1);
    expect(flags(`${JAAR} التحميل…`), 'the bare skeleton must be caught').toHaveLength(1);
    expect(flags(`و${JAARI} التحميل…`), 'a leading و must not hide it').toHaveLength(1);

    // NEGATIVE: the correct form, and the three shapes that must never fire.
    expect(flags(`${JAARIN} التحميل…`), 'the converged form is not an offender').toEqual([]);
    // The substring trap an ASCII word-boundary regex walks straight into:
    // التجارية / التجاري ("commercial") contain the four letters ج ا ر ي.
    expect(flags('المعاملات التجارية والنشاط التجاري'), 'the التجارية substring trap').toEqual([]);
    expect(flags('لا يزال العمل جاريًا…'), 'accusative جاريًا keeps its yāʾ').toEqual([]);
    expect(flags('النواة الجارية تبقي التطبيق'), 'definite الجارية keeps its yāʾ').toEqual([]);
  });

  it('holds pack-wide: no standalone جاري, جارى or bare جار in any ar value', () => {
    // Non-vacuity, two ways. A collapsed pack or a broken import would satisfy
    // an empty-offenders assertion while checking nothing.
    expect(AR.length, 'ar pack looks empty — the scan would be vacuous').toBeGreaterThan(2000);
    // And the scan must be finding this participle at all: 100 standalone `جارٍ`
    // on the commit that converged the last 8 (92 before).
    //
    // The floor is deliberately SLACK rather than set at today's count. It is
    // proof of life, not a ratchet, and an exact-today floor actively harms the
    // rule: the first ablation of this file reverted one value and tripped
    // `>= 100` at 99, so the failure a reader saw was "no جارٍ found at all"
    // instead of the offender list — which is the assertion that names the key
    // and says what to write instead. A slack floor still catches the shapes
    // that make the scan vacuous (a collapsed pack, a broken import, a matcher
    // that stops matching: all take this to 0 or near it) while leaving a
    // single-value regression to be reported by the assertion built to report it.
    expect(correctCount(AR), `almost no ${JAARIN} found — the scan is not seeing this pack`).toBeGreaterThanOrEqual(
      80,
    );

    const offenders = offendersIn(AR);
    // Named, not counted: a regression has to say which value regrew and what
    // to write instead.
    expect(
      offenders,
      `Write the standalone participle as ${JAARIN} (U+064D on the rāʾ, no yāʾ) — objectui#6610. ` +
        'It is the indefinite nominative form of an اسم منقوص, which is what every one of these ' +
        'strings is: a fronted predicate over a delayed subject. Keep the yāʾ only where the ' +
        'syntax requires it — accusative (جاريًا, after كان / ما زال / لا يزال / إن) or definite ' +
        `(الجاري / الجارية) — and add such a value to YA_IS_CORRECT with its reason. ` +
        `${offenders.length} value(s) still use a retired spelling.`,
    ).toEqual([]);
  });

  it('pins the values this card converged, and the minimal pair that proved the direction', () => {
    expect(CONVERGED).toHaveLength(5);

    for (const [key, value] of CONVERGED) {
      const actual = at(builtInLocales.ar, key);
      // Presence first: a renamed or retired key must fail loudly here rather
      // than let the comparison run against undefined.
      expect(typeof actual, `ar ${key} missing`).toBe('string');
      expect(actual, `ar ${key} moved`).toBe(value);
    }

    // The decisive evidence, pinned as evidence. Before this card these two were
    // the same two words spelled differently; `list.refreshing` was already
    // `جارٍ التحديث…` and `grid.refreshing` was `جاري التحديث…`. Byte-equality
    // here is what says the contextual reading was falsified rather than
    // out-voted — and it goes red if either side drifts back.
    expect(at(builtInLocales.ar, 'grid.refreshing')).toBe(at(builtInLocales.ar, 'list.refreshing'));
    expect(at(builtInLocales.ar, 'list.refreshing')).toBe(`${JAARIN} التحديث…`);
  });

  it('pins the occurrences where the yāʾ is CORRECT, so a later sweep cannot flatten them', () => {
    // The mirror of the rule above, and the more important half. The scan is
    // built to leave these alone; this is what notices if someone "fixes" them
    // by hand — replacing an orthographic inconsistency with an actual
    // grammatical error, which the card was explicit is strictly worse.
    expect(YA_IS_CORRECT).toHaveLength(2);

    for (const [key, token, why] of YA_IS_CORRECT) {
      const value = at(builtInLocales.ar, key);
      expect(typeof value, `ar ${key} missing`).toBe('string');
      expect((value as string).includes(token), `ar ${key} lost ${JSON.stringify(token)} — ${why}`).toBe(true);
      // Belt and braces: the pin is only meaningful if the scan really does
      // pass over these values, so assert that directly too.
      expect(offendersIn([[key, value as string]]), `ar ${key} must not be flagged — ${why}`).toEqual([]);
    }
  });
});
