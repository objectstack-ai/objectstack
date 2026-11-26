// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The model configuration of the `ai` settings namespace: which providers are
 * on, the models each one offers, the default model and the structured-output
 * model, read from the namespace's values; and the save rule that keeps the
 * two chosen models among the models the providers that are on offer.
 *
 * ## The keys
 *
 * - `provider`: the default provider. It is always on.
 * - `<provider>_enabled`: turns another provider on beside the default one.
 * - `<provider>_model`: the provider's first model; `<provider>_models`: its
 *   further models, one id per line (a comma also separates). A provider's
 *   models are the first model followed by the further ones, without repeats.
 * - `default_model`: the default model, one of the default provider's models;
 *   blank means that provider's first model.
 * - `structured_output_provider` / `structured_output_model`: the model strict
 *   structured-output calls use, a knob separate from the default model. A
 *   blank provider means the default provider; a blank model means the
 *   provider's first model.
 *
 * ## Values stored before these keys existed
 *
 * They read unchanged, with no rewrite of a stored row: a stored `provider`
 * with its `<provider>_model` and none of the keys above is that provider on,
 * that model its only model, and the default model.
 *
 * ## The save rule
 *
 * Fallback happens here, when the configuration is saved: a default or
 * structured-output model that is not among the chosen provider's models, or a
 * structured-output provider that is off, is refused at the save. A reader of
 * the configuration (the AI runtime) is handed exactly the models listed here
 * and never swaps one model for another at run time.
 */

import { resolveLocale } from '@objectstack/core';
import type { SettingsManifest } from '@objectstack/spec/system';
import type { SettingsCopyLocale } from '../settings-copy-locale.js';
import type {
  SettingsWritePredicate,
  SettingsWritePredicateInput,
  SettingsWriteRefusal,
} from '../settings-service.types.js';

/** The providers the `ai` page offers, in the order it lists them. */
export const AI_PROVIDERS = [
  { id: 'gateway', label: 'Vercel AI Gateway' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'google', label: 'Google Generative AI' },
  { id: 'deepseek', label: 'DeepSeek' },
  { id: 'dashscope', label: '阿里通义 DashScope' },
  { id: 'cloudflare', label: 'Cloudflare AI Gateway' },
  { id: 'siliconflow', label: '硅基流动 SiliconFlow' },
  { id: 'openrouter', label: 'OpenRouter' },
] as const;

/** A provider id of the `ai` page. */
export type AiProviderId = (typeof AI_PROVIDERS)[number]['id'];

const PROVIDER_IDS: ReadonlySet<string> = new Set(AI_PROVIDERS.map((p) => p.id));

/** One provider that is on, with the models it offers. */
export interface AiProviderModels {
  provider: AiProviderId;
  models: string[];
}

/** A chosen model: the provider that serves it and the model id. */
export interface AiModelChoice {
  provider: AiProviderId;
  model: string;
}

/** The model configuration the `ai` namespace's values describe. */
export interface AiModelConfiguration {
  /** The providers that are on, the default provider first, then in page order. */
  providers: AiProviderModels[];
  /** The default model; `null` while no default provider (or no model of it) is set. */
  defaultModel: AiModelChoice | null;
  /** The structured-output model; `null` while it has no provider or model. */
  structuredOutputModel: AiModelChoice | null;
}

const blank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

const text = (value: unknown): string => (blank(value) ? '' : String(value).trim());

/** The provider a value names, or `undefined` when it names none of the page's. */
function providerOf(value: unknown): AiProviderId | undefined {
  const id = text(value);
  return PROVIDER_IDS.has(id) ? (id as AiProviderId) : undefined;
}

/** A model list as written: ids separated by line breaks or commas, trimmed, without blanks or repeats. */
export function parseAiModelList(value: unknown): string[] {
  if (blank(value)) return [];
  const raw = Array.isArray(value) ? value.map(String) : String(value).split(/[\n,]/);
  return [...new Set(raw.map((id) => id.trim()).filter((id) => id !== ''))];
}

/** A provider's models: its first model, then its further models, without repeats. */
export function aiProviderModels(values: Readonly<Record<string, unknown>>, provider: AiProviderId): string[] {
  const first = text(values[`${provider}_model`]);
  return [...new Set([...(first ? [first] : []), ...parseAiModelList(values[`${provider}_models`])])];
}

