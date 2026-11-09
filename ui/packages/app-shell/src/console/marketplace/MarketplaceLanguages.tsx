/**
 * The languages a marketplace version ships, as the catalog card, the package
 * page and the languages facet draw them.
 *
 * The control plane measures them when a version is published (the version's
 * `supported_locales` and `locale_coverage`, see `marketplaceApi.ts`); the
 * console reads the answer and measures nothing itself. Three answers are
 * three different faces, and the reader keeps them apart:
 *
 *   - the keys ABSENT — a catalog that does not serve them yet. Nothing is
 *     drawn, so the page reads exactly as it did before the catalog served them.
 *   - `supported_locales: null` — a version published before the measurement.
 *     It reads "No language information", ⛔ never "English only": nothing was
 *     measured, so nothing may be claimed.
 *   - a list — the languages that carry text, the default first, each with the
 *     coverage the measurement served for it.
 *
 * A language is named the way the header's language menu names it
 * (`localeLabel`, `layout/LocaleSwitcher.tsx`): a served code is first read
 * through the platform locale table (`resolveBuiltInLanguage`), so `zh-CN`
 * reads 简体中文 like the menu's entry, and a code outside the table is named
 * by the runtime in its own language (`th` → ไทย), else shown bare. There is
 * no second list of names here.
 */

import { Languages } from 'lucide-react';
import { Badge } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { MarketplacePackageVersion } from './marketplaceApi.js';
import {
  CARD_LANGUAGE_LIMIT,
  readShippedLanguages,
  useCoverageFormatter,
  type ShippedLanguage,
} from './shippedLanguages.js';

function languageText(language: ShippedLanguage, formatCoverage: (percent: number) => string): string {
  return language.percent === null ? language.label : `${language.label} ${formatCoverage(language.percent)}`;
}

/**
 * The catalog card's line: the first `CARD_LANGUAGE_LIMIT` languages with
 * their coverage (`简体中文 100% · 日本語 60%`), then how many more. The whole
 * list is the line's tooltip and what a screen reader hears.
 */
export function CardLanguagesLine({ version }: { version: MarketplacePackageVersion | null | undefined }) {
  const { t } = useObjectTranslation();
  const formatCoverage = useCoverageFormatter();
  const shipped = readShippedLanguages(version);
  if (shipped.kind === 'unserved') return null;
  if (shipped.kind === 'unknown') {
    return (
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="marketplace-card-languages" data-state="unknown">
        <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>{t('marketplace.languages.none')}</span>
      </p>
    );
  }
  const all = shipped.languages.map((language) => languageText(language, formatCoverage));
  const shown = all.slice(0, CARD_LANGUAGE_LIMIT);
  const extra = all.length - shown.length;
  const full = all.join(' · ');
  return (
    <p
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      data-testid="marketplace-card-languages"
      data-state="listed"
      title={full}
    >
      <Languages className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate" aria-hidden="true">
        {shown.join(' · ')}
        {extra > 0 && ` · ${t('marketplace.languages.more', { extra })}`}
      </span>
      <span className="sr-only">{`${t('marketplace.facet.languages')}: ${full}`}</span>
    </p>
  );
}

/**
 * The package page's group in its taxonomy strip: every language, the default
 * marked, each with its coverage; "No language information" for a version
 * that carries none.
 */
export function DetailLanguagesGroup({ version }: { version: MarketplacePackageVersion | null | undefined }) {
  const { t } = useObjectTranslation();
  const formatCoverage = useCoverageFormatter();
  const shipped = readShippedLanguages(version);
  if (shipped.kind === 'unserved') return null;
  const label = t('marketplace.facet.languages');
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-1.5"
      data-testid="marketplace-detail-languages"
      data-state={shipped.kind}
    >
      <span className="text-xs text-muted-foreground" aria-hidden="true">{label}</span>
      {shipped.kind === 'unknown' ? (
        <span className="text-xs text-muted-foreground">{t('marketplace.languages.none')}</span>
      ) : (
        shipped.languages.map((language) => (
          <Badge
            key={language.code}
            variant="outline"
            className="font-normal"
            data-testid={`marketplace-detail-language-${language.code}`}
            title={language.code}
          >
            {languageText(language, formatCoverage)}
            {language.isDefault && (
              <span className="ml-1 text-muted-foreground">{t('marketplace.languages.default')}</span>
            )}
          </Badge>
        ))
      )}
    </div>
  );
}
