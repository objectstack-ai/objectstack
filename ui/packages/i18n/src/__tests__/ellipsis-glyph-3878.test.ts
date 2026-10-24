/**
 * objectui#3878 — the ten packs wrote the ellipsis two ways at once. `en` ended
 * 33 values with three ASCII full stops (`Loading...`) and 110 with the
 * typographic ellipsis U+2026 (`Loading…`), and the nine translation packs
 * copied `en` value by value, so the split propagated rather than being a
 * translation habit.
 *
 * It is **same-screen visible**, which is why it is a defect and not a taste:
 * `console.ai.askAnything` (`Ask anything...`) sits in the AI panel beside
 * sibling values that already used `…`, and `common.loading` (`Loading...`)
 * renders on the same dashboard as `dashboard.loading` (`Loading…`).
 *
 * ## The ruling
 *
 * Converge on **U+2026 `…`**, per the maintainer-authorized consistency pass
 * registered on objectstack#6015 (2026-08-09): typographic ellipsis for
 * user-facing copy. `…` was already the 110:33 majority in `en` and the
 * typographically correct form, so the minority moved.
 *
 * ## Why the invariant is "no ASCII `...` in ANY value of ANY pack"
 *
 * The card asked for "a trailing ASCII `...` in an `en` value errors". The scan
 * below is deliberately wider on both axes, because the census taken at landing
 * showed the narrow version would have shipped with holes in it:
 *
 *   - **Not trailing-only.** `collaboration.commentPlaceholder` is
 *     `Add a comment… (use @ to mention)` — the ellipsis is mid-sentence, and
 *     all nine packs already wrote it as `…` while `en` alone wrote `...`. A
 *     trailing-only rule cannot see that value at all, and it renders in the
 *     same composer as `collaboration.replyingTo`, which the same pass moved.
 *   - **Not en-only.** `list.loading` was the mirror image: `en` already said
 *     `Carregando…`-style `…` while all nine packs still said `...`. `en` never
 *     changed, so `check-i18n-en-drift.mjs` had no event to fire on and the nine
 *     were free to sit there. An `en`-only rule is blind to exactly this shape.
 *
 * The wider form also needs no per-key list to maintain: a new value arriving
 * with a typewriter ellipsis fails by key name without anyone editing this file.
 * That is the same reasoning, and the same final shape, as
 * `de-quote-pairing-3876.test.ts`, whose per-key list became "no U+0022 in the
 * `de` pack at all" once the last straight quotes were gone.
 *
 * ## Why the three script gates cannot see any of this
 *
 * `all-locales-key-parity` compares key sets and placeholder shapes,
 * `check-i18n-call-site-keys.mjs` asks only whether a key resolves, and
 * `check-i18n-en-drift.mjs` fires on an **`en` value change** — these values were
 * split from the day they landed, so for most of them no drift event ever
 * existed. All three are value-blind by design, which is why the convention has
 * to be pinned in a test.
 *
 * ## What this file does NOT cover, deliberately
 *
 * The per-package **no-provider fallback tables** hold their own English copies
 * of some of these keys (`packages/collaboration/src/useCollaborationTranslation.ts`,
 * `packages/fields/src/widgets/useFieldTranslation.ts`,
 * `packages/plugin-detail/src/useDetailTranslation.ts` and others), and they
 * still spell the ellipsis in ASCII. Those copies render only when no
 * `LocalizationProvider` is mounted; converging them is a separate surface with
 * its own in-flight owners, filed separately rather than smuggled in here. This
 * scan is scoped to the ten packs and says so, so the next reader does not read
 * its green as a claim about those tables.
 */
import { describe, expect, it } from 'vitest';

import { builtInLocales } from '../locales/index';

/** … U+2026, the one spelling. */
const ELLIPSIS = '…';
/** The typewriter spelling this pass retired: three ASCII full stops. */
const ASCII_ELLIPSIS = '...';