/** Whether a provider is on: it is the default provider, or its `<provider>_enabled` is on. */
export function isAiProviderEnabled(values: Readonly<Record<string, unknown>>, provider: AiProviderId): boolean {
  return providerOf(values.provider) === provider || values[`${provider}_enabled`] === true;
}

/**
 * The model configuration the `ai` namespace's values describe, read as the
 * module header states (values stored before the multi-provider keys read as
 * one provider on, its model the default). `values` are the values in effect,
 * manifest defaults included: what `SettingsService.getNamespace('ai')` serves.
 */
export function resolveAiModelConfiguration(values: Readonly<Record<string, unknown>>): AiModelConfiguration {
  const defaultProvider = providerOf(values.provider);
  const providers: AiProviderModels[] = [];
  const order = defaultProvider
    ? [defaultProvider, ...AI_PROVIDERS.map((p) => p.id).filter((id) => id !== defaultProvider)]
    : AI_PROVIDERS.map((p) => p.id);
  for (const provider of order) {
    if (isAiProviderEnabled(values, provider)) providers.push({ provider, models: aiProviderModels(values, provider) });
  }
  const choose = (provider: AiProviderId | undefined, model: unknown): AiModelChoice | null => {
    if (!provider) return null;
    const id = text(model) || aiProviderModels(values, provider)[0];
    return id ? { provider, model: id } : null;
  };
  return {
    providers,
    defaultModel: choose(defaultProvider, values.default_model),
    structuredOutputModel: choose(providerOf(values.structured_output_provider) ?? defaultProvider, values.structured_output_model),
  };
}

// ── The save rule ───────────────────────────────────────────────────────────

/** The rules a save of the `ai` model configuration is held to. */
export type AiModelRule =
  | 'default_model_without_provider'
  | 'default_model_not_listed'
  | 'structured_output_provider_off'
  | 'structured_output_model_without_provider'
  | 'structured_output_model_not_listed';

/** One way a model configuration breaks the save rule, with the keys it involves. */
export interface AiModelRuleBreach {
  rule: AiModelRule;
  /** The keys whose change can cause this breach; a save is refused at the ones it changes. */
  keys: string[];
  provider?: AiProviderId;
  model?: string;
  models?: string[];
}

/**
 * Every way `values` break the save rule (module header), in the order the
 * keys appear on the page. Empty when the configuration may be saved.
 */
export function aiModelRuleBreaches(values: Readonly<Record<string, unknown>>): AiModelRuleBreach[] {
  const breaches: AiModelRuleBreach[] = [];
  const defaultProvider = providerOf(values.provider);
  const defaultModel = text(values.default_model);
  if (defaultModel && !defaultProvider) {
    breaches.push({ rule: 'default_model_without_provider', keys: ['provider', 'default_model'], model: defaultModel });
  } else if (defaultModel && defaultProvider) {
    const models = aiProviderModels(values, defaultProvider);
    if (!models.includes(defaultModel)) {
      breaches.push({
        rule: 'default_model_not_listed',
        keys: ['provider', 'default_model', `${defaultProvider}_model`, `${defaultProvider}_models`],
        provider: defaultProvider,
        model: defaultModel,
        models,
      });
    }
  }

  const namedProvider = providerOf(values.structured_output_provider);
  const structuredProvider = namedProvider ?? defaultProvider;
  const structuredModel = text(values.structured_output_model);
  if (namedProvider && !isAiProviderEnabled(values, namedProvider)) {
    breaches.push({
      rule: 'structured_output_provider_off',
      keys: ['structured_output_provider', 'provider', `${namedProvider}_enabled`],
      provider: namedProvider,
    });
  } else if (structuredModel && !structuredProvider) {
    breaches.push({
      rule: 'structured_output_model_without_provider',
      keys: ['structured_output_model', 'structured_output_provider', 'provider'],
      model: structuredModel,
    });
  } else if (structuredModel && structuredProvider) {
    const models = aiProviderModels(values, structuredProvider);
    if (!models.includes(structuredModel)) {
      breaches.push({
        rule: 'structured_output_model_not_listed',
        keys: [
          'structured_output_model',
          'structured_output_provider',
          ...(namedProvider ? [] : ['provider']),
          `${structuredProvider}_model`,
          `${structuredProvider}_models`,
        ],
        provider: structuredProvider,
        model: structuredModel,
        models,
      });
    }
  }
  return breaches;
}

