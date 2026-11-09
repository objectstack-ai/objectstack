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
 * Filtering is the catalog list door's (`GET /api/v1/marketplace/packages`),
 * with the spec's semantics (`taxonomy.zod.ts`): OR inside one facet, AND across
 * facets, applied on the server before it pages. The console sends the
 * selection (`facetListParams`) and filters nothing itself. Maturity is a flag,
 * not a facet: it draws a Beta badge, and the console selects no maturity.
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
import type { MarketplaceListParams, MarketplacePackageSummary } from './marketplaceApi.js';

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

/**
 * The solution type a row is read under: its own, or the spec's default
 * (`app`) when it declares none — the spec's reading of an absent key, and the
 * one the catalog list door filters by (a row without the column passes
 * `solutionTypes=app`).
 */
export function effectiveSolutionType(taxonomy: ListingTaxonomy): MarketplaceSolutionType {
  return taxonomy.solutionType ?? DEFAULT_SOLUTION_TYPE;
}

/**
 * The list read's filters for a selection. The server filters and pages (OR
 * inside a facet, AND across facets), so the selection travels as the query:
 * each facet's values in the spec's order, and a facet with nothing selected
 * left out — the door refuses an empty facet.
 */
export function facetListParams(
  selection: FacetSelection,
): Pick<MarketplaceListParams, 'businessFunctions' | 'industries' | 'solutionTypes'> {
  const businessFunctions = BUSINESS_FUNCTIONS.filter((v) => selection.businessFunctions.has(v));
  const industries = INDUSTRIES.filter((v) => selection.industries.has(v));
  return {
    ...(businessFunctions.length > 0 ? { businessFunctions } : {}),
    ...(industries.length > 0 ? { industries } : {}),
    ...(selection.solutionType !== null ? { solutionTypes: [selection.solutionType] } : {}),
  };
}

/**
 * Which facets the filter row draws. A facet is drawn once a row the catalog
 * answered carries a value of it — the solution type once a row declares one —
 * and stays drawn from then on, so a selection that narrows the page to rows
 * without the facet does not take its buttons away. A catalog that does not
 * serve the taxonomy yet draws no filter.
 */
export interface ServedFacets {
  businessFunctions: boolean;
  industries: boolean;
  solutionType: boolean;
}

export const NO_SERVED_FACETS: ServedFacets = { businessFunctions: false, industries: false, solutionType: false };

/** `served`, widened by the facets `rows` carry; `served` itself when they add none. */
export function widenServedFacets(served: ServedFacets, rows: readonly ListingTaxonomy[]): ServedFacets {
  const next: ServedFacets = {
    businessFunctions: served.businessFunctions || rows.some((row) => row.businessFunctions.length > 0),
    industries: served.industries || rows.some((row) => row.industries.length > 0),
    solutionType: served.solutionType || rows.some((row) => row.solutionType !== null),
  };
  return next.businessFunctions === served.businessFunctions
    && next.industries === served.industries
    && next.solutionType === served.solutionType
    ? served
    : next;
}
