/**
 * The marketplace catalog's facet filters: solution type as a segment (one
 * value or All), business function and industry as toggle rows (any number of
 * values, OR inside the row). The rows combine with AND. Each value carries
 * the count of loaded listings that hold it under the other facets' selection.
 *
 * `facetOptions` (`marketplaceTaxonomy.ts`) decides what is drawn: a facet no
 * loaded listing carries is empty and its row is not drawn, so a catalog that
 * does not serve the taxonomy yet draws no filter at all.
 */

import type { ReactNode } from 'react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import type { FacetOptions, FacetSelection } from './marketplaceTaxonomy.js';

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function FacetRow({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} data-testid={testId} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs font-medium text-muted-foreground" aria-hidden="true">{label}</span>
      {children}
    </div>
  );
}

function FacetButton({ label, count, pressed, onClick, testId }: {
  label: string;
  count?: number;
  pressed: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Button
      size="sm"
      variant={pressed ? 'default' : 'outline'}
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
    >
      {label}
      {count !== undefined && (
        <span className="ml-1.5 text-xs tabular-nums opacity-70" data-testid={`${testId}-count`}>{count}</span>
      )}
    </Button>
  );
}

export function MarketplaceFacetFilters({ options, selection, onChange }: {
  options: FacetOptions;
  selection: FacetSelection;
  onChange: (next: FacetSelection) => void;
}) {
  const { t } = useObjectTranslation();
  if (options.solutionType.length === 0 && options.businessFunctions.length === 0 && options.industries.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2" data-testid="marketplace-facets">
      {options.solutionType.length > 0 && (
        <FacetRow label={t('marketplace.facet.solutionType')} testId="marketplace-facet-solutionType">
          <FacetButton
            label={t('marketplace.all')}
            pressed={selection.solutionType === null}
            onClick={() => onChange({ ...selection, solutionType: null })}
            testId="marketplace-facet-solutionType-all"
          />
          {options.solutionType.map(({ value, count }) => (
            <FacetButton
              key={value}
              label={t(`marketplace.solutionType.${value}`)}
              count={count}
              pressed={selection.solutionType === value}
              onClick={() => onChange({ ...selection, solutionType: value })}
              testId={`marketplace-facet-solutionType-${value}`}
            />
          ))}
        </FacetRow>
      )}
      {options.businessFunctions.length > 0 && (
        <FacetRow label={t('marketplace.facet.businessFunction')} testId="marketplace-facet-businessFunction">
          {options.businessFunctions.map(({ value, count }) => (
            <FacetButton
              key={value}
              label={t(`marketplace.businessFunction.${value}`)}
              count={count}
              pressed={selection.businessFunctions.has(value)}
              onClick={() => onChange({ ...selection, businessFunctions: toggled(selection.businessFunctions, value) })}
              testId={`marketplace-facet-businessFunction-${value}`}
            />
          ))}
        </FacetRow>
      )}
      {options.industries.length > 0 && (
        <FacetRow label={t('marketplace.facet.industry')} testId="marketplace-facet-industry">
          {options.industries.map(({ value, count }) => (
            <FacetButton
              key={value}
              label={t(`marketplace.industry.${value}`)}
              count={count}
              pressed={selection.industries.has(value)}
              onClick={() => onChange({ ...selection, industries: toggled(selection.industries, value) })}
              testId={`marketplace-facet-industry-${value}`}
            />
          ))}
        </FacetRow>
      )}
    </div>
  );
}
