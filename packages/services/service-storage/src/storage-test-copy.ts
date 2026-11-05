// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30335] The sentences Setup → Storage → 测试连接 (`storage/test`) answers
 * with, one entry per locale this package's `translations/` serves.
 *
 * The console prints the action's `message` as the toast, bare, so the
 * sentence is the administrator's whole answer. The settings action route
 * hands the handler the caller's display language (`Accept-Language`, else
 * `?locale`) as the input's `locale`; an absent locale, or one with no entry
 * here, is answered in English, the sentence every caller got before.
 *
 * Only the sentences the product writes live here. An adapter's own error
 * text (the S3 SDK's, the file system's) is passed through verbatim: in
 * English on its own, as it always was; in another language behind a lead-in
 * that says the connection test failed, so the reader knows what the
 * untranslated part is. The operator log lines stay English.
 */

import { resolveLocale } from '@objectstack/core';

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

export const STORAGE_TEST_COPY: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', StorageTestCopy> = {
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
  'ja-JP': {
    succeeded: (adapter) => `ストレージの接続テストに成功しました（アダプター: ${adapter}）。`,
    downloadMismatch: 'プローブファイルのダウンロード内容がアップロードした内容と一致しません。',
    s3SettingsIncomplete: 'S3 アダプターにはバケット（s3_bucket）とリージョン（s3_region）の指定が必要です。',
    failed: (reason) => `ストレージの接続テストに失敗しました: ${reason}`,
  },
  'es-ES': {
    succeeded: (adapter) => `La prueba de conexión del almacenamiento se ha completado correctamente (adaptador: ${adapter}).`,
    downloadMismatch: 'El archivo de prueba descargado no coincide con el que se subió.',
    s3SettingsIncomplete: 'El adaptador S3 necesita un bucket (s3_bucket) y una región (s3_region).',
    failed: (reason) => `La prueba de conexión del almacenamiento ha fallado: ${reason}`,
  },
};

const COPY_LOCALES = Object.keys(STORAGE_TEST_COPY);

/** The copy for a caller's locale: exact, then by language, else English. */
export function storageTestCopy(locale: string | undefined): StorageTestCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return STORAGE_TEST_COPY[(picked ?? 'en') as keyof typeof STORAGE_TEST_COPY];
}
