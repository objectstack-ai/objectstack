// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The home-currency lock (ADR-0144 D4, multi-currency M1-3).
 *
 * The organization's home currency is `localization.currency`, and it is
 * locked "once a rate row or a home-amount declaration exists". Changing it
 * after that relabels every amount already converted into it: a stored home
 * amount and its rate were computed against the old code, and nothing would
 * recompute them. So once the currency is used:
 *
 *  - **The write is refused.** {@link localizationCurrencyWritePredicate} is the
 *    key's settings write predicate. A change to a set value — another code,
 *    or a clear — is refused while any `sys_exchange_rate` row of the
 *    organization exists, or any registered object declares
 *    `currencyConfig.homeAmount` on a field. The refusal names both.
 *  - **The page says so.** {@link localizationCurrencyLiveStatus} heads the
 *    Localization page with what uses the currency, in the caller's language.
 *
 * Setting the currency while it is UNSET is not a change of home currency:
 * nothing has been converted into a currency that does not exist, so that
 * write passes, and the page asks for it (ADR-0144 Open item 4, this card's
 * half: the lock never invents a default, and never blocks choosing one).
 *
 * "Used" reads the engine at each ask, never a flag recorded at boot: the lock
 * lifts by itself once the last rate row is deleted and the last `homeAmount`
 * declaration is removed.
 */

import { resolveLocale } from '@objectstack/core';
import type {
  SettingsLiveStatus,
  SettingsLiveStatusProvider,
  SettingsWritePredicate,
} from './settings-service.types.js';

/** The rate table of multi-currency M1-1, owned by `@objectstack/platform-objects`. */
export const EXCHANGE_RATE_OBJECT = 'sys_exchange_rate';

/** The engine surface the lock reads: a count, and the object registry. */
export interface CurrencyUsageEngine {
  count(
    objectName: string,
    query?: { where?: Record<string, unknown>; context?: Record<string, unknown> },
  ): Promise<number>;
  registry?: {
    getAllObjects?(): ReadonlyArray<unknown>;
    getObject?(name: string): unknown;
  };
}

/** What uses the home currency of one organization. */
export interface CurrencyUsage {
  /** Objects declaring `currencyConfig.homeAmount` on a field, in registry order. */
  objects: Array<{ name: string; label: string }>;
  /** The organization's `sys_exchange_rate` rows. */
  exchangeRates: number;
}

const SYSTEM_CONTEXT = Object.freeze({ isSystem: true as const });

type AnyRecord = Record<string, unknown>;
const isRecord = (v: unknown): v is AnyRecord => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Does any field of this object declare a home amount? */
function declaresHomeAmount(schema: AnyRecord): boolean {
  const fields = isRecord(schema.fields) ? schema.fields : {};
  return Object.values(fields).some(
    (def) => isRecord(def) && isRecord(def.currencyConfig) && isRecord(def.currencyConfig.homeAmount),
  );
}

/**
 * Read what uses the home currency. `organizationId` is the organization whose
 * rate rows count: an id, or `null` in a composition with no organization
 * object, whose rows carry none. Objects are deployment metadata, so every
 * organization sees the same ones.
 *
 * A composition that does not register `sys_exchange_rate` holds no rate rows.
 * Any other failure of the count propagates: the lock does not guess.
 */
export async function readCurrencyUsage(
  engine: CurrencyUsageEngine,
  organizationId: string | null,
): Promise<CurrencyUsage> {
  const objects: CurrencyUsage['objects'] = [];
  for (const schema of engine.registry?.getAllObjects?.() ?? []) {
    if (!isRecord(schema) || typeof schema.name !== 'string' || !declaresHomeAmount(schema)) continue;
    objects.push({ name: schema.name, label: typeof schema.label === 'string' ? schema.label : schema.name });
  }
  const registered = typeof engine.registry?.getObject === 'function'
    ? Boolean(engine.registry.getObject(EXCHANGE_RATE_OBJECT))
    : true;
  const exchangeRates = registered
    ? await engine.count(EXCHANGE_RATE_OBJECT, {
      // The organization filter is explicit: a system read carries no
      // organization, so nothing else scopes it.
      ...(organizationId !== null ? { where: { organization_id: organizationId } } : {}),
      context: SYSTEM_CONTEXT,
    })
    : 0;
  return { objects, exchangeRates };
}

const isUsed = (usage: CurrencyUsage): boolean => usage.objects.length > 0 || usage.exchangeRates > 0;

const isUnset = (value: unknown): boolean => value === null || value === undefined || value === '';

// ── Copy ─────────────────────────────────────────────────────────────────

/** How many object labels a sentence lists before it elides the rest. */
const LISTED_OBJECTS = 5;

