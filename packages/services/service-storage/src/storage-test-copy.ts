// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30335] The sentences Setup → Storage → 测试连接 (`storage/test`) answers
 * with, one entry per language on the platform locale table.
 *
 * The console prints the action's `message` as the toast, bare, so the
 * sentence is the administrator's whole answer. The settings action route
 * hands the handler the caller's display language (`Accept-Language`, else
 * `?locale`) as the input's `locale`; an absent locale, or one with no entry
 * here, is answered in English, the sentence every caller got before.
 *
 * The table carries every language on the platform locale table
 * (`@objectstack/spec/system` `PLATFORM_LOCALES`). The four entries this package
 * served first keep their keys (`zh-CN`, `ja-JP`, `es-ES`); the caller's code is
 * read through the table's own reader, `platformLocaleTagOf`, so a stored
 * alias (`zh-TW`, `pt`, `en-US`) and a table tag (`zh-Hans`, `ja`) both find
 * their entry. A code the table does not name is shortened one subtag at a
 * time (RFC 4647 lookup: `fr-CA` → `fr`, `zh-Hant-TW` → `zh-Hant`); nothing
 * left ⇒ English.
 *
 * Only the sentences the product writes live here. An adapter's own error
 * text (the S3 SDK's, the file system's) is passed through verbatim: in
 * English on its own, as it always was; in another language behind a lead-in
 * that says the connection test failed, so the reader knows what the
 * untranslated part is. The operator log lines stay English.
 */

import { platformLocaleTagOf, type PlatformLocaleTag } from '@objectstack/spec/system';

/** The English refusal for S3 settings missing a bucket or a region. */
export const S3_SETTINGS_INCOMPLETE_MESSAGE =
  'StorageServicePlugin: S3 adapter requires s3_bucket and s3_region';

/**
 * Thrown when the `storage` settings name the S3 adapter without a bucket or a
 * region. Its message is the English refusal the operator log has always
 * carried; the `storage/test` answer reads the type to write the refusal in the
 * caller's language instead.
 */
export class S3SettingsIncompleteError extends Error {
  constructor() {
    super(S3_SETTINGS_INCOMPLETE_MESSAGE);
    this.name = 'S3SettingsIncompleteError';
  }
}

export interface StorageTestCopy {
  /** The probe object was written, read back identical and deleted. */
  succeeded(adapter: string): string;
  /** The probe object read back is not the one written. */
  downloadMismatch: string;
  /** The S3 adapter was chosen without a bucket or a region. */
  s3SettingsIncomplete: string;
  /** The adapter refused; `reason` is its own text, verbatim. */
  failed(reason: string): string;
}

/** The table's keys: the platform locale table's languages, the first four under their older codes. */
export type StorageTestCopyLocale =
  'en' | 'zh-CN' | 'zh-Hant' | 'es-ES' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ja-JP' | 'ko';

