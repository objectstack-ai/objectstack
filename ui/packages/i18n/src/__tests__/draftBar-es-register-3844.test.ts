/**
 * `preview.draftBar` speaks ONE second person in `es` — usted (objectui#3844).
 *
 * ## The defect this pins
 *
 * `DraftPreviewBar` renders two mutually exclusive sentences in the same strip
 * of the same banner: `message` when there are unpublished changes,
 * `messageClean` when there are none. In `es` the two disagreed on register —
 * `message` was tú (`estás viendo`, `publiques`) while `messageClean` (`ve`)
 * and `sampleDataBody` (`Está`, `su`, `Publíquela`) were usted. A Spanish user
 * who pressed Publish watched the banner switch from tú to usted: same
 * component, same position, same session.
 *
 * ## Why usted is the answer here (the ruling, not a preference)
 *
 * Three independent readings, all measured rather than guessed:
 *
 *   1. **Pack default.** The `es` pack censuses 102 usted markers against 30
 *      tú. tú is the marked exception, concentrated in auth sign-in/sign-up,
 *      the report editor and organizations — neighbourhoods objectui#3546
 *      slice two deliberately ruled informal. `preview` is not one of them.
 *   2. **Same banner, same voice.** The other two strings of this very object
 *      (`messageClean`, `sampleDataBody`) were already usted, and so is
 *      `publishCta`. Aligning the one outlier is a strictly smaller change
 *      than re-voicing the namespace, and it is the change that removes the
 *      user-visible switch.
 *   3. **The sister banner.** objectui#3546 slice five gave the 19 new
 *      `preview.unpublishedBar.*` / `preview.history.*` keys usted, on the
 *      strength of `home.pendingDrafts.published` ("¡Publicado! Sus cambios
 *      están activos."), the structural twin of
 *      `preview.unpublishedBar.published`. Leaving `draftBar.message` tú would
 *      have made the older banner disagree with its freshly-translated sister.
 *
 * Direction B (re-voicing all of `preview` to tú) was rejected: it is a much
 * larger change and would collide with the adjacent `marketplace.*` (9:0
 * usted) and `console.ai.*`.
 *
 * ## What this file deliberately does NOT do
 *
 * **No morphological register detection.** objectui#3844 evaluated a gate that
 * checks "one register per namespace" and argued it down. Recognising usted vs
 * tú needs real morphology, and token matching demonstrably cannot: in this
 * very pack the token `revisa` is **usted** in `console.ai.empty.build`
 * (es.ts:1365, "…y usted revisa y publica.", present indicative with an
 * explicit `usted`) and **tú** in `auth.forgotPassword.successTitle`
 * (es.ts:1918, "Revisa tu correo electrónico", imperative). Same eight
 * letters, opposite registers, and no regex over the string can tell them
 * apart. The reverse error is just as easy: third-person and impersonal forms
 * read as usted markers — a crude `puede|su|…` scan over `approvalsInbox`
 * returns five "usted" hits that are all about *el solicitante* or are
 * impersonal ("No se puede determinar la identidad"), in a namespace whose
 * second-person address is in fact uniformly tú (nine strings). objectui#3844
 * recorded this hazard as "the census regex miscounted `Revisa`"; the
 * measurement above is the precise version — the miscount is the usted
 * indicative at :1365, not an imperative. Worse, the boundary such a gate
 * would police — which neighbourhood is informal — is human judgement (slice
 * two's "same rule, different answer" precedent), so a gate could only ever
 * check consistency *within* a boundary it cannot draw.
 * This file therefore pins **these four literal values, byte for byte**, and
 * generalises to nothing. The retired-spelling checks below are exact
 * substrings lifted from the pre-fix value of this one key — the same
 * technique as `viewReadonlyTooltip-semantics-3625.test.ts` — not a register
 * rule in disguise.
 *
 * Scope note: `preview.empty.notReadyDescription` (es.ts:3286, `Revisa`) is
 * still tú and is left that way here, because re-voicing the namespace is the
 * rejected direction B and objectui#3844's ruling is this banner only. It is
 * **not** harmless, and this file does not pin it: `PreviewDraftEmptyState`
 * (`AppContent.tsx`, returned while `previewDrafts` and the app is not yet
 * staged) renders in the content area *underneath* `DraftPreviewBar`
 * (`ConsoleLayout.tsx`), so those two are on screen at the SAME time — usted in
 * the bar, tú in the pane below it. That is sharper than objectui#3844's own
 * sequential switch and is filed separately as objectui#3875. After this change
 * the `preview` namespace is 23 usted to that 1 tú.
 *
 * Related: objectui#3546 (slice five measured this while ruling es register),
 * objectui#3810 / objectui#3582 / objectui#3625 (the other value-domain blind
 * spots), objectui#3530 (call-site gate), objectui#3650 (en-drift gate). None
 * of the three i18n gates can see this defect: the call-site gate only asks
 * whether a key exists in `en`, `all-locales-key-parity` compares key names
 * and placeholder shapes and never reads values, and the en-drift gate only
 * fires when an `en` value moves — these two `en` values never moved.
 */
import { describe, it, expect } from 'vitest';
import { builtInLocales } from '../locales';

type Bag = Record<string, any>;

// Derived from the map rather than left as `string`: `builtInLocales[lang]` on a
// plain `string` is an implicit-`any` index into a `const` map (TS7053), and the
// `as Bag` cast is about the pack's untyped inner shape — it could never have
// covered the index itself. Only `'es'` and `'en'` are ever passed here, and now
// a typo in either is a compile error rather than a silent `undefined` that the
// anti-empty-green case would have to catch at runtime. Same convention as
// `authRemediation-locale-parity.test.ts` next door.
type LocaleCode = keyof typeof builtInLocales;
const draftBar = (lang: LocaleCode) => (builtInLocales[lang] as Bag)?.preview?.draftBar as Bag;
const at = (lang: LocaleCode, key: string) => draftBar(lang)?.[key] as string;