/** The keys the save rule reads; its write predicate is registered on each. */
export const AI_MODEL_RULE_KEYS: readonly string[] = Object.freeze([
  'provider',
  'default_model',
  'structured_output_provider',
  'structured_output_model',
  ...AI_PROVIDERS.flatMap((p) => [`${p.id}_enabled`, `${p.id}_model`, `${p.id}_models`]),
]);

// ── The refusal's copy ──────────────────────────────────────────────────────

/** The refusal sentences, per language. */
export interface AiModelRuleCopy {
  listSeparator: string;
  noModels: string;
  defaultModelWithoutProvider(model: string): string;
  defaultModelNotListed(model: string, provider: string, models: string): string;
  structuredProviderOff(provider: string): string;
  structuredModelWithoutProvider(model: string): string;
  structuredModelNotListed(model: string, provider: string, models: string): string;
}

/**
 * The save rule's copy, one entry per language on the platform locale table
 * ({@link SettingsCopyLocale}). Kept here and not in the settings bundle: the
 * sentences carry the model and provider of each refusal.
 */
export const AI_MODEL_RULE_COPY: Record<SettingsCopyLocale, AiModelRuleCopy> = {
  en: {
    listSeparator: ', ',
    noModels: 'no models',
    defaultModelWithoutProvider: (m) => `The default model "${m}" needs a default provider. Choose the default provider first.`,
    defaultModelNotListed: (m, p, list) =>
      `The default model "${m}" is not one of the models listed for ${p} (${list}). Add it to that provider's models, or pick one of them.`,
    structuredProviderOff: (p) =>
      `The structured-output provider ${p} is turned off. Turn it on under Providers, or pick a provider that is on.`,
    structuredModelWithoutProvider: (m) =>
      `The structured-output model "${m}" needs a provider. Choose a structured-output provider or a default provider first.`,
    structuredModelNotListed: (m, p, list) =>
      `The structured-output model "${m}" is not one of the models listed for ${p} (${list}). Add it to that provider's models, or pick one of them.`,
  },
  'zh-CN': {
    listSeparator: '、',
    noModels: '未列出模型',
    defaultModelWithoutProvider: (m) => `默认模型「${m}」需要默认提供商。请先选择默认提供商。`,
    defaultModelNotListed: (m, p, list) => `默认模型「${m}」不在 ${p} 已列出的模型中（${list}）。请把它加入该提供商的模型，或从中选择一个。`,
    structuredProviderOff: (p) => `结构化输出提供商 ${p} 未开启。请在「提供商」中开启它，或选择一个已开启的提供商。`,
    structuredModelWithoutProvider: (m) => `结构化输出模型「${m}」需要提供商。请先选择结构化输出提供商或默认提供商。`,
    structuredModelNotListed: (m, p, list) =>
      `结构化输出模型「${m}」不在 ${p} 已列出的模型中（${list}）。请把它加入该提供商的模型，或从中选择一个。`,
  },
  'zh-Hant': {
    listSeparator: '、',
    noModels: '未列出模型',
    defaultModelWithoutProvider: (m) => `預設模型「${m}」需要預設提供者。請先選擇預設提供者。`,
    defaultModelNotListed: (m, p, list) => `預設模型「${m}」不在 ${p} 已列出的模型中（${list}）。請將它加入該提供者的模型，或從中選擇一個。`,
    structuredProviderOff: (p) => `結構化輸出提供者 ${p} 未開啟。請在「提供者」中開啟它，或選擇一個已開啟的提供者。`,
    structuredModelWithoutProvider: (m) => `結構化輸出模型「${m}」需要提供者。請先選擇結構化輸出提供者或預設提供者。`,
    structuredModelNotListed: (m, p, list) =>
      `結構化輸出模型「${m}」不在 ${p} 已列出的模型中（${list}）。請將它加入該提供者的模型，或從中選擇一個。`,
  },
  'ja-JP': {
    listSeparator: '、',
    noModels: 'モデルなし',
    defaultModelWithoutProvider: (m) => `既定のモデル「${m}」には既定のプロバイダーが必要です。先に既定のプロバイダーを選んでください。`,
    defaultModelNotListed: (m, p, list) =>
      `既定のモデル「${m}」は ${p} に登録されたモデル（${list}）に含まれていません。そのプロバイダーのモデルに追加するか、その中から選んでください。`,
    structuredProviderOff: (p) => `構造化出力のプロバイダー ${p} はオフです。「プロバイダー」でオンにするか、オンのプロバイダーを選んでください。`,
    structuredModelWithoutProvider: (m) =>
      `構造化出力のモデル「${m}」にはプロバイダーが必要です。先に構造化出力のプロバイダーか既定のプロバイダーを選んでください。`,
    structuredModelNotListed: (m, p, list) =>
      `構造化出力のモデル「${m}」は ${p} に登録されたモデル（${list}）に含まれていません。そのプロバイダーのモデルに追加するか、その中から選んでください。`,
  },
  ko: {
    listSeparator: ', ',
    noModels: '모델 없음',
    defaultModelWithoutProvider: (m) => `기본 모델 "${m}"에는 기본 공급자가 필요합니다. 먼저 기본 공급자를 선택하세요.`,
    defaultModelNotListed: (m, p, list) =>
      `기본 모델 "${m}"은(는) ${p}에 등록된 모델(${list})에 없습니다. 해당 공급자의 모델에 추가하거나 그중 하나를 선택하세요.`,
    structuredProviderOff: (p) => `구조화 출력 공급자 ${p}이(가) 꺼져 있습니다. 공급자에서 켜거나 켜져 있는 공급자를 선택하세요.`,
    structuredModelWithoutProvider: (m) =>
      `구조화 출력 모델 "${m}"에는 공급자가 필요합니다. 먼저 구조화 출력 공급자나 기본 공급자를 선택하세요.`,
    structuredModelNotListed: (m, p, list) =>
      `구조화 출력 모델 "${m}"은(는) ${p}에 등록된 모델(${list})에 없습니다. 해당 공급자의 모델에 추가하거나 그중 하나를 선택하세요.`,
  },
  'es-ES': {
    listSeparator: ', ',
    noModels: 'ningún modelo',
    defaultModelWithoutProvider: (m) =>
      `El modelo predeterminado «${m}» necesita un proveedor predeterminado. Elige primero el proveedor predeterminado.`,
    defaultModelNotListed: (m, p, list) =>
      `El modelo predeterminado «${m}» no está entre los modelos indicados para ${p} (${list}). Añádelo a los modelos de ese proveedor o elige uno de ellos.`,
    structuredProviderOff: (p) =>
      `El proveedor de salida estructurada ${p} está desactivado. Actívalo en Proveedores o elige un proveedor activado.`,
    structuredModelWithoutProvider: (m) =>
      `El modelo de salida estructurada «${m}» necesita un proveedor. Elige primero un proveedor de salida estructurada o un proveedor predeterminado.`,
    structuredModelNotListed: (m, p, list) =>
      `El modelo de salida estructurada «${m}» no está entre los modelos indicados para ${p} (${list}). Añádelo a los modelos de ese proveedor o elige uno de ellos.`,
  },
  fr: {
    listSeparator: ', ',
    noModels: 'aucun modèle',
    defaultModelWithoutProvider: (m) =>
      `Le modèle par défaut « ${m} » nécessite un fournisseur par défaut. Choisissez d'abord le fournisseur par défaut.`,
    defaultModelNotListed: (m, p, list) =>
      `Le modèle par défaut « ${m} » ne figure pas parmi les modèles indiqués pour ${p} (${list}). Ajoutez-le aux modèles de ce fournisseur ou choisissez-en un.`,
    structuredProviderOff: (p) =>
      `Le fournisseur de sortie structurée ${p} est désactivé. Activez-le dans Fournisseurs ou choisissez un fournisseur activé.`,
    structuredModelWithoutProvider: (m) =>
      `Le modèle de sortie structurée « ${m} » nécessite un fournisseur. Choisissez d'abord un fournisseur de sortie structurée ou un fournisseur par défaut.`,
    structuredModelNotListed: (m, p, list) =>
      `Le modèle de sortie structurée « ${m} » ne figure pas parmi les modèles indiqués pour ${p} (${list}). Ajoutez-le aux modèles de ce fournisseur ou choisissez-en un.`,
  },
  'pt-BR': {
    listSeparator: ', ',
    noModels: 'nenhum modelo',
    defaultModelWithoutProvider: (m) => `O modelo padrão "${m}" precisa de um provedor padrão. Escolha primeiro o provedor padrão.`,
    defaultModelNotListed: (m, p, list) =>
      `O modelo padrão "${m}" não está entre os modelos listados para ${p} (${list}). Adicione-o aos modelos desse provedor ou escolha um deles.`,
    structuredProviderOff: (p) =>
      `O provedor de saída estruturada ${p} está desativado. Ative-o em Provedores ou escolha um provedor ativado.`,
    structuredModelWithoutProvider: (m) =>
      `O modelo de saída estruturada "${m}" precisa de um provedor. Escolha primeiro um provedor de saída estruturada ou um provedor padrão.`,
    structuredModelNotListed: (m, p, list) =>
      `O modelo de saída estruturada "${m}" não está entre os modelos listados para ${p} (${list}). Adicione-o aos modelos desse provedor ou escolha um deles.`,
  },
  de: {
    listSeparator: ', ',
    noModels: 'keine Modelle',
    defaultModelWithoutProvider: (m) =>
      `Das Standardmodell „${m}“ braucht einen Standardanbieter. Wählen Sie zuerst den Standardanbieter.`,
    defaultModelNotListed: (m, p, list) =>
      `Das Standardmodell „${m}“ gehört nicht zu den für ${p} eingetragenen Modellen (${list}). Tragen Sie es bei diesem Anbieter ein oder wählen Sie eines davon.`,
    structuredProviderOff: (p) =>
      `Der Anbieter für strukturierte Ausgabe ${p} ist ausgeschaltet. Schalten Sie ihn unter Anbieter ein oder wählen Sie einen eingeschalteten Anbieter.`,
    structuredModelWithoutProvider: (m) =>
      `Das Modell für strukturierte Ausgabe „${m}“ braucht einen Anbieter. Wählen Sie zuerst einen Anbieter für strukturierte Ausgabe oder einen Standardanbieter.`,
    structuredModelNotListed: (m, p, list) =>
      `Das Modell für strukturierte Ausgabe „${m}“ gehört nicht zu den für ${p} eingetragenen Modellen (${list}). Tragen Sie es bei diesem Anbieter ein oder wählen Sie eines davon.`,
  },
  ru: {
    listSeparator: ', ',
    noModels: 'нет моделей',
    defaultModelWithoutProvider: (m) =>
      `Для модели по умолчанию «${m}» нужен провайдер по умолчанию. Сначала выберите провайдера по умолчанию.`,
    defaultModelNotListed: (m, p, list) =>
      `Модель по умолчанию «${m}» не входит в список моделей ${p} (${list}). Добавьте её в модели этого провайдера или выберите одну из них.`,
    structuredProviderOff: (p) =>
      `Провайдер структурированного вывода ${p} выключен. Включите его в разделе «Провайдеры» или выберите включённого провайдера.`,
    structuredModelWithoutProvider: (m) =>
      `Для модели структурированного вывода «${m}» нужен провайдер. Сначала выберите провайдера структурированного вывода или провайдера по умолчанию.`,
    structuredModelNotListed: (m, p, list) =>
      `Модель структурированного вывода «${m}» не входит в список моделей ${p} (${list}). Добавьте её в модели этого провайдера или выберите одну из них.`,
  },
  ar: {
    listSeparator: '، ',
    noModels: 'لا توجد نماذج',
    defaultModelWithoutProvider: (m) => `يحتاج النموذج الافتراضي "${m}" إلى مزوّد افتراضي. اختر المزوّد الافتراضي أولاً.`,
    defaultModelNotListed: (m, p, list) =>
      `النموذج الافتراضي "${m}" ليس من النماذج المدرجة لدى ${p} (${list}). أضفه إلى نماذج هذا المزوّد أو اختر أحدها.`,
    structuredProviderOff: (p) => `مزوّد المخرجات المنظَّمة ${p} متوقف. شغّله ضمن المزوّدين أو اختر مزوّدًا مشغّلًا.`,
    structuredModelWithoutProvider: (m) =>
      `يحتاج نموذج المخرجات المنظَّمة "${m}" إلى مزوّد. اختر أولاً مزوّد المخرجات المنظَّمة أو المزوّد الافتراضي.`,
    structuredModelNotListed: (m, p, list) =>
      `نموذج المخرجات المنظَّمة "${m}" ليس من النماذج المدرجة لدى ${p} (${list}). أضفه إلى نماذج هذا المزوّد أو اختر أحدها.`,
  },
};

