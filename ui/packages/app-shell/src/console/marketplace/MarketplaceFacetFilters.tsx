/**
 * The marketplace catalog's facet filters: solution type as a segment (one
 * value or All), business function and industry as toggle rows (any number of
 * values, OR inside the row). The rows combine with AND. The server applies
 * the selection: the page sends it with the list read and draws the answer.
 *
 * A drawn facet offers every value the spec declares, in the spec's order: the
 * page holds one page of the filtered catalog, so the values its rows carry
 * are not the values a selection can add. `ServedFacets`
 * (`marketplaceTaxonomy.ts`) decides which facets are drawn, so a catalog that
 * does not serve the taxonomy yet draws no filter at all.
 */

import type { ReactNode } from 'react';
import { Button } from '@object-ui/components';
import { useObjectTranslation } from '@object-ui/i18n';
import {
  BUSINESS_FUNCTIONS,
  INDUSTRIES,
  SOLUTION_TYPES,
  type FacetSelection,
  type ServedFacets,
} from './marketplaceTaxonomy.js';

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

function FacetButton({ label, pressed, onClick, testId }: {
  label: string;
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
    </Button>
  );
}

export function MarketplaceFacetFilters({ served, selection, onChange }: {
  served: ServedFacets;
  selection: FacetSelection;
  onChange: (next: FacetSelection) => void;
}) {
  const { t } = useObjectTranslation();
  if (!served.solutionType && !served.businessFunctions && !served.industries) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="marketplace-facets">
      {served.solutionType && (
        <FacetRow label={t('marketplace.facet.solutionType')} testId="marketplace-facet-solutionType">
          <FacetButton
            label={t('marketplace.all')}
            pressed={selection.solutionType === null}
            onClick={() => onChange({ ...selection, solutionType: null })}
            testId="marketplace-facet-solutionType-all"
          />
          {SOLUTION_TYPES.map((value) => (
            <FacetButton
              key={value}
              label={t(`marketplace.solutionType.${value}`)}
              pressed={selection.solutionType === value}
              onClick={() => onChange({ ...selection, solutionType: value })}
              testId={`marketplace-facet-solutionType-${value}`}
            />
          ))}
        </FacetRow>
      )}
      {served.businessFunctions && (
        <FacetRow label={t('marketplace.facet.businessFunction')} testId="marketplace-facet-businessFunction">
          {BUSINESS_FUNCTIONS.map((value) => (
            <FacetButton
              key={value}
              label={t(`marketplace.businessFunction.${value}`)}
              pressed={selection.businessFunctions.has(value)}
              onClick={() => onChange({ ...selection, businessFunctions: toggled(selection.businessFunctions, value) })}
              testId={`marketplace-facet-businessFunction-${value}`}
            />
          ))}
        </FacetRow>
      )}
      {served.industries && (
        <FacetRow label={t('marketplace.facet.industry')} testId="marketplace-facet-industry">
          {INDUSTRIES.map((value) => (
            <FacetButton
              key={value}
              label={t(`marketplace.industry.${value}`)}
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