interface CurrencyLockCopy {
  objects(count: number, labels: string): string;
  rates(count: number): string;
  and: string;
  listSeparator: string;
  refusal(current: string, usage: string): string;
  lockedLabel(current: string): string;
  lockedText(usage: string): string;
  unsetLabel: string;
  unsetText(usage: string): string;
}

/**
 * The lock's copy, one entry per locale the settings bundle ships
 * (`settingsBuiltinTranslations`). Kept here and not in that bundle: the
 * sentences are computed per request with counts and names, and the console's
 * banner lookup would replace a computed live-status text with a fixed one
 * (`SETTINGS_LIVE_STATUS_BANNER_ID`).
 */
export const CURRENCY_LOCK_COPY: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', CurrencyLockCopy> = {
  en: {
    objects: (n, labels) => `${n} ${n === 1 ? 'object' : 'objects'} (${labels})`,
    rates: (n) => `${n} ${n === 1 ? 'exchange rate' : 'exchange rates'}`,
    and: ' and ',
    listSeparator: ', ',
    refusal: (current, usage) =>
      `The default currency is locked at ${current} because it is in use by ${usage}. ` +
      'Changing it would relabel every amount already converted into it. It can change again only once ' +
      'no exchange rate is recorded and no object declares a home-currency amount.',
    lockedLabel: (current) => `Default currency locked: ${current}`,
    lockedText: (usage) =>
      `In use by ${usage}. Converted amounts are stored in this currency, so it can no longer be changed.`,
    unsetLabel: 'No default currency set',
    unsetText: (usage) =>
      'Exchange rates and home-currency amounts need a default currency, and none is set. ' +
      `In use: ${usage}. Choose it below; once saved, it cannot be changed.`,
  },
  'zh-CN': {
    objects: (n, labels) => `${n} 个对象（${labels}）`,
    rates: (n) => `${n} 条汇率`,
    and: '和 ',
    listSeparator: '、',
    refusal: (current, usage) =>
      `默认币种已锁定为 ${current}：它已被 ${usage}使用。修改它会给所有已换算成该币种的金额换上错误的币种。` +
      '只有在不再有任何汇率记录、也没有任何对象声明本位币金额之后，才能修改。',
    lockedLabel: (current) => `默认币种已锁定：${current}`,
    lockedText: (usage) => `已被 ${usage}使用。换算后的金额都以该币种存储，因此不能再修改。`,
    unsetLabel: '尚未设置默认币种',
    unsetText: (usage) =>
      `汇率和本位币金额都需要默认币种，但目前尚未设置。使用情况：${usage}。请在下方选择；保存后将无法修改。`,
  },
  'ja-JP': {
    objects: (n, labels) => `${n} 件のオブジェクト（${labels}）`,
    rates: (n) => `${n} 件の為替レート`,
    and: 'と ',
    listSeparator: '、',
    refusal: (current, usage) =>
      `既定の通貨は ${current} でロックされています。${usage}で使用されているためです。` +
      '変更すると、この通貨に換算済みのすべての金額に誤った通貨が付きます。' +
      '為替レートが 1 件もなく、基準通貨の金額を宣言するオブジェクトもなくなった場合にのみ変更できます。',
    lockedLabel: (current) => `既定の通貨はロックされています: ${current}`,
    lockedText: (usage) => `${usage}で使用中です。換算後の金額はこの通貨で保存されるため、変更できません。`,
    unsetLabel: '既定の通貨が設定されていません',
    unsetText: (usage) =>
      '為替レートと基準通貨の金額には既定の通貨が必要ですが、まだ設定されていません。' +
      `使用状況: ${usage}。下で選択してください。保存後は変更できません。`,
  },
  'es-ES': {
    objects: (n, labels) => `${n} ${n === 1 ? 'objeto' : 'objetos'} (${labels})`,
    rates: (n) => `${n} ${n === 1 ? 'tipo de cambio' : 'tipos de cambio'}`,
    and: ' y ',
    listSeparator: ', ',
    refusal: (current, usage) =>
      `La moneda predeterminada está bloqueada en ${current} porque está en uso en ${usage}. ` +
      'Cambiarla volvería a etiquetar todos los importes ya convertidos a ella. Solo podrá cambiarse ' +
      'cuando no quede ningún tipo de cambio y ningún objeto declare un importe en la moneda principal.',
    lockedLabel: (current) => `Moneda predeterminada bloqueada: ${current}`,
    lockedText: (usage) =>
      `En uso en ${usage}. Los importes convertidos se guardan en esta moneda, por lo que ya no se puede cambiar.`,
    unsetLabel: 'No hay moneda predeterminada',
    unsetText: (usage) =>
      'Los tipos de cambio y los importes en la moneda principal necesitan una moneda predeterminada, ' +
      `y no hay ninguna. En uso: ${usage}. Elíjala abajo; una vez guardada, no se podrá cambiar.`,
  },
};