const LANGS = ['en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'pt', 'ru', 'ar'] as const;
type Lang = (typeof LANGS)[number];

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

const PACKS: Record<Lang, Array<[string, string]>> = Object.fromEntries(
  LANGS.map((lang) => [lang, flatten(builtInLocales[lang])]),
) as Record<Lang, Array<[string, string]>>;

/**
 * The keys this pass converged that the packs still define: every key that held
 * an ASCII ellipsis in at least one of the ten packs on the commit before the
 * fix, minus the ones later deleted outright. Pinned by name so the scan below
 * cannot go green by the keys quietly disappearing, and so the census is
 * readable next to the rule rather than only in the PR that made it.
 *
 * 312 pack values changed in all: 34 in `en` (33 trailing + the one mid-sentence
 * `collaboration.commentPlaceholder`) and 278 across the nine. That historical
 * count does not move when a converged key is later retired — only this pin does.
 *
 * The census was 35 keys at landing and is 33 today: `workflow.fromPlaceholder`
 * and `workflow.toPlaceholder` went with the whole `workflow.*` namespace in
 * objectui#4742, which deleted it as dead (no call site, no textual reference
 * anywhere outside the packs, and its plausible consumer
 * `packages/plugin-designer/src/ProcessDesigner.tsx` imports no translation hook
 * at all). Their rows are deleted rather than swapped for live keys on purpose:
 * this list is a census of which keys that pass actually touched, so naming a key
 * it never converged would make the record say something untrue. A key that
 * disappears WITHOUT this list being edited still fails, which is the guard
 * working — deleting a row is a deliberate act, and this note is its receipt.
 */
const CONVERGED_KEYS = [
  'appManagement.searchPlaceholder',
  'auth.forgotPassword.submittingButton',
  'auth.login.submittingButton',
  'auth.register.submittingButton',
  'chart.loading',
  'collaboration.commentPlaceholder',
  'collaboration.replyingTo',
  'collaboration.replyingToComment',
  'common.loading',
  'common.select',
  'console.ai.askAgent',
  'console.ai.askAnything',
  'console.ai.loadingAgents',
  'console.ai.loadingHistory',
  'console.ai.searchChats',
  'console.commandPalette.placeholder',
  'console.initializing',
  'console.objectView.searchFields',
  'console.objectView.selectField',
  'console.objectView.selectOption',
  'console.objectView.ufAddField',
  'detail.filterPlaceholder',
  'detail.loading',
  'fields.richText.placeholder',
  'grid.loading',
  'home.loading',
  'kanban.cardTitlePlaceholder',
  'list.loading',
  'search.placeholder',
  'sidebar.searchNavigation',
  'table.search',
  'topbar.connection.connecting',
  'topbar.connection.reconnecting',
] as const;

describe('objectui#3878 — the ten packs spell the ellipsis U+2026 and only U+2026', () => {
  it('holds no ASCII "..." in any value of any pack', () => {
    // Non-vacuity first: an empty or collapsed pack would satisfy every
    // assertion below while checking nothing, which is the failure mode the
    // whole i18n gate family exists to avoid.
    for (const lang of LANGS) {
      expect(PACKS[lang].length, `${lang} pack collapsed`).toBeGreaterThan(2000);
    }

    const offenders: string[] = [];
    for (const lang of LANGS) {
      for (const [key, value] of PACKS[lang]) {
        if (value.includes(ASCII_ELLIPSIS)) offenders.push(`${lang} ${key}: ${JSON.stringify(value)}`);
      }
    }
    // Named, not counted: a regression has to say which value regrew, and the
    // message has to tell the next author what to write instead.
    expect(
      offenders,
      `Write the ellipsis as ${ELLIPSIS} (U+2026), not as three ASCII full stops — ` +
        'objectui#3878, per the consistency pass on objectstack#6015. ' +
        `${offenders.length} value(s) still use the typewriter form.`,
    ).toEqual([]);
  });

  it('keeps an ellipsis in every pack for each converged key the packs still define', () => {
    // The complement of the rule above. Without it, deleting the ellipsis
    // outright would pass the ASCII scan — green because nothing is produced,
    // which is not the same fact as green because the copy is right.
    // 33, not the 35 this pass converged: see the census note on CONVERGED_KEYS
    // for the two `workflow.*` rows objectui#4742 retired with the namespace.
    expect(CONVERGED_KEYS).toHaveLength(33);

    const missing: string[] = [];
    for (const lang of LANGS) {
      const byKey = new Map(PACKS[lang]);
      for (const key of CONVERGED_KEYS) {
        const value = byKey.get(key);
        // Every one of the 35 is defined in all ten packs; an absent key is a
        // key-set fact owned by all-locales-key-parity, and reporting it as
        // "no ellipsis" here would send the reader to the wrong gate.
        expect(typeof value, `${lang} ${key} missing`).toBe('string');
        if (!(value as string).includes(ELLIPSIS)) missing.push(`${lang} ${key}`);
      }
    }
    expect(missing, 'these values lost the ellipsis entirely rather than converging on U+2026').toEqual([]);
  });

  it('pins the four keys where en was the sole outlier, because they are the drift waivers', () => {
    // On these four, the nine packs were ALREADY correct and only `en` moved, so
    // `check-i18n-en-drift.mjs` sees an `en` change that no pack follows — the
    // one honest use of its waiver ledger. `scripts/i18n-en-drift-baseline.json`
    // carries them, and the ledger re-checks each transcribed sentence against
    // `en` on every run, so an `en` edit here fails the build until the waiver is
    // renewed or dropped. Pinning the sentences here too means the pair cannot
    // drift apart silently.
    expect(builtInLocales.en.appManagement.searchPlaceholder).toBe('Search apps…');
    expect(builtInLocales.en.collaboration.replyingTo).toBe('Replying to {{name}}…');
    expect(builtInLocales.en.collaboration.replyingToComment).toBe('Replying to comment…');
    expect(builtInLocales.en.collaboration.commentPlaceholder).toBe('Add a comment… (use @ to mention)');
  });

  it('leaves the interpolation placeholders untouched', () => {
    // The transform ran over value text, so `{{name}}`/`{{agent}}` were never in
    // its reach — asserted rather than assumed, since a value-rewriting sweep
    // that ate a placeholder would still pass every check above.
    expect(builtInLocales.en.console.ai.askAgent).toBe('Ask {{agent}}…');
    for (const lang of LANGS) {
      const byKey = new Map(PACKS[lang]);
      expect(byKey.get('console.ai.askAgent'), `${lang} askAgent placeholder`).toContain('{{agent}}');
      expect(byKey.get('collaboration.replyingTo'), `${lang} replyingTo placeholder`).toContain('{{name}}');
    }
  });
});

/**
 * objectui#5972 — the merged `Loading…` group, pinned for PER-LANGUAGE uniformity.
 *
 * ## Why this lives in the #3878 file
 *
 * #3878 is what created the group. Before it, `Loading…` (U+2026) named 8 keys
 * and `Loading...` (ASCII) named 2 more; the glyph convergence merged them into
 * one 10-key group whose `en` value is byte-identically `Loading…`. Nobody
 * re-measured the wording afterwards, and the merged group turned out to be
 * rendered four different ways in `de`, two in `ko` and two in `ar` — a split
 * that only becomes visible once the two glyph groups are one group, which is
 * exactly why the pin belongs beside the pass that merged them.
 *
 * This block adds a rule; it does not touch #3878's. The glyph invariant above
 * ("no ASCII `...` in any value of any pack") still stands on its own, and
 * nothing here weakens it: every value this pass moved keeps its U+2026.
 *
 * ## The ruling
 *
 * Triage, concentrated round 2026-08-25: converge each language pack to ONE
 * rendering per language across the merged group, chosen by that pack's
 * majority / most-idiomatic form. Translation copy only — no key is added or
 * removed and no `en` value moves, so no contract changes and
 * `check-i18n-en-drift.mjs` has no event to fire on.
 *
 *   - **de** → `Wird geladen…` (was 6, plus `Laden…` ×2, `Lade…` ×1, `Lädt…` ×1).
 *     The passive is also the de pack's dominant register for in-flight states
 *     generally: 37 values whose `en` is a bare gerund render as `Wird …`.
 *   - **ko** → `로딩 중…` (was 6, plus `불러오는 중…` ×4). Majority, and it agrees
 *     with the pack's own pattern: `불러오는 중` is what `ko` uses when the string
 *     names the thing being loaded (`객체를 불러오는 중…`, `에이전트를 불러오는 중…`),
 *     while the bare form — which is what all ten of these keys are — is
 *     `… 로딩 중…` (`그리드 로딩 중…`, `차트 로딩 중…`, `양식 로딩 중…`).
 *   - **ar** → `جارٍ التحميل…` (was 8, plus `جاري التحميل…` ×2). See the separate
 *     note below: this one is a different class of defect from the other two.
 *   - en, zh, ja, fr, es, pt, ru were already unanimous and did not move.
 *
 * ## The `ar` pair is an ORTHOGRAPHY split, not a wording split
 *
 * `جارٍ` and `جاري` are not two translations; they are two spellings of one word.
 * `جارٍ` (jārin) is the indefinite form of a منقوص participle — the final yāʾ
 * drops and the rāʾ carries tanwīn (U+064D), which is the prescriptive MSA
 * spelling here. `جاري` (U+064A, the yāʾ retained) is the definite/annexed form,
 * widely used informally. So the two differ by one code point at the end of the
 * first word, and the fix is a normalization rather than a choice of words.
 *
 * That matters because the split does NOT respect this group's boundary: pack
 * wide at the time of this pass, the standalone participle was `جارٍ` ×90 against
 * `جاري` ×10, and only 2 of those 10 were in this group. Converging the 2 is
 * what the ruling asks for and is what this pin can hold; the other 8
 * (`grid.loading`, `grid.refreshing`, `chart.loading`, `console.initializing`,
 * `console.loadingSteps.*` ×3, `console.actions.retrying`) were a wider
 * normalization filed separately rather than smuggled in here, the same way
 * #3878 fenced off the per-package fallback tables. Read this block's green as a
 * statement about this group only.
 *
 * objectui#6610 has since taken those 8, and the reason it could not simply
 * widen this pin is worth recording next to it: this block *derives* its
 * population from `en` (`value === LOADING_GROUP_EN`) and asserts the derived
 * set is exactly `LOADING_GROUP`. None of the 8 has `Loading…` as its `en`
 * value, so adding them here would have broken the derivation check that is this
 * block's own anti-vacuity guard. The orthography split is a property of one
 * pack's spelling rather than of a group of shared `en` strings, so it became a
 * pack-wide invariant of its own in
 * `ar-participle-orthography-6610.test.ts` — which also pins the three `ar`
 * values where the yāʾ is grammatically CORRECT and must not be swept.
 *
 * ## The `de` fork, and why it WAS exempted BY NAME (resolved by objectui#6611)
 *
 * `auth.device.loading` used to be `Lade…`, held out of the group by name. It
 * was not an oversight and was not this pass's to settle: it was the one
 * member of the group whose outlier spelling was coherent with its own
 * screen. `apps/console`'s `DeviceAuthPage.tsx` renders all three of that
 * namespace's in-flight states, and de wrote all three in the same
 * first-person voice — `Genehmige…`, `Ablehne…`, `Lade…` — while
 * `approving`/`denying` are OUTSIDE this group (their `en` is
 * `Approving…`/`Denying…`). Converging `loading` alone would have left that
 * one screen reading `Genehmige… / Ablehne… / Wird geladen…`: a new
 * same-screen inconsistency manufactured by the very pass meant to remove
 * one. The alternative — moving the whole namespace to the passive — was a
 * copy-voice decision over keys the #5972 card did not fence in, so #5972
 * reported the fork instead of picking, and pinned it as a named exemption.
 *
 * objectui#6611 is that later decision: triage ruled toward the passive,
 * measuring it as the pack's dominant in-flight register (roughly 37 of the
 * pack's bare-gerund-`en` keys render `Wird …`, against the namespace's three
 * first-person outliers). It also carried a second, independent defect —
 * `Ablehne…` was not a grammatical German form at all (`ablehnen` is a
 * separable-prefix verb; the first-person singular is *ich lehne ab*, not
 * *ablehne*) — which meant either resolution direction had to touch it. The
 * namespace converged (`Genehmige…` → `Wird genehmigt…`, `Ablehne…` →
 * `Wird abgelehnt…`, `Lade…` → `Wird geladen…`), `auth.device.loading` is no
 * longer an outlier, and the `LOADING_GROUP_FORKS` row above is gone. If a
 * future edit reintroduces a per-language split in this group, this block
 * goes red again, and a new named exemption is the deliberate way out — same
 * as before.
 *
 * Contrast `approvalsInbox.loadingMore`, which the card floated as a possible
 * second fork (de `Lädt…`, ko `불러오는 중…`, on the theory that a *continuation*
 * load may want its own wording). Measurement says no, in both packs: de writes
 * all four of that namespace's other in-flight states passively
 * (`Wird genehmigt…`, `Wird abgelehnt…`, `Wird zurückgezogen…`,
 * `Wird erneut eingereicht…`), so `Lädt…` broke with its own neighbours rather
 * than marking anything; and ko used the same `불러오는 중…` on three plainly
 * INITIAL loads (`fields.recipient.loading`, `grid.bulk.loading`,
 * `grid.import.historyLoading`), so it cannot have been marking continuation
 * either. Both converge, and converging de there also restores the namespace.
 */

/** The `en` value that defines membership in the group. */
const LOADING_GROUP_EN = 'Loading…';

/**
 * The group as measured on `main` @ `22ba9271f`, plus `home.loading`, which
 * joined when objectui#12956 dropped the cloud noun from its `en` value
 * (`Loading environment…` became `Loading…`); every pack now renders it the
 * way it renders the rest of the group. Pinned by name so the
 * uniformity rule below cannot go green by the group quietly emptying out —
 * a uniformity assertion over nothing passes, which is this pin's failure mode.
 */
const LOADING_GROUP = [
  'approvalsInbox.loadingMore',
  'auth.device.loading',
  'common.loading',
  'dashboard.loading',
  'detail.loading',
  'fields.recipient.loading',
  'grid.bulk.loading',
  'grid.import.historyLoading',
  'home.loading',
  'lookup.loading',
  'report.loading',
] as const;

/**
 * Members held OUT of the uniformity rule, with the reason. See the fork note
 * above. Exempting by name — rather than by loosening the rule — keeps the
 * waiver countable and makes removing it a visible edit.
 *
 * Empty as of objectui#6611, which resolved the one row this array ever held
 * (`de`/`auth.device.loading`) by converging the whole `auth.device.*`
 * namespace to the passive rather than by keeping the carve-out. See the
 * resolved fork note above for why.
 */
const LOADING_GROUP_FORKS: ReadonlyArray<{ lang: Lang; key: string; value: string }> = [];

describe('objectui#5972 — each pack renders the merged `Loading…` group exactly one way', () => {
  it('derives the group from en and finds exactly the keys pinned above', () => {
    // Membership first, uniformity second. If `en` drifts — a key renamed, a
    // value edited to `Loading more…`, a new `Loading…` key landing — the group
    // this file reasons about is no longer the group it names, and the rule
    // below would be silently measuring something else.
    const derived = PACKS.en.filter(([, value]) => value === LOADING_GROUP_EN).map(([key]) => key);
    expect(derived.length, 'the group emptied or changed size — re-measure before editing the list').toBe(11);
    expect([...derived].sort()).toEqual([...LOADING_GROUP].sort());

    // And every pack must actually define every member. An absent key is a key-set
    // fact owned by all-locales-key-parity, but if one went missing here the
    // uniformity rule would happily pass over the survivors.
    for (const lang of LANGS) {
      const byKey = new Map(PACKS[lang]);
      for (const key of LOADING_GROUP) {
        expect(typeof byKey.get(key), `${lang} ${key} missing`).toBe('string');
      }
    }
  });

  it('holds one rendering per language across the group, apart from the named forks', () => {
    const forked = new Set(LOADING_GROUP_FORKS.map((f) => `${f.lang} ${f.key}`));
    const offenders: string[] = [];

    for (const lang of LANGS) {
      const byKey = new Map(PACKS[lang]);
      const ruled = LOADING_GROUP.filter((key) => !forked.has(`${lang} ${key}`));
      // Non-vacuity per language: every member, minus this pack's exemptions. A
      // count assertion here is what stops a collapsed pack or a typo'd key
      // name from turning the set check below into a check of nothing.
      const expectedCount = LOADING_GROUP.length - LOADING_GROUP_FORKS.filter((f) => f.lang === lang).length;
      const values = ruled.map((key) => byKey.get(key) as string);
      expect(values, `${lang}: wrong number of ruled values`).toHaveLength(expectedCount);

      const spellings = [...new Set(values)];
      if (spellings.length > 1) {
        const byValue = new Map<string, string[]>();
        for (const key of ruled) {
          const value = byKey.get(key) as string;
          byValue.set(value, [...(byValue.get(value) ?? []), key]);
        }
        offenders.push(
          `${lang}: ${spellings.length} renderings — ` +
            [...byValue.entries()]
              .sort((a, b) => b[1].length - a[1].length)
              .map(([value, keys]) => `${JSON.stringify(value)} on ${keys.join(', ')}`)
              .join(' | '),
        );
      }
    }

    expect(
      offenders,
      'These packs spell the same `en` string ("Loading…") more than one way across one merged ' +
        'group — objectui#5972. Converge on the pack majority, or, if the variant is genuinely ' +
        'wanted for its screen, add it to LOADING_GROUP_FORKS with the reason.',
    ).toEqual([]);
  });

  it('pins the forked values so keeping them stays a deliberate act', () => {
    // Both halves matter, for whatever rows exist. The value pins what the
    // fork actually says; the inequality pins that it is still a fork.
    // Converge a row later and this goes red until it is removed, so a
    // waiver cannot outlive its reason.
    //
    // Zero as of objectui#6611: the one row this array ever held (`de` /
    // `auth.device.loading`) was resolved by converging the whole
    // `auth.device.*` namespace to the passive rather than by keeping the
    // carve-out — see the resolved fork note above LOADING_GROUP_FORKS.
    // Pinning the count, rather than leaving this an unchecked no-op loop,
    // means a row silently reappearing here still gets caught by name the
    // next time this test is read, not just by the uniformity test above.
    expect(LOADING_GROUP_FORKS).toHaveLength(0);

    for (const { lang, key, value } of LOADING_GROUP_FORKS) {
      const byKey = new Map(PACKS[lang]);
      expect(byKey.get(key), `${lang} ${key} moved — update or drop its LOADING_GROUP_FORKS row`).toBe(value);

      const converged = byKey.get(LOADING_GROUP.find((k) => k !== key) as string);
      expect(
        value,
        `${lang} ${key} now matches the converged rendering — delete its LOADING_GROUP_FORKS row`,
      ).not.toBe(converged);
    }
  });
});
