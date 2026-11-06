/**
 * @object-ui/i18n - Locale index — the explicit ALL TEN door.
 *
 * ⛔ This module is NOT reachable from the package entry any more
 * (objectui#7479). Importing it pulls every catalogue this package ships —
 * ~1.8 MB raw / ~450 KB gzipped — which is exactly the eager payload that card
 * removed from the console. The entry exposes `en` plus
 * `loadBuiltInLocale()` instead; see `./registry.js`.
 *
 * What it is still for, and the only two things it is for:
 *
 *   - the parity / drift suites, which must compare all ten packs at once and
 *     run in Node, where a megabyte of translations costs nobody anything;
 *   - an app that deliberately wants every catalogue resident, which reaches it
 *     through the published `@object-ui/i18n/locales` subpath — a specifier
 *     that says what it costs.
 *
 * ⚠️ Anything on a page-load path belongs on `./registry.js`, not here.
 *
 * ## Each catalogue here is COMPLETE: the pack plus its lazy namespaces
 *
 * Some of a language's strings are not in its pack: the `marketplace.*` group
 * is a lazy namespace (`../namespaces/marketplace/`), fetched when a
 * marketplace page mounts so the console's eager `en` pack does not carry it.
 * This door's two purposes both want every string, so each language it hands
 * out is its pack deep-merged with its catalogue from every such namespace:
 * the parity / drift suites keep walking the moved keys, and an app that makes
 * every catalogue resident gets the marketplace text resident too. A key in
 * both places is refused at module evaluation — the gates refuse it as well.
 *
 * ⚠️ So `en` here is not the same object as the package entry's `en`, which is
 * the RESIDENT pack alone (what an instance holds before any namespace has
 * loaded), nor as `@object-ui/i18n/locales/en`, the pack module itself.
 */
import enPack from './en.js';
import zhPack from './zh.js';
import jaPack from './ja.js';
import koPack from './ko.js';
import dePack from './de.js';
import frPack from './fr.js';
import esPack from './es.js';
import ptPack from './pt.js';
import ruPack from './ru.js';
import arPack from './ar.js';
import enMarketplace from '../namespaces/marketplace/en.js';
import zhMarketplace from '../namespaces/marketplace/zh.js';
import jaMarketplace from '../namespaces/marketplace/ja.js';
import koMarketplace from '../namespaces/marketplace/ko.js';
import deMarketplace from '../namespaces/marketplace/de.js';
import frMarketplace from '../namespaces/marketplace/fr.js';
import esMarketplace from '../namespaces/marketplace/es.js';
import ptMarketplace from '../namespaces/marketplace/pt.js';
import ruMarketplace from '../namespaces/marketplace/ru.js';
import arMarketplace from '../namespaces/marketplace/ar.js';

export type { TranslationKeys } from './en.js';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `pack` deep-merged with a namespace's partial pack. Groups both sides hold
 * (`marketplace`, `marketplace.install`) merge; a LEAF both sides hold is a
 * key defined twice, which no reader could resolve the same way twice, and
 * throws.
 */
function complete<P extends object, N extends object>(pack: P, partial: N, label: string): P & N {
  const merge = (into: Record<string, unknown>, from: Record<string, unknown>, at: string) => {
    const out: Record<string, unknown> = { ...into };
    for (const key of Object.keys(from)) {
      if (key === '__proto__') continue;
      const path = at ? `${at}.${key}` : key;
      if (isPlainObject(out[key]) && isPlainObject(from[key])) {
        out[key] = merge(out[key] as Record<string, unknown>, from[key] as Record<string, unknown>, path);
      } else if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new Error(`${label}: \`${path}\` is defined both in the pack and in a namespace catalogue.`);
      } else {
        out[key] = from[key];
      }
    }
    return out;
  };
  return merge(pack as Record<string, unknown>, partial as Record<string, unknown>, '') as P & N;
}

// Annotated rather than inferred: the inferred type spells the packs' literal
// types out inline in the emitted declaration, which outgrew what tsc will
// serialize (TS7056). Each `typeof` is emitted as a reference.
export const en: typeof enPack & typeof enMarketplace = complete(enPack, enMarketplace, 'en');
export const zh: typeof zhPack & typeof zhMarketplace = complete(zhPack, zhMarketplace, 'zh');
export const ja: typeof jaPack & typeof jaMarketplace = complete(jaPack, jaMarketplace, 'ja');
export const ko: typeof koPack & typeof koMarketplace = complete(koPack, koMarketplace, 'ko');
export const de: typeof dePack & typeof deMarketplace = complete(dePack, deMarketplace, 'de');
export const fr: typeof frPack & typeof frMarketplace = complete(frPack, frMarketplace, 'fr');
export const es: typeof esPack & typeof esMarketplace = complete(esPack, esMarketplace, 'es');
export const pt: typeof ptPack & typeof ptMarketplace = complete(ptPack, ptMarketplace, 'pt');
export const ru: typeof ruPack & typeof ruMarketplace = complete(ruPack, ruMarketplace, 'ru');
export const ar: typeof arPack & typeof arMarketplace = complete(arPack, arMarketplace, 'ar');

/**
 * Map of all built-in locales keyed by language code — each one complete (see
 * the header).
 */
export const builtInLocales: {
  readonly en: typeof en;
  readonly zh: typeof zh;
  readonly ja: typeof ja;
  readonly ko: typeof ko;
  readonly de: typeof de;
  readonly fr: typeof fr;
  readonly es: typeof es;
  readonly pt: typeof pt;
  readonly ru: typeof ru;
  readonly ar: typeof ar;
} = { en, zh, ja, ko, de, fr, es, pt, ru, ar } as const;

// Direction and the lazy registry live in payload-free modules so the runtime
// can reach them without reaching the ten packs above. Re-exported here so the
// historical import path keeps answering.
export { RTL_LANGUAGES, isRTL } from './rtl.js';
export {
  BUILT_IN_LANGUAGE_CODES,
  DEFAULT_BUILT_IN_LANGUAGE,
  getLoadedBuiltInLocales,
  isBuiltInLanguage,
  isBuiltInLocaleLoaded,
  loadBuiltInLocale,
  type LocaleCatalogue,
} from './registry.js';

import { registerBuiltInLocale } from './registry.js';

/**
 * Make every catalogue this module holds RESIDENT — synchronously, and without
 * a single `import()`.
 *
 * ⛔ Deliberately a CALL and not an import-time side effect: this package
 * declares `"sideEffects": false`, and a module that registered on import would
 * make that declaration false for every consumer's bundler. A caller that wants
 * all ten resident says so.
 *
 * Who calls it:
 *
 *   - a test that renders in a non-`en` locale and asserts SYNCHRONOUSLY. One
 *     line at module scope, next to the import that already paid for these ten
 *     modules, is the shape AGENTS.md prescribes for a cost that belongs in the
 *     import phase — ⛔ never a `beforeAll`, which is bounded by `hookTimeout`
 *     and only moves the race;
 *   - an app that deliberately ships every language resident and wants no
 *     fetch at switch time.
 *
 * ⚠️ It is NOT how a normal app boots. Calling it costs the whole ~1.8 MB of
 * catalogues on the page-load path, which is the payload objectui#7479 removed.
 * `preloadBootstrapLocale()` — one catalogue, the active one — is that path.
 */
export function registerBuiltInLocales(): void {
  for (const [code, catalogue] of Object.entries(builtInLocales)) {
    registerBuiltInLocale(code, catalogue as unknown as Record<string, unknown>);
  }
}
