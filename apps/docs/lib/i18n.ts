import { defineI18n } from 'fumadocs-core/i18n';

/**
 * i18n Configuration for ObjectStack Documentation
 *
 * Supported Languages:
 * - en: English (Default)
 *
 * The docs are English-only by decision (2026-07). To add a language later,
 * list it here and provide content — routing already handles the rest.
 */
export const i18n = defineI18n({
  defaultLanguage: 'en',
  languages: ['en'],
  // Hide locale prefix for default language (e.g., /docs instead of /en/docs)
  hideLocale: 'default-locale',
});
