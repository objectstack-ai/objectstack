// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page translations for the record page this plugin ships
 * (`SysApprovalRequestDetailPage`, `sys_approval_request_detail`) —
 * HAND-AUTHORED, the way `@objectstack/platform-objects` carries the
 * `pages.*` entries of the platform's own record pages (its `<locale>.ts`).
 *
 * ## Why this section is not in the generated bundles beside it
 *
 * The generated `<locale>.objects.generated.ts` files are written by
 * `os i18n extract` with the objects-only switch this package's extract config
 * documents, and that switch emits the `objects` sub-tree alone. The page is
 * declared in that config all the same, so the coverage ratchet counts its
 * label against this section (see the config's own note). A page-level
 * `label` is the one key a bundle reaches on this page: every other string on
 * it is an inline locale map under `slots.*`, the ruled route for page prose.
 *
 * ## Keeping the copy honest
 *
 * - `en` mirrors the literal in the page metadata, byte for byte —
 *   `translatePage` applies the bundle in every locale including `en`, so a
 *   drifted `en` entry would override the page's own label.
 *   `sys-approval-request-page.test.ts` pins it.
 * - Each translated locale records the digest of the `en` string it was
 *   translated from ({@link pageSourceHashes}). `withSourceFallback` in
 *   `./index.ts` compares it with the current source and serves the source
 *   string in place of a translation made from an older one. Re-translated a
 *   string? Update the value AND its digest — `hashSource` from
 *   `@objectstack/platform-objects/apps` gives it. ⛔ Never refresh a digest
 *   alone: that records a translation as current when it is not.
 */

import type { TranslationData } from '@objectstack/spec/system';
import type { SourceHashes } from '@objectstack/platform-objects/apps';

type PageTranslations = NonNullable<TranslationData['pages']>;

/** The shipped locales, the same four the generated bundles carry. */
export type ApprovalsLocale = 'en' | 'zh-CN' | 'ja-JP' | 'es-ES';

export const approvalsPageTranslations: Readonly<Record<ApprovalsLocale, PageTranslations>> = {
  en: {
    sys_approval_request_detail: { label: 'Approval Request' },
  },
  'zh-CN': {
    sys_approval_request_detail: { label: '审批请求' },
  },
  'ja-JP': {
    sys_approval_request_detail: { label: '承認リクエスト' },
  },
  'es-ES': {
    sys_approval_request_detail: { label: 'Solicitud de aprobación' },
  },
};

/**
 * Recorded source hashes for the translated locales: the digest of the `en`
 * string each translation above was made from.
 */
export const pageSourceHashes: Readonly<Record<Exclude<ApprovalsLocale, 'en'>, SourceHashes>> = {
  'zh-CN': { 'pages.sys_approval_request_detail.label': '903e2bc9c8f36633' },
  'ja-JP': { 'pages.sys_approval_request_detail.label': '903e2bc9c8f36633' },
  'es-ES': { 'pages.sys_approval_request_detail.label': '903e2bc9c8f36633' },
};
