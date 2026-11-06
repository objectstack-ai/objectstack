// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page translations for the record page this plugin ships
 * (`SysAuditLogDetailPage`, `sys_audit_log_detail`) — HAND-AUTHORED, the way
 * `@objectstack/plugin-approvals` carries its record page's `pages.*` entry.
 *
 * The generated `<locale>.objects.generated.ts` files beside this one are
 * written by `os i18n extract` with the objects-only switch this package's
 * extract config documents, which emits the `objects` sub-tree alone. A
 * page-level `label` is the one key a bundle reaches on the page: every other
 * string on it is an inline locale map in `regions[].components[]`. The page
 * is declared in the extract config all the same, so the coverage ratchet
 * counts its label against this section.
 *
 * Each value is the locale's own `sys_audit_log` object label, so the page and
 * the object it draws read alike.
 *
 * ## Keeping the copy honest
 *
 * - `en` mirrors the literal in the page metadata, byte for byte:
 *   `translatePage` applies the bundle in every locale including `en`, so a
 *   drifted `en` entry would override the page's own label.
 *   `sys-audit-log-page.test.ts` pins it.
 * - Each translated locale records the digest of the `en` string it was
 *   translated from ({@link auditPageSourceHashes}). `withSourceFallback` in
 *   `./index.ts` compares it with the current source and serves the source
 *   string in place of a translation made from an older one. Re-translated a
 *   string? Update the value AND its digest (`hashSource` from
 *   `@objectstack/platform-objects/apps` gives it). ⛔ Never refresh a digest
 *   alone: that records a translation as current when it is not.
 */

import type { TranslationData } from '@objectstack/spec/system';
import type { SourceHashes } from '@objectstack/platform-objects/apps';

type PageTranslations = NonNullable<TranslationData['pages']>;

/** The shipped locales, the eleven the generated bundles carry. */
export type AuditLocale = 'en' | 'zh-CN' | 'ja-JP' | 'es-ES' | 'zh-Hant' | 'ar' | 'fr' | 'pt-BR' | 'ru' | 'de' | 'ko';

export const auditPageTranslations: Readonly<Record<AuditLocale, PageTranslations>> = {
  en: { sys_audit_log_detail: { label: 'Audit Log' } },
  'zh-CN': { sys_audit_log_detail: { label: '审计日志' } },
  'ja-JP': { sys_audit_log_detail: { label: '監査ログ' } },
  'es-ES': { sys_audit_log_detail: { label: 'Registro de auditoría' } },
  'zh-Hant': { sys_audit_log_detail: { label: '稽核日誌' } },
  ar: { sys_audit_log_detail: { label: 'سجل التدقيق' } },
  fr: { sys_audit_log_detail: { label: 'Journal d’audit' } },
  'pt-BR': { sys_audit_log_detail: { label: 'Log de auditoria' } },
  ru: { sys_audit_log_detail: { label: 'Журнал аудита' } },
  de: { sys_audit_log_detail: { label: 'Audit-Protokoll' } },
  ko: { sys_audit_log_detail: { label: '감사 로그' } },
};

/** The digest of the `en` label every translation above was made from. */
const AUDIT_LOG_LABEL_HASH = 'b2fad40733012b18';

/**
 * Recorded source hashes for the translated locales: the digest of the `en`
 * string each translation above was made from.
 */
export const auditPageSourceHashes: Readonly<Record<Exclude<AuditLocale, 'en'>, SourceHashes>> = {
  'zh-CN': { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  'ja-JP': { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  'es-ES': { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  'zh-Hant': { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  ar: { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  fr: { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  'pt-BR': { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  ru: { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  de: { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
  ko: { 'pages.sys_audit_log_detail.label': AUDIT_LOG_LABEL_HASH },
};
