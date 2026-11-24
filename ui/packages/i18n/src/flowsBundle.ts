/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The app's `flows` translation group, read back out of the i18next resource
 * tree the host already loaded — the ONE reader of that group in the UI.
 *
 * Every surface that names a flow in the reader's language reads it through
 * this module, so none can disagree about where the bundle lives: the
 * console's `FlowRunner` (the paused screen's field copy and option labels,
 * the flow's label, the resume's terminal toasts), the two flow-LAUNCH hosts
 * through `launchConsoleFlow` (objectui#12075), the flow designer's label
 * translations, and the stage-change confirms of the list cell and the record
 * page, which name the flows a move would start (objectstack#35928). It lives
 * here rather than in `@object-ui/app-shell` because the confirms' packages
 * do not depend on the console.
 *
 * The provider's `loadLanguage` hands the app's translation payload to
 * i18next (`transformSpecTranslations` forwards `flows` verbatim under the app
 * namespace), so there is no second loader. When the server declares a
 * fallback chain, the same loader also fetches each fallback locale's bundle
 * and lays its `flows` group beside the tree (objectstack#36809,
 * {@link withDeclaredFlowsFallback}), so a label the active language lacks
 * reads the fallback locale's text, as the server's does.
 */

import type { ResolveOptions, TranslationBundle, TranslationData } from '@objectstack/spec/system';

/** The `flows` group of a spec `TranslationData` — typed by the spec, so the address below is checked against it. */
export type FlowsTranslation = NonNullable<TranslationData['flows']>;

/**
 * The one member of the i18next instance the bundle read needs. Optional,
 * because outside a provider react-i18next hands back a placeholder object
 * that has none — and then there is no bundle, only the authored copy.
 */
export interface TranslationResourceReader {
  getResourceBundle?: (lng: string, ns: string) => unknown;
}

/**
 * Where a language's resource tree carries the server's declared fallback
 * chain and the fallback locales' `flows` groups (objectstack#36809). The
 * console's loader writes it beside the app namespace when it loads a
 * language ({@link withDeclaredFlowsFallback}); {@link activeFlowsBundle} and
 * {@link flowsResolveOptions} read it. It holds no `flows` member of its own,
 * so the namespace scan below never mistakes it for an app namespace, and no
 * `objects` / `settings` member, so the label readers' scans skip it too.
 */
export const DECLARED_FLOWS_FALLBACK_KEY = '__declaredFlowsFallback';

/** What a language's tree holds under {@link DECLARED_FLOWS_FALLBACK_KEY}. */
export interface DeclaredFlowsFallback {
  /** `GET /i18n/locales` `fallbackChain`: the locales the server consults after the requested one. */
  fallbackChain: string[];
  /** `GET /i18n/locales` `sourceLocale`: the authored language, the resolvers' `defaultLocale`. */
  defaultLocale?: string;
  /** Each fallback locale's `flows` group, keyed by the locale as the chain names it. */
  bundles: Record<string, { flows?: FlowsTranslation }>;
}

/**
 * `resources` (a language's app resource tree) with `fallback` laid beside
 * it under {@link DECLARED_FLOWS_FALLBACK_KEY}, or `resources` itself when
 * the server declares no chain. The one writer of that entry.
 */
export function withDeclaredFlowsFallback(
  resources: Record<string, unknown>,
  fallback: DeclaredFlowsFallback | undefined,
): Record<string, unknown> {
  if (!fallback || fallback.fallbackChain.length === 0) return resources;
  return { ...resources, [DECLARED_FLOWS_FALLBACK_KEY]: fallback };
}

function readTree(i18n: TranslationResourceReader | undefined, language: string): Record<string, unknown> | undefined {
  if (typeof i18n?.getResourceBundle !== 'function') return undefined;
  const tree = i18n.getResourceBundle(language, 'translation');
  return tree && typeof tree === 'object' ? (tree as Record<string, unknown>) : undefined;
}

function readDeclared(tree: Record<string, unknown> | undefined): DeclaredFlowsFallback | undefined {
  const entry = tree?.[DECLARED_FLOWS_FALLBACK_KEY] as Partial<DeclaredFlowsFallback> | undefined;
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.fallbackChain)) return undefined;
  const fallbackChain = entry.fallbackChain.filter((code): code is string => typeof code === 'string' && code.length > 0);
  if (fallbackChain.length === 0) return undefined;
  return {
    fallbackChain,
    defaultLocale: typeof entry.defaultLocale === 'string' && entry.defaultLocale ? entry.defaultLocale : undefined,
    bundles: entry.bundles && typeof entry.bundles === 'object' ? entry.bundles : {},
  };
}