export const STORAGE_TEST_COPY: Record<StorageTestCopyLocale, StorageTestCopy> = {
  en: {
    succeeded: (adapter) => `Storage round-trip succeeded (adapter=${adapter}).`,
    downloadMismatch: 'Probe download did not match upload.',
    s3SettingsIncomplete: S3_SETTINGS_INCOMPLETE_MESSAGE,
    failed: (reason) => reason,
  },
  'zh-CN': {
    succeeded: (adapter) => `存储连接测试成功（适配器：${adapter}）。`,
    downloadMismatch: '探测文件下载后的内容与上传的不一致。',
    s3SettingsIncomplete: 'S3 适配器需要填写存储桶（s3_bucket）和区域（s3_region）。',
    failed: (reason) => `存储连接测试失败：${reason}`,
  },
  'zh-Hant': {
    succeeded: (adapter) => `儲存空間連線測試成功（轉接器：${adapter}）。`,
    downloadMismatch: '探測檔案下載後的內容與上傳的不一致。',
    s3SettingsIncomplete: 'S3 轉接器需要填寫儲存貯體（s3_bucket）和區域（s3_region）。',
    failed: (reason) => `儲存空間連線測試失敗：${reason}`,
  },
  'ja-JP': {
    succeeded: (adapter) => `ストレージの接続テストに成功しました（アダプター: ${adapter}）。`,
    downloadMismatch: 'プローブファイルのダウンロード内容がアップロードした内容と一致しません。',
    s3SettingsIncomplete: 'S3 アダプターにはバケット（s3_bucket）とリージョン（s3_region）の指定が必要です。',
    failed: (reason) => `ストレージの接続テストに失敗しました: ${reason}`,
  },
  ko: {
    succeeded: (adapter) => `스토리지 연결 테스트에 성공했습니다(어댑터: ${adapter}).`,
    downloadMismatch: '다운로드한 테스트 파일이 업로드한 파일과 일치하지 않습니다.',
    s3SettingsIncomplete: 'S3 어댑터에는 버킷(s3_bucket)과 리전(s3_region)이 필요합니다.',
    failed: (reason) => `스토리지 연결 테스트에 실패했습니다: ${reason}`,
  },
  'es-ES': {
    succeeded: (adapter) => `La prueba de conexión del almacenamiento se ha completado correctamente (adaptador: ${adapter}).`,
    downloadMismatch: 'El archivo de prueba descargado no coincide con el que se subió.',
    s3SettingsIncomplete: 'El adaptador S3 necesita un bucket (s3_bucket) y una región (s3_region).',
    failed: (reason) => `La prueba de conexión del almacenamiento ha fallado: ${reason}`,
  },
  ar: {
    succeeded: (adapter) => `نجح اختبار الاتصال بالتخزين (المحوّل: ${adapter}).`,
    downloadMismatch: 'محتوى ملف الاختبار الذي تم تنزيله لا يطابق الملف الذي تم رفعه.',
    s3SettingsIncomplete: 'يتطلب محوّل S3 تحديد الحاوية (s3_bucket) والمنطقة (s3_region).',
    failed: (reason) => `فشل اختبار الاتصال بالتخزين: ${reason}`,
  },
  fr: {
    succeeded: (adapter) => `Le test de connexion au stockage a réussi (adaptateur : ${adapter}).`,
    downloadMismatch: 'Le fichier de test téléchargé ne correspond pas à celui qui a été envoyé.',
    s3SettingsIncomplete: 'L’adaptateur S3 nécessite un bucket (s3_bucket) et une région (s3_region).',
    failed: (reason) => `Le test de connexion au stockage a échoué : ${reason}`,
  },
  'pt-BR': {
    succeeded: (adapter) => `O teste de conexão com o armazenamento foi concluído com sucesso (adaptador: ${adapter}).`,
    downloadMismatch: 'O arquivo de teste baixado não corresponde ao que foi enviado.',
    s3SettingsIncomplete: 'O adaptador S3 exige um bucket (s3_bucket) e uma região (s3_region).',
    failed: (reason) => `O teste de conexão com o armazenamento falhou: ${reason}`,
  },
  ru: {
    succeeded: (adapter) => `Проверка подключения к хранилищу прошла успешно (адаптер: ${adapter}).`,
    downloadMismatch: 'Скачанный тестовый файл не совпадает с загруженным.',
    s3SettingsIncomplete: 'Для адаптера S3 нужно указать бакет (s3_bucket) и регион (s3_region).',
    failed: (reason) => `Проверка подключения к хранилищу не удалась: ${reason}`,
  },
  de: {
    succeeded: (adapter) => `Der Verbindungstest zum Speicher war erfolgreich (Adapter: ${adapter}).`,
    downloadMismatch: 'Die heruntergeladene Testdatei stimmt nicht mit der hochgeladenen überein.',
    s3SettingsIncomplete: 'Der S3-Adapter benötigt einen Bucket (s3_bucket) und eine Region (s3_region).',
    failed: (reason) => `Der Verbindungstest zum Speicher ist fehlgeschlagen: ${reason}`,
  },
};

/** Each platform locale table tag → the key that serves it. */
const KEY_BY_TABLE_TAG: Record<PlatformLocaleTag, StorageTestCopyLocale> = {
  en: 'en',
  'zh-Hans': 'zh-CN',
  'zh-Hant': 'zh-Hant',
  es: 'es-ES',
  ar: 'ar',
  fr: 'fr',
  'pt-BR': 'pt-BR',
  ru: 'ru',
  de: 'de',
  ja: 'ja-JP',
  ko: 'ko',
};

/** The key that serves a caller's code, or `undefined` (⇒ English). */
export function storageTestCopyLocaleOf(locale: string | undefined): StorageTestCopyLocale | undefined {
  if (!locale) return undefined;
  const subtags = locale.split('-');
  for (let n = subtags.length; n > 0; n -= 1) {
    const tag = platformLocaleTagOf(subtags.slice(0, n).join('-'));
    if (tag) return KEY_BY_TABLE_TAG[tag];
  }
  return undefined;
}

/** The copy for a caller's locale; English when the code names no language on the table. */
export function storageTestCopy(locale: string | undefined): StorageTestCopy {
  return STORAGE_TEST_COPY[storageTestCopyLocaleOf(locale) ?? 'en'];
}