/** The four `es` values this file owns, at their post-objectui#3844 final bytes. */
const ES_FINAL = {
  message:
    'Vista previa del borrador — está viendo cambios sin publicar. Nada de lo que ve aquí está activo hasta que publique.',
  messageClean:
    'Vista previa del borrador — no hay cambios sin publicar; todo lo que ve aquí ya está activo.',
  sampleDataBody:
    'Está viendo la estructura de su aplicación. Publíquela para cargar registros de ejemplo y activarla.',
  publishCta: 'Publicar para verlo activo',
} as const;

/** `en`'s current wording. If either moves, the `es` pins above must be revisited. */
const EN_CURRENT = {
  message: 'Draft preview — you are seeing unpublished changes. Nothing here is live until you publish.',
  messageClean: 'Draft preview — no unpublished changes; everything here is already live.',
} as const;

/**
 * Exact substrings the pre-fix `es` value held, scoped to this key. Each names
 * one sub-change of the fix, so a red points at which one came back:
 *   - the tú morphology (`estás viendo`, `publiques`);
 *   - `en producción` for "live", which the pack spells `activo` (see
 *     `publishCta` in this same object, `home.pendingDrafts.published`) and
 *     which additionally collides with the pack's *production environment*
 *     sense in `environment.entitlement.planLockedBody`;
 *   - `Vista previa de borrador`, the prefix that differed from
 *     `messageClean`'s `Vista previa del borrador` so the banner's two halves
 *     opened with different words where `en`'s both open "Draft preview — ".
 */
const RETIRED_SPELLINGS = [
  'estás viendo',
  'publiques',
  'en producción',
  'Vista previa de borrador',
] as const;

const EM_DASH = '—';
const BANNER_PREFIX = `Vista previa del borrador ${EM_DASH} `;

describe('preview.draftBar es register (objectui#3844)', () => {
  it('the keys this file pins are present and non-empty', () => {
    // Anti-empty-green: every assertion below reads one of these four values,
    // and a renamed or dropped key would otherwise let the negative checks
    // pass on `undefined`.
    for (const key of Object.keys(ES_FINAL)) {
      const value = at('es', key);
      expect(typeof value, `es preview.draftBar.${key}`).toBe('string');
      expect(value.trim().length, `es preview.draftBar.${key} is empty`).toBeGreaterThan(0);
    }
    for (const key of Object.keys(EN_CURRENT)) {
      expect(typeof at('en', key), `en preview.draftBar.${key}`).toBe('string');
    }
  });

  it.each(Object.entries(ES_FINAL))('es preview.draftBar.%s is exactly the ruled value', (key, expected) => {
    // THE assertion. Byte-exact on purpose: register lives in individual
    // morphemes (está vs estás, publique vs publiques), so a substring or
    // regex check would let a partial re-edit through.
    expect(at('es', key)).toBe(expected);
  });

  it('no retired spelling of the tú/en-producción wording is back', () => {
    // Red before the fix on `message` for three of these four literals; kept
    // as the named tripwire so a future re-edit that reintroduces one fails
    // with the offending literal in the message rather than as an opaque
    // byte diff.
    for (const key of Object.keys(ES_FINAL)) {
      const value = at('es', key);
      for (const retired of RETIRED_SPELLINGS) {
        expect(value.includes(retired), `es preview.draftBar.${key} reintroduced "${retired}"`).toBe(
          false,
        );
      }
    }
  });

  it('both halves of the banner open with the same words and the same em-dash', () => {
    // The structural half of the fix, stated as its own claim: `en` opens both
    // sentences "Draft preview — ", so `es` must open both identically too.
    // `messageClean` used to separate with a colon, which made the banner
    // change punctuation as well as person when the user published.
    expect(at('es', 'message').startsWith(BANNER_PREFIX)).toBe(true);
    expect(at('es', 'messageClean').startsWith(BANNER_PREFIX)).toBe(true);
    expect(at('es', 'messageClean')).not.toContain('borrador:');
    for (const key of ['message', 'messageClean']) {
      expect(at('en', key).startsWith(`Draft preview ${EM_DASH} `), `en ${key} prefix`).toBe(true);
    }
  });

  it('all four values spell "live" with the pack\'s own word', () => {
    // "Same concept, same word" — the stem covers `activo` (message,
    // messageClean, publishCta) and `activarla` (sampleDataBody). Paired with
    // the `en producción` literal above: this side proves the replacement is
    // present, that side proves the outlier is gone.
    for (const key of Object.keys(ES_FINAL)) {
      expect(at('es', key), `es preview.draftBar.${key} lost the pack's word for "live"`).toContain(
        'activ',
      );
    }
  });

  it('en still says what the es values were translated against', () => {
    // objectui#3650's gate only fires when an `en` value changes, and it asks
    // the nine packs to follow — it cannot know this `es` ruling. This line
    // goes red in the same PR that rewords either `en` sentence, which is what
    // forces the usted rewrite above to be re-read then.
    expect(at('en', 'message')).toBe(EN_CURRENT.message);
    expect(at('en', 'messageClean')).toBe(EN_CURRENT.messageClean);
  });

  it('es serves neither en sentence verbatim', () => {
    // The objectui#3582 failure mode (English pasted into a translation pack)
    // applied to these keys. Green before this fix too — recorded as a guard
    // against a future paste, not as evidence for objectui#3844.
    const english = Object.values(EN_CURRENT) as string[];
    expect(english).not.toContain(at('es', 'message'));
    expect(english).not.toContain(at('es', 'messageClean'));
  });
});
