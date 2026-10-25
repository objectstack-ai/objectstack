/**
 * @object-ui/core - DataScope Module
 *
 * Resolution of the data a view or a page element reads: the spec's
 * `ViewData` union (`ViewDataProvider`) and the per-element
 * `ElementDataSource` binding.
 *
 * Row-level security is not evaluated here. The platform declares it once, as
 * the CEL predicate of a `@objectstack/spec` row-level security policy, and
 * enforces it on the server; objectui#7750 retired the client-side row-level
 * filter evaluator this module used to export.
 *
 * @module data-scope
 * @packageDocumentation
 */

export {
  ViewDataProvider,
  type ViewDataConfig,
  type DataFetcher,
  type ResolvedData,
} from './ViewDataProvider.js';

export {
  collectSavedViews,
  composeElementDataSource,
  ELEMENT_DATA_SOURCE_INPUT,
  ELEMENT_DATA_SOURCE_KEY,
  elementDataSourceBlock,
  elementDataSourceRefusedLimitMessage,
  elementDataSourceViewNotFoundMessage,
  isElementDataSourceBlock,
  isElementDataSourceConfig,
  resolveSavedView,
  type ComposedElementDataSource,
  type ElementDataSourceConfig,
  type ElementDataSourceSort,
  type ElementSavedView,
} from './element-data-source.js';
