// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

export { ODataDriver } from './odata-driver.js';
export type { ODataDriverRuntime, ODataIntrospectedSchema, ODataIntrospectedTable } from './odata-driver.js';

export { createODataDriverPlugin } from './plugin.js';
export type { DatasourceDefinitionSource, ODataDriverPluginOptions, ODataSecretStore } from './plugin.js';

export {
  DEFAULT_PAGE_SIZE,
  DEFAULT_REQUEST_TIMEOUT_MS,
  ODataDriverConfigSchema,
  parseODataDriverConfig,
} from './config.js';
export type { ODataDriverConfig, ODataDriverConfigInput } from './config.js';

// The dialect seam: each OData version implements `ODataDialect` in a file of its own.
export { odataV4Dialect, parseCsdlV4 } from './dialect-v4.js';
export { odataV2Dialect, parseCsdlV2 } from './dialect-v2.js';
export type {
  EdmEntitySet,
  EdmEntityType,
  EdmNavigationProperty,
  EdmProperty,
  ODataCollectionPage,
  ODataDialect,
  ODataServiceModel,
  ODataStringFunction,
} from './dialect.js';

export { translateWhere } from './filter.js';
export type { FilterTarget, TranslatedWhere } from './filter.js';

export { ODataRequestError } from './transport.js';
export type { FetchLike, ODataAuth } from './transport.js';
