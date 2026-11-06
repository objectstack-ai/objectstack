// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveLocale } from '@objectstack/core';
import { arabicCount, type SettingsCopyLocale } from './settings-copy-locale.js';

/**
 * The answers `SettingsService.runAction` writes itself, in the caller's
 * language: the built-in `reset` action's result, and the refusal for an
 * action no plugin registered a handler for. Every other action answer is its
 * handler's own.
 *
 * The console prints an action's `message` as the toast, bare, so the
 * sentence is the administrator's whole answer. The settings action route
 * hands `runAction` the caller's display language (`Accept-Language`, else
 * `?locale`) as `display.locale`; an absent locale, or one naming no language
 * here, is answered in English, the sentences every caller got before.
 */
export interface SettingsActionCopy {
  /** The built-in reset cleared `count` (> 0) saved values. */
  resetCleared(count: number): string;
  /** The built-in reset found no saved value to clear. */
  resetNothing: string;
  /** No handler is registered for `actionId` in `namespace`. */
  noHandler(actionId: string, namespace: string): string;
}

/** One entry per language on the platform locale table ({@link SettingsCopyLocale}). */
export const SETTINGS_ACTION_COPY: Record<SettingsCopyLocale, SettingsActionCopy> = {
  en: {
    resetCleared: (n) => `Cleared ${n} saved value(s); environment/default configuration is back in effect.`,
    resetNothing: 'No saved values to clear — already using environment/default configuration.',
    noHandler: (actionId, namespace) => `No handler registered for action '${actionId}' in '${namespace}'.`,
  },
  'zh-CN': {
    resetCleared: (n) => `已清除 ${n} 个已保存的值；环境变量/默认配置已重新生效。`,
    resetNothing: '没有可清除的已保存值：当前已在使用环境变量/默认配置。',
    noHandler: (actionId, namespace) => `“${namespace}”中的操作“${actionId}”没有注册处理程序。`,
  },
  'zh-Hant': {
    resetCleared: (n) => `已清除 ${n} 個已儲存的值；環境變數/預設設定已重新生效。`,
    resetNothing: '沒有可清除的已儲存值：目前已在使用環境變數/預設設定。',
    noHandler: (actionId, namespace) => `「${namespace}」中的操作「${actionId}」沒有註冊處理常式。`,
  },
  'ja-JP': {
    resetCleared: (n) => `保存済みの値を ${n} 件消去しました。環境変数/既定の設定が再び有効になっています。`,
    resetNothing: '消去する保存済みの値はありません。すでに環境変数/既定の設定を使用しています。',
    noHandler: (actionId, namespace) => `「${namespace}」のアクション「${actionId}」にはハンドラーが登録されていません。`,
  },
  ko: {
    resetCleared: (n) => `저장된 값 ${n}개를 지웠습니다. 환경 변수/기본 설정이 다시 적용됩니다.`,
    resetNothing: '지울 저장된 값이 없습니다. 이미 환경 변수/기본 설정을 사용하고 있습니다.',
    noHandler: (actionId, namespace) => `'${namespace}'의 '${actionId}' 작업에 등록된 핸들러가 없습니다.`,
  },
  'es-ES': {
    resetCleared: (n) =>
      `Se ${n === 1 ? 'ha borrado 1 valor guardado' : `han borrado ${n} valores guardados`}; vuelve a aplicarse `
      + 'la configuración del entorno o la predeterminada.',
    resetNothing: 'No hay valores guardados que borrar: ya se usa la configuración del entorno o la predeterminada.',
    noHandler: (actionId, namespace) =>
      `No hay ningún controlador registrado para la acción «${actionId}» en «${namespace}».`,
  },
  ar: {
    resetCleared: (n) =>
      `تم مسح ${arabicCount(n, {
        one: 'قيمة محفوظة واحدة', two: 'قيمتين محفوظتين', few: 'قيم محفوظة', many: 'قيمة محفوظة', other: 'قيمة محفوظة',
      })}؛ وعاد إعداد البيئة أو الإعداد الافتراضي إلى العمل.`,
    resetNothing: 'لا توجد قيم محفوظة لمسحها، فإعداد البيئة أو الإعداد الافتراضي مستخدم بالفعل.',
    noHandler: (actionId, namespace) => `لا يوجد معالج مسجّل للإجراء «${actionId}» في «${namespace}».`,
  },
  fr: {
    resetCleared: (n) =>
      `${n === 1 ? '1 valeur enregistrée effacée' : `${n} valeurs enregistrées effacées`} ; la configuration de `
      + 'l’environnement ou par défaut s’applique de nouveau.',
    resetNothing: 'Aucune valeur enregistrée à effacer : la configuration de l’environnement ou par défaut est déjà utilisée.',
    noHandler: (actionId, namespace) =>
      `Aucun gestionnaire n’est enregistré pour l’action « ${actionId} » dans « ${namespace} ».`,
  },
  'pt-BR': {
    resetCleared: (n) =>
      `${n === 1 ? '1 valor salvo foi apagado' : `${n} valores salvos foram apagados`}; a configuração do ambiente `
      + 'ou padrão voltou a valer.',
    resetNothing: 'Não há valores salvos para apagar: a configuração do ambiente ou padrão já está em uso.',
    noHandler: (actionId, namespace) => `Nenhum manipulador registrado para a ação "${actionId}" em "${namespace}".`,
  },
  ru: {
    resetCleared: (n) =>
      `Очищено сохранённых значений: ${n}; снова действуют настройки из окружения или по умолчанию.`,
    resetNothing: 'Нет сохранённых значений для очистки: уже используются настройки из окружения или по умолчанию.',
    noHandler: (actionId, namespace) => `Для действия «${actionId}» в «${namespace}» не зарегистрирован обработчик.`,
  },
  de: {
    resetCleared: (n) =>
      `${n === 1 ? '1 gespeicherter Wert gelöscht' : `${n} gespeicherte Werte gelöscht`}; die Konfiguration aus `
      + 'der Umgebung bzw. die Standardkonfiguration gilt wieder.',
    resetNothing:
      'Keine gespeicherten Werte zu löschen: Es gilt bereits die Konfiguration aus der Umgebung bzw. die '
      + 'Standardkonfiguration.',
    noHandler: (actionId, namespace) => `Für die Aktion „${actionId}“ in „${namespace}“ ist kein Handler registriert.`,
  },
};

const COPY_LOCALES = Object.keys(SETTINGS_ACTION_COPY);

/** The copy for a caller's locale: through the platform locale table, else English. */
export function settingsActionCopy(locale: string | undefined): SettingsActionCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return SETTINGS_ACTION_COPY[(picked ?? 'en') as SettingsCopyLocale];
}