const COPY_LOCALES = Object.keys(AI_MODEL_RULE_COPY);

/** The copy for a caller's locale: exact, then by language, else English. */
export function aiModelRuleCopy(locale: string | undefined): AiModelRuleCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return AI_MODEL_RULE_COPY[(picked ?? 'en') as SettingsCopyLocale];
}

const providerLabel = (id: AiProviderId): string => AI_PROVIDERS.find((p) => p.id === id)?.label ?? id;

/** A breach as the refusal the caller reads, in `locale`. */
export function aiModelRuleRefusal(breach: AiModelRuleBreach, locale?: string): SettingsWriteRefusal {
  const copy = aiModelRuleCopy(locale);
  const p = breach.provider ? providerLabel(breach.provider) : '';
  const m = breach.model ?? '';
  const list = breach.models && breach.models.length > 0 ? breach.models.join(copy.listSeparator) : copy.noModels;
  const message = {
    default_model_without_provider: () => copy.defaultModelWithoutProvider(m),
    default_model_not_listed: () => copy.defaultModelNotListed(m, p, list),
    structured_output_provider_off: () => copy.structuredProviderOff(p),
    structured_output_model_without_provider: () => copy.structuredModelWithoutProvider(m),
    structured_output_model_not_listed: () => copy.structuredModelNotListed(m, p, list),
  }[breach.rule]();
  return {
    message,
    constraint: {
      rule: breach.rule,
      ...(breach.provider ? { provider: breach.provider } : {}),
      ...(breach.model !== undefined ? { model: breach.model } : {}),
      ...(breach.models ? { models: breach.models } : {}),
    },
  };
}

