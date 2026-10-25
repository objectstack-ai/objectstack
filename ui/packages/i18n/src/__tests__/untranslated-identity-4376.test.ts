/**
 * objectui#4376 — a value that is byte-identical to `en` inside a NON-LATIN pack
 * is untranslated, and nothing in the i18n gate family could say so.
 *
 * `list.loading` was the specimen: `en` says `Loading records…` and so did
 * `ja`, `ko`, `de`, `fr`, `es`, `pt`, `ru` and `ar` — eight of the nine packs
 * served the raw English sentence, `zh` alone had translated it. A Japanese,
 * Korean, Russian or Arabic user reading a list view saw a Latin-script English
 * sentence in the middle of an otherwise translated screen, and in `ar` it was
 * left-to-right text inside a right-to-left layout. Three more keys were in the
 * same state: `designer.undo`, `designer.redo` and `appDesigner.snakeCaseHint`.
 *
 * ## Why no existing gate sees it — the value-domain blind spot, fourth instance
 *
 * This is the same hole as objectui#3582 / #3625 / #3810, one more shape:
 *
 *   - `all-locales-key-parity` compares key SETS and placeholder shapes. All
 *     four keys were present in all ten packs with matching holes: full parity,
 *     green, and correctly so — asking a key-set test to judge meaning is how
 *     you get a test that owns nothing clearly.
 *   - `scripts/check-i18n-call-site-keys.mjs` asks only whether a key RESOLVES.
 *     All four resolved.
 *   - `scripts/check-i18n-en-drift.mjs` fires on an `en` VALUE CHANGE. These
 *     values were identical from the day the packs landed, so no drift event
 *     ever existed for it to fire on. It is blind to a value that was never
 *     right rather than one that stopped being right.
 *   - `ellipsis-glyph-3878.test.ts` scans the GLYPH, not the sentence. It is why
 *     `list.loading` surfaced at all — converging its ellipsis made the
 *     untranslated body of the value obvious — but its green says nothing here.
 *
 * ## The probe, and why it is scoped to the five non-Latin packs
 *
 * `value === en[key] && /[A-Za-z]{4,}/.test(value)`, over `zh`/`ja`/`ko`/`ru`/`ar`
 * only. In a pack whose script is not Latin, a real translation of a run of four
 * or more Latin letters essentially cannot be byte-equal to the English, so
 * identity is decidable evidence of omission rather than a hint.
 *
 * It is deliberately NOT extended to `de`/`fr`/`es`/`pt`, where identity can be
 * genuine — `Standard`, `Import`, `Text` and friends are simply the same word,
 * and a probe that flagged them would be a false-positive generator whose
 * allowlist grew without bound. That scoping has a real cost and it is stated
 * rather than hidden: `list.loading` was ALSO untranslated in `de`/`fr`/`es`/`pt`,
 * and `appDesigner.snakeCaseHint` in `pt`, and this file cannot see either. Both
 * were fixed by hand in the same change; a Latin-pack omission still needs a
 * human to notice it. objectui#3582 measured the inverse probe ("no ASCII English
 * in a non-Latin pack") and found it produces false NEGATIVES; this is the
 * narrower, decidable form of the same idea.
 *
 * The `{4,}` floor is what keeps acronyms and units out of the report without an
 * allowlist entry each: `URL`, `API`, `ID`, `CSV`, `KB`, `v1` and the bare
 * `{{count}}`-style format strings never reach the identity check at all.
 *
 * ## The allowlist is the cost, and it is keyed by KEY, not by key+lang
 *
 * The keys below are byte-identical to `en` in at least one non-Latin pack and
 * are RIGHT that way — proper nouns, protocol and format names, example
 * addresses, generated filenames, and pure interpolation. Each carries a
 * one-line reason so the next reader can re-judge it instead of trusting it.
 * (This sentence used to state the entry count. It said 22 while the list held
 * 23, because nothing asserts the number and additions did not have to touch it;
 * the count is deleted rather than corrected so the prose cannot drift again —
 * the list itself is the count, and `no dead entries` below is what keeps it
 * honest.)
 *
 * Key-level rather than key+lang is a deliberate trade: it is looser (an entry
 * excuses the identity in all five packs, not just the one that has it today)
 * but it does not churn every time another pack legitimately adopts the same
 * proper noun. `assert the allowlist has no dead entries` below is what pays for
 * the looseness — an entry that stops being an identity anywhere has to be
 * deleted, so the list cannot quietly accumulate cover for keys it no longer
 * describes.
 */
import { describe, expect, it } from 'vitest';

import { builtInLocales } from '../locales/index';

/**
 * The packs whose script is not Latin. Identity with `en` is decidable evidence
 * of omission here, and only here — see the header on why de/fr/es/pt are out.
 */
const NON_LATIN = ['zh', 'ja', 'ko', 'ru', 'ar'] as const;
type NonLatin = (typeof NON_LATIN)[number];

