/**
 * The marketplace taxonomy as the console reads it off a catalog row: three
 * facets — business function, industry, solution type — and the maturity flag.
 *
 * The vocabulary is `@objectstack/spec/marketplace`'s, read from the schemas'
 * own `.options` and never copied here: a value the spec adds is a facet value
 * here the same day, and its label is owed by the i18n parity test
 * (`marketplace-taxonomy-labels-31011.test.ts` in `@object-ui/i18n`), which iterates
 * the same `.options`.
 *
 * Filtering semantics are the spec's (`taxonomy.zod.ts`): OR inside one facet,
 * AND across facets. Maturity is a flag, not a facet: it draws a Beta badge and
 * filters nothing.
 */

import {
  DEFAULT_SOLUTION_TYPE,
  MarketplaceBusinessFunctionSchema,
  MarketplaceIndustrySchema,
  MarketplaceSolutionTypeSchema,
  type MarketplaceBusinessFunction,
  type MarketplaceIndustry,
  type MarketplaceSolutionType,
} from '@objectstack/spec/marketplace';
import type { MarketplacePackageSummary } from './marketplaceApi.js';

/** The spec's business functions, in the spec's order. */
export const BUSINESS_FUNCTIONS: readonly MarketplaceBusinessFunction[] = MarketplaceBusinessFunctionSchema.options;
/** The spec's industries, in the spec's order. */
export const INDUSTRIES: readonly MarketplaceIndustry[] = MarketplaceIndustrySchema.options;
/** The spec's solution types, in the spec's order. */
export const SOLUTION_TYPES: readonly MarketplaceSolutionType[] = MarketplaceSolutionTypeSchema.options;

/** The taxonomy of one catalog row, as the facets and badges read it. */
export interface ListingTaxonomy {
  /** The row's business functions in its own order; the first is primary. */
  businessFunctions: MarketplaceBusinessFunction[];
  industries: MarketplaceIndustry[];
  /** `null` when the row carries no `solution_type` key at all. */
  solutionType: MarketplaceSolutionType | null;
  beta: boolean;
}

const isMember = <T extends string>(set: readonly T[]) => (value: unknown): value is T =>
  typeof value === 'string' && (set as readonly string[]).includes(value);

const isBusinessFunction = isMember(BUSINESS_FUNCTIONS);
const isIndustry = isMember(INDUSTRIES);
const isSolutionType = isMember(SOLUTION_TYPES);

/**
 * A list column as the console reads it: the catalog proxy hands rows over
 * unparsed, so a column that is not an array reads as no values, and the facet
 * it feeds hides, rather than failing the page.
 */
const listOf = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);

/**
 * The row's taxonomy. A facet value is a spec value: the catalog stores the
 * facets as select fields whose options are the spec's, so a row cannot carry
 * another, and the console draws nothing for one rather than its raw spelling.
 */
export function readListingTaxonomy(
  row: Pick<MarketplacePackageSummary, 'business_functions' | 'industries' | 'solution_type' | 'maturity'>,
): ListingTaxonomy {
  return {
    businessFunctions: listOf(row.business_functions).filter(isBusinessFunction),
    industries: listOf(row.industries).filter(isIndustry),
    solutionType: isSolutionType(row.solution_type) ? row.solution_type : null,
    beta: row.maturity === 'beta',
  };
}

/** What the facet filters have selected. An empty facet filters nothing. */
export interface FacetSelection {
  businessFunctions: ReadonlySet<MarketplaceBusinessFunction>;
  industries: ReadonlySet<MarketplaceIndustry>;
  /** `null` is "All". */
  solutionType: MarketplaceSolutionType | null;
}

export const EMPTY_FACET_SELECTION: FacetSelection = {
  businessFunctions: new Set(),
  industries: new Set(),
  solutionType: null,
};

export type FacetName = 'businessFunctions' | 'industries' | 'solutionType';

/**
 * The solution type a row is filtered and counted under: its own, or the
 * spec's default (`app`) when it declares none — the spec's reading of an
 * absent key.
 */
export function effectiveSolutionType(taxonomy: ListingTaxonomy): MarketplaceSolutionType {
  return taxonomy.solutionType ?? DEFAULT_SOLUTION_TYPE;
}

/**
 * Whether a row passes every facet except `skip`: OR inside a facet (the row
 * carries any selected value), AND across facets. `skip` is how a facet counts
 * its own values against the OTHER facets' selection.
 */
export function matchesFacets(taxonomy: ListingTaxonomy, selection: FacetSelection, skip?: FacetName): boolean {
  if (skip !== 'businessFunctions' && selection.businessFunctions.size > 0
    && !taxonomy.businessFunctions.some((v) => selection.businessFunctions.has(v))) return false;
  if (skip !== 'industries' && selection.industries.size > 0
    && !taxonomy.industries.some((v) => selection.industries.has(v))) return false;
  if (skip !== 'solutionType' && selection.solutionType !== null
    && effectiveSolutionType(taxonomy) !== selection.solutionType) return false;
  return true;
}

/** One value of a facet as the filter row draws it. */
export interface FacetOption<T extends string> {
  value: T;
  /** The rows carrying it, among those that pass the other facets' selection. */
  count: number;
}

/** The facets the filter row draws; a facet no loaded row carries is `[]` and hides. */
export interface FacetOptions {
  businessFunctions: FacetOption<MarketplaceBusinessFunction>[];
  industries: FacetOption<MarketplaceIndustry>[];
  solutionType: FacetOption<MarketplaceSolutionType>[];
}

/**
 * The facet values to draw, in the spec's order.
 *
 * - A value is drawn when any LOADED row carries it, or when it is selected,
 *   so the buttons do not come and go as the search box and the other facets
 *   narrow the set, and a selection never filters from a button that is gone.
 * - Its count is taken over the SEARCHED rows (those the search box keeps)
 *   that pass the other facets' selection: the rows selecting it would add.
 * - A facet no loaded row carries is empty and hides — every facet, until the
 *   catalog serves the taxonomy. The solution-type facet shows once some row
 *   declares a type; from then on a row that declares none is counted under
 *   the spec's default.
 */
export function facetOptions(
  loaded: readonly ListingTaxonomy[],
  searched: readonly ListingTaxonomy[],
  selection: FacetSelection,
): FacetOptions {
  const options = <T extends string>(
    values: readonly T[],
    carried: (row: ListingTaxonomy) => readonly T[],
    selected: (value: T) => boolean,
    facet: FacetName,
  ): FacetOption<T>[] => {
    const present = new Set<T>();
    for (const row of loaded) for (const v of carried(row)) present.add(v);
    const counts = new Map<T, number>();
    for (const row of searched) {
      if (!matchesFacets(row, selection, facet)) continue;
      for (const v of new Set(carried(row))) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return values
      .filter((v) => present.has(v) || selected(v))
      .map((value) => ({ value, count: counts.get(value) ?? 0 }));
  };
  const typed = selection.solutionType !== null || loaded.some((row) => row.solutionType !== null);
  return {
    businessFunctions: options(
      BUSINESS_FUNCTIONS, (row) => row.businessFunctions, (v) => selection.businessFunctions.has(v), 'businessFunctions',
    ),
    industries: options(INDUSTRIES, (row) => row.industries, (v) => selection.industries.has(v), 'industries'),
    solutionType: typed
      ? options(SOLUTION_TYPES, (row) => [effectiveSolutionType(row)], (v) => selection.solutionType === v, 'solutionType')
      : [],
  };
}