// ── The write predicate ─────────────────────────────────────────────────────

/** How the predicate reads a key as it stands (the settings service's `get`). */
export type AiSettingReader = (
  key: string,
  ctx: SettingsWritePredicateInput['ctx'],
) => Promise<{ value?: unknown; source?: string } | undefined>;

/**
 * The write predicate shared by {@link AI_MODEL_RULE_KEYS}. It judges the state
 * after the whole save: each rule key the save sets is read from the save (a
 * cleared key as its manifest default), unless an environment override is in
 * force for it, which wins; every other rule key is read as it stands. It
 * refuses at the key being judged when a breach involves that key, so a save
 * that leaves the configuration as broken as it found it through keys it does
 * not set is not refused for them.
 */
export function aiModelRulePredicate(
  read: AiSettingReader,
  defaults: Readonly<Record<string, unknown>>,
): SettingsWritePredicate {
  return async (input) => {
    const batch = input.batch ?? { [input.key]: input.next };
    const values: Record<string, unknown> = {};
    for (const key of AI_MODEL_RULE_KEYS) {
      const now = await read(key, input.ctx);
      if (now?.source === 'env' || !Object.prototype.hasOwnProperty.call(batch, key)) {
        values[key] = now?.value;
      } else {
        values[key] = batch[key] ?? defaults[key];
      }
    }
    const breach = aiModelRuleBreaches(values).find((b) => b.keys.includes(input.key));
    return breach ? aiModelRuleRefusal(breach, input.locale) : undefined;
  };
}

/** The settings service surface the rule registers on (structural). */
export interface AiModelRuleHost {
  registerWritePredicate(namespace: string, key: string, predicate: SettingsWritePredicate): void;
  get(namespace: string, key: string, ctx?: unknown): Promise<{ value?: unknown; source?: string }>;
}

/**
 * Register the save rule on the `ai` namespace of `settings`, whose manifest is
 * `manifest` (the registered one, for the defaults a cleared key reads as).
 * A key the registered manifest does not carry is skipped: nothing saves it.
 */
export function registerAiModelRules(settings: AiModelRuleHost, manifest: SettingsManifest): void {
  const defaults: Record<string, unknown> = {};
  const declared = new Set<string>();
  for (const spec of manifest.specifiers) {
    if (!spec.key) continue;
    declared.add(spec.key);
    if (spec.default !== undefined) defaults[spec.key] = spec.default;
  }
  const predicate = aiModelRulePredicate((key, ctx) => settings.get('ai', key, ctx), defaults);
  for (const key of AI_MODEL_RULE_KEYS) {
    if (declared.has(key)) settings.registerWritePredicate('ai', key, predicate);
  }
}