/** A run of Latin letters long enough that a non-Latin pack cannot mean it. */
const LATIN_RUN = /[A-Za-z]{4,}/;

/**
 * Keys whose value is legitimately identical to `en` in a non-Latin pack.
 * Every entry is a fact about the VALUE, not a suppression of a translation
 * someone did not get to — if a key here ever acquires a real translation, its
 * entry must be deleted, and the dead-entry assertion below enforces that.
 */
const LEGITIMATE_IDENTITIES: Record<string, string> = {
  // Proper nouns and product/protocol/format names — the same token in every language.
  'layout.metadata.jsonBadge': 'JSON — the format name, not a word.',
  // `workflow.webhook` and `workflow.webhookEvent` sat here until objectui#4742
  // deleted the whole `workflow.*` namespace as dead. Their entries went with
  // them rather than being re-pointed at another key: an entry is a fact about
  // one key's value, so it cannot outlive the key or be transferred to a
  // different one. Both assertions in `keeps the allowlist honest` would have
  // failed on a leftover entry — dead (no identity left to excuse) and unknown
  // (no such key in `en`) — which is that guard doing its job.
  'publicForm.poweredBy': 'Powered by ObjectStack — product attribution; ja keeps the English wordmark line.',
  'console.studio.title': 'Studio — the product name, which every pack writes in Latin script in its own Studio strings (objectui#11863).',
  'connectAgent.apiKey.badge': 'headless — the literal mode name the CLI and API use.',
  // `marketplace.pricing.freemium` sat here until objectui#8754 retired the
  // whole `marketplace.pricing.*` family as dead. Its entry went with it, on
  // the same reasoning the `workflow.*` note above records: an entry is a fact
  // about one key's value, so it cannot outlive the key. Both assertions in
  // `keeps the allowlist honest` would have failed on a leftover entry — dead
  // (no identity left to excuse) and unknown (no such key in `en`).
  'console.settingsHub.beta': 'Beta — the release-stage badge, kept Latin in zh.',
  'console.settingsHub.categories.Beta': 'Beta — the same badge, reached by category name.',
  // Pure format string: two holes and a separator, no prose to translate
  // (objectui#4024). It exists as a key precisely SO a pack can change the
  // separator, and the packs that need to have — zh sets a fullwidth colon,
  // fr the French space-before-colon. ja/ko/ru/ar keep `: ` because that IS
  // their punctuation here, which is a translation decision, not an omission.
  'grid.summary.pattern': 'Aggregate label/value join — a separator and two holes, no prose.',
  // Pure format string as well (objectui#12601): the line under a Home app
  // tile is the time hole plus a verb only where both fit the 112 px tile at
  // 11 px. zh/ja/ko/ar add theirs; ru, like en, has no room for one, so its
  // value is the hole alone — a fit decision held by app-shell's
  // `appTileOpenedLine-12601.test.ts`, not an omission.
  'home.appOpened': 'Tile last-opened line — the bare `{{time}}` hole where no verb fits the tile.',

  // Loanwords these packs have adopted as their OWN vocabulary (checked against
  // their neighbours: zh writes `Logo 链接` / `Logo 已上传…`, ru writes `Email подтверждён`).
  'appDesigner.logoUrl': 'Logo URL — zh/ko/ru/ar use `Logo` and the `URL` acronym as-is.',
  'appDesigner.faviconUrl': 'Favicon URL — same, and `Favicon` has no settled translation in these packs.',
  'organization.settings.logoLabel': 'Logo — zh vocabulary for this control; its whole block says `Logo`.',
  'auth.setup.emailLabel': 'Email — ru loanword; the rest of that block is localized (`ООО Пример`, `name@example.ru`).',

  // Example values and identifiers — changing them would change what they mean.
  'auth.login.emailPlaceholder': 'name@example.com — RFC 2606 example address, an identifier.',
  'auth.register.emailPlaceholder': 'name@example.com — same.',
  'auth.forgotPassword.emailPlaceholder': 'name@example.com — same.',
  'auth.setup.emailPlaceholder': 'name@example.com — same (ru localizes it to name@example.ru).',
  'auth.setup.orgNamePlaceholder': 'Acme Inc. — the placeholder company name; ru localizes it, zh/ja keep it.',
  'grid.import.templateFileName':
    '{{object}}-import-template — a generated FILENAME; it must stay ASCII and portable.',

  // Pure interpolation and punctuation: there is no prose in these to translate.
  'fields.image.counter': '{{current}} / {{total}} — digits and a slash.',
  'marketplace.versionBadge': 'v{{version}} — version prefix plus the hole.',
  'appManagement.toast.bulkFailureEntry': '{{name}} ({{reason}}) — holes and parentheses only.',
  'collaboration.userStatusTitle': '{{name}} ({{status}}) — holes and parentheses only.',
  'chatbot.build.nextStepQuote': '“{{step}}” — a hole in quote marks; ko quotes with the same curly marks as en (objectui#12724).',
};

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

