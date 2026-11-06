// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Page translations for the record page this plugin ships
 * (`SysQueueDetailPage`, `sys_queue_detail`) — HAND-AUTHORED, the way
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
 * ## Keeping the copy honest
 *
 * - `en` mirrors the literal in the page metadata, byte for byte:
 *   `translatePage` applies the bundle in every locale including `en`, so a
 *   drifted `en` entry would override the page's own label.
 *   `sys-queue-page.test.ts` pins it.
 * - Each translated locale records the digest of the `en` string it was
 *   translated from ({@link sharingPageSourceHashes}). `withSourceFallback` in
 *   `./index.ts` compares it with the current source and serves the source
 *   string in place of a translation made from an older one. Re-translated a
 *   string? Update the value AND its digest (`hashSource` from
 *   `@objectstack/platform-objects/apps` gives it). ⛔ Never refresh a digest
 *   alone: that records a translation as current when it is not.
 */

import type { TranslationData } from '@objectstack/spec/system';
import type { SourceHashes } from '@objectstack/platform-objects/apps';

type PageTranslations = NonNullable<TranslationData['pages']>;

/** The shipped locales, the four the generated bundles carry. */
export type SharingLocale = 'en' | 'zh-CN' | 'ja-JP' | 'es-ES';

export const sharingPageTranslations: Readonly<Record<SharingLocale, PageTranslations>> = {
  en: { sys_queue_detail: { label: 'Queue' } },
  'zh-CN': { sys_queue_detail: { label: '队列' } },
  'ja-JP': { sys_queue_detail: { label: 'キュー' } },
  'es-ES': { sys_queue_detail: { label: 'Cola' } },
};

/**
 * Recorded source hashes for the translated locales: the digest of the `en`
 * string each translation above was made from.
 */
export const sharingPageSourceHashes: Readonly<Record<Exclude<SharingLocale, 'en'>, SourceHashes>> = {
  'zh-CN': { 'pages.sys_queue_detail.label': '87d4b808a85ea103' },
  'ja-JP': { 'pages.sys_queue_detail.label': '87d4b808a85ea103' },
  'es-ES': { 'pages.sys_queue_detail.label': '87d4b808a85ea103' },
};