const COPY_LOCALES = Object.keys(CURRENCY_LOCK_COPY);

/** The copy for a caller's locale: exact, then by language, else English. */
export function currencyLockCopy(locale: string | undefined): CurrencyLockCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return CURRENCY_LOCK_COPY[(picked ?? 'en') as keyof typeof CURRENCY_LOCK_COPY];
}

/** "2 objects (Invoice, Order) and 14 exchange rates", in the copy's language. */
export function describeCurrencyUsage(copy: CurrencyLockCopy, usage: CurrencyUsage): string {
  const parts: string[] = [];
  if (usage.objects.length > 0) {
    const listed = usage.objects.slice(0, LISTED_OBJECTS).map((o) => o.label);
    const labels = listed.join(copy.listSeparator) + (usage.objects.length > LISTED_OBJECTS ? '…' : '');
    parts.push(copy.objects(usage.objects.length, labels));
  }
  if (usage.exchangeRates > 0) parts.push(copy.rates(usage.exchangeRates));
  return parts.join(copy.and);
}

/** The discrete values a refusal carries (`FieldError.constraint`). */
function usageConstraint(usage: CurrencyUsage): Record<string, unknown> {
  return {
    lockedBy: 'in_use',
    objects: usage.objects.map((o) => o.name),
    exchangeRates: usage.exchangeRates,
  };
}

// ── The predicate and the statement ──────────────────────────────────────

/**
 * `localization.currency`'s write predicate: a change to a SET currency is
 * refused while the currency is used. Setting it while unset passes.
 */
export function localizationCurrencyWritePredicate(engine: CurrencyUsageEngine): SettingsWritePredicate {
  return async ({ current, organizationId, locale }) => {
    if (isUnset(current)) return undefined;
    const usage = await readCurrencyUsage(engine, organizationId ?? null);
    if (!isUsed(usage)) return undefined;
    const copy = currencyLockCopy(locale);
    return {
      message: copy.refusal(String(current), describeCurrencyUsage(copy, usage)),
      constraint: usageConstraint(usage),
    };
  };
}

/**
 * The Localization page's statement: what uses the home currency, and that it
 * is locked — or, while it is unset, that it is needed. Nothing to state while
 * nothing uses it.
 *
 * Reads the currency the caller's page resolves through `currentCurrency`, so
 * the statement and the form below it name the same value.
 */
export function localizationCurrencyLiveStatus(
  engine: CurrencyUsageEngine,
  currentCurrency: (ctx: Parameters<SettingsLiveStatusProvider>[0]['ctx']) => Promise<unknown>,
): SettingsLiveStatusProvider {
  return async ({ ctx, organizationId, locale }): Promise<SettingsLiveStatus | undefined> => {
    const organization = await organizationId();
    if (organization === undefined) return undefined;
    const usage = await readCurrencyUsage(engine, organization);
    if (!isUsed(usage)) return undefined;
    const copy = currencyLockCopy(locale);
    const described = describeCurrencyUsage(copy, usage);
    const current = await currentCurrency(ctx);
    if (isUnset(current)) {
      return { label: copy.unsetLabel, bannerText: copy.unsetText(described), bannerSeverity: 'warning' };
    }
    return { label: copy.lockedLabel(String(current)), bannerText: copy.lockedText(described), bannerSeverity: 'info' };
  };
}

/** The service surface the lock registers on. */
export interface CurrencyLockHost {
  getManifest(namespace: string): unknown;
  registerWritePredicate(namespace: string, key: string, predicate: SettingsWritePredicate): void;
  registerLiveStatus(namespace: string, provider: SettingsLiveStatusProvider): void;
  get(namespace: string, key: string, ctx?: Parameters<SettingsLiveStatusProvider>[0]['ctx']): Promise<{ value: unknown }>;
}

/**
 * Register the lock on a settings service bound to `engine`. Returns `false`,
 * registering nothing, when the service carries no `localization` namespace
 * (a host that replaced the built-in manifests).
 */
export function registerLocalizationCurrencyLock(host: CurrencyLockHost, engine: CurrencyUsageEngine): boolean {
  try {
    host.getManifest('localization');
  } catch {
    return false;
  }
  host.registerWritePredicate('localization', 'currency', localizationCurrencyWritePredicate(engine));
  host.registerLiveStatus(
    'localization',
    localizationCurrencyLiveStatus(engine, async (ctx) => (await host.get('localization', 'currency', ctx)).value),
  );
  return true;
}