const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * The spec `ResolveOptions` the flow-label readers hand the resolvers in
 * `language`: `{ locale: language }`, plus the server's declared
 * `fallbackChain` and `defaultLocale` when the loaded tree carries them. The
 * server's metadata translations pass the same three
 * (`metaTranslateOptions`, `@objectstack/rest`), so the console and the server
 * walk the same locales. With no declared chain the answer is
 * `{ locale: language }`: the requested locale, then the authored copy.
 */
export function flowsResolveOptions(i18n: TranslationResourceReader | undefined, language: string): ResolveOptions {
  const declared = readDeclared(readTree(i18n, language));
  if (!declared) return { locale: language };
  return {
    locale: language,
    fallbackChain: declared.fallbackChain,
    ...(declared.defaultLocale ? { defaultLocale: declared.defaultLocale } : {}),
  };
}

/**
 * The locales a lookup with `options` consults, in order — the walk the spec
 * resolvers run (`localeChain`, `@objectstack/spec/system` i18n-resolver,
 * not exported): the requested locale, then the declared `fallbackChain`,
 * unless the requested locale is the authored one (`defaultLocale`, tags
 * compared case-insensitively), duplicates dropped. For the keys no spec
 * resolver reads (a step's `nodes` / `screens` label, a screen field's copy);
 * `flowLabels-fallback-chain-36809.test.ts` pins it equal to the resolvers'.
 */
export function flowsLocaleChain(options: ResolveOptions): string[] {
  const locale = options.locale ?? 'en';
  const authored = typeof options.defaultLocale === 'string' && options.defaultLocale.length > 0
    && sameTag(locale, options.defaultLocale);
  const chain: string[] = [];
  for (const code of [locale, ...(authored ? [] : (options.fallbackChain ?? []))]) {
    if (!chain.includes(code)) chain.push(code);
  }
  return chain;
}

/**
 * The `flows` groups that translate `flowName` for `language`, as a spec
 * `TranslationBundle`, or `undefined` when none does.
 *
 * The active language's row comes from the app namespace at the top of its
 * resource tree (`app` for a spec payload, whatever the payload named for an
 * already-namespaced one): the first namespace whose `flows` group addresses
 * this flow. When the server declares a fallback chain (`GET /i18n/locales`
 * `fallbackChain`, objectstack#36809), each fallback locale whose `flows`
 * group addresses this flow adds its own row, keyed by the locale as the
 * chain names it, out of the entry the console's loader laid beside the tree
 * ({@link DECLARED_FLOWS_FALLBACK_KEY}).
 *
 * Ask the resolvers with {@link flowsResolveOptions}: a string the active
 * language does not carry then reads the declared fallback locale's text,
 * and the authored copy only after the whole chain, as on the server. With no
 * declared chain the bundle holds the active language alone and the options
 * are `{ locale: language }`: requested locale, then the authored copy.
 */
export function activeFlowsBundle(
  i18n: TranslationResourceReader | undefined,
  language: string,
  flowName: string,
): TranslationBundle | undefined {
  if (!flowName) return undefined;
  const tree = readTree(i18n, language);
  if (!tree) return undefined;
  const bundle: TranslationBundle = {};
  for (const [key, namespace] of Object.entries(tree)) {
    if (key === DECLARED_FLOWS_FALLBACK_KEY) continue;
    const flows = (namespace as { flows?: unknown } | null)?.flows;
    if (flows && typeof flows === 'object' && (flows as Record<string, unknown>)[flowName]) {
      bundle[language] = { flows: flows as FlowsTranslation };
      break;
    }
  }
  const declared = readDeclared(tree);
  for (const code of declared?.fallbackChain ?? []) {
    if (sameTag(code, language) || bundle[code]) continue;
    const flows = declared?.bundles[code]?.flows;
    if (flows && typeof flows === 'object' && flows[flowName]) bundle[code] = { flows };
  }
  return Object.keys(bundle).length > 0 ? bundle : undefined;
}