const EN = new Map(flatten(builtInLocales.en));
const PACKS = Object.fromEntries(
  NON_LATIN.map((lang) => [lang, new Map(flatten(builtInLocales[lang]))]),
) as Record<NonLatin, Map<string, string>>;

/** `[key, lang]` pairs where the pack serves the English value verbatim. */
function findIdentities(): Array<{ key: string; lang: NonLatin; value: string }> {
  const out: Array<{ key: string; lang: NonLatin; value: string }> = [];
  for (const [key, enValue] of EN) {
    if (!LATIN_RUN.test(enValue)) continue;
    for (const lang of NON_LATIN) {
      if (PACKS[lang].get(key) === enValue) out.push({ key, lang, value: enValue });
    }
  }
  return out;
}

describe('objectui#4376 — a non-Latin pack does not serve the English value verbatim', () => {
  it('holds no untranslated English value in zh/ja/ko/ru/ar outside the allowlist', () => {
    // Non-vacuity first: a collapsed or empty pack satisfies every assertion
    // below while checking nothing, which is the failure mode this whole gate
    // family exists to avoid.
    expect(EN.size, 'en pack collapsed').toBeGreaterThan(2000);
    for (const lang of NON_LATIN) {
      expect(PACKS[lang].size, `${lang} pack collapsed`).toBeGreaterThan(2000);
    }

    const offenders = findIdentities()
      .filter(({ key }) => !(key in LEGITIMATE_IDENTITIES))
      .map(({ key, lang, value }) => `${lang} ${key}: ${JSON.stringify(value)}`);

    // Named, not counted: a regression has to say which key and which pack, and
    // the message has to tell the next author both remedies — translate it, or
    // justify the identity in the allowlist above.
    expect(
      offenders,
      'These values are byte-identical to `en` inside a pack whose script is not Latin, ' +
        'which means they were never translated — objectui#4376. ' +
        `${offenders.length} value(s). Translate them, or, if the value is genuinely the same ` +
        'in that language (a proper noun, a format string, an identifier), add the key to ' +
        'LEGITIMATE_IDENTITIES above with a one-line reason.',
    ).toEqual([]);
  });

  it('keeps the allowlist honest — no dead entries', () => {
    // The complement. A key-level allowlist is only safe while every entry still
    // describes a live identity; once a key is genuinely translated everywhere,
    // its entry stops documenting anything and starts pre-authorising a future
    // regression on that key. So a stale entry is a failure, not tidy-up debt.
    const live = new Set(findIdentities().map(({ key }) => key));
    const dead = Object.keys(LEGITIMATE_IDENTITIES).filter((key) => !live.has(key));
    expect(
      dead,
      'these allowlist entries no longer match any identity — delete them, ' +
        'or the allowlist is covering keys it no longer describes',
    ).toEqual([]);

    // And every entry must name a key that actually exists, so a rename cannot
    // leave a silent hole behind.
    const unknown = Object.keys(LEGITIMATE_IDENTITIES).filter((key) => !EN.has(key));
    expect(unknown, 'these allowlist entries name keys the en pack does not define').toEqual([]);

    for (const [key, reason] of Object.entries(LEGITIMATE_IDENTITIES)) {
      expect(reason.length, `${key} has no reason recorded`).toBeGreaterThan(10);
    }
  });

  it('pins the four keys this card repaired, so the fix cannot be reverted quietly', () => {
    // The scan above goes green either by a value being translated OR by it
    // being deleted/emptied — green because nothing is produced is not the same
    // fact as green because the copy is right. Same complement as the one
    // `ellipsis-glyph-3878.test.ts` carries for the same reason.
    const REPAIRED = ['list.loading', 'designer.undo', 'designer.redo', 'appDesigner.snakeCaseHint'] as const;
    for (const key of REPAIRED) {
      const enValue = EN.get(key);
      expect(typeof enValue, `en ${key} missing`).toBe('string');
      for (const lang of NON_LATIN) {
        const value = PACKS[lang].get(key);
        expect(typeof value, `${lang} ${key} missing`).toBe('string');
        expect((value as string).trim().length, `${lang} ${key} is empty`).toBeGreaterThan(0);
        expect(value, `${lang} ${key} is back to the English value`).not.toBe(enValue);
      }
    }

    // `appDesigner.snakeCaseHint` keeps the two IDENTIFIERS it is about. They are
    // code, not prose — a pack that "translated" them would document a rule the
    // validator does not enforce.
    for (const lang of NON_LATIN) {
      const hint = PACKS[lang].get('appDesigner.snakeCaseHint') as string;
      expect(hint, `${lang} lost the snake_case identifier`).toContain('snake_case');
      expect(hint, `${lang} lost the my_app example`).toContain('my_app');
    }
  });
});
