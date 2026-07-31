// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';

/**
 * OData v4 Protocol Support
 * 
 * Open Data Protocol (OData) v4 is an industry-standard protocol for building
 * and consuming RESTful APIs. It provides a uniform way to expose, structure,
 * query, and manipulate data.
 * 
 * ## Overview
 * 
 * OData v4 provides standardized URL conventions for querying data including:
 * - $select: Choose which fields to return
 * - $filter: Filter results with complex expressions
 * - $orderby: Sort results
 * - $top/$skip: Pagination
 * - $expand: Include related entities
 * - $count: Get total count
 * 
 * ## Use Cases
 * 
 * 1. **Enterprise Integration**
 *    - Integrate with Microsoft Dynamics 365
 *    - Connect to SharePoint Online
 *    - SAP OData services
 * 
 * 2. **API Standardization**
 *    - Provide consistent query interface
 *    - Standard pagination and filtering
 *    - Industry-recognized protocol
 * 
 * 3. **External Data Sources**
 *    - Connect to OData-compliant systems
 *    - Federated queries
 *    - Data virtualization
 * 
 * @see https://www.odata.org/documentation/
 * @see https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html
 * 
 * @example OData Query
 * ```
 * GET /api/odata/customers?
 *   $select=name,email&
 *   $filter=country eq 'US' and revenue gt 100000&
 *   $orderby=revenue desc&
 *   $top=10&
 *   $skip=20&
 *   $expand=orders&
 *   $count=true
 * ```
 * 
 * @example Programmatic Use
 * ```typescript
 * const query: ODataQuery = {
 *   select: ['name', 'email'],
 *   filter: "country eq 'US' and revenue gt 100000",
 *   orderby: 'revenue desc',
 *   top: 10,
 *   skip: 20,
 *   expand: ['orders'],
 *   count: true
 * }
 * ```
 */

/**
 * OData Query Options Schema
 * 
 * System query options defined by OData v4 specification.
 * These are URL query parameters that control the query execution.
 * 
 * @see https://docs.oasis-open.org/odata/odata/v4.01/odata-v4.01-part2-url-conventions.html#sec_SystemQueryOptions
 */
import { lazySchema } from '../shared/lazy-schema';
export const ODataQuerySchema = lazySchema(() => z.object({
  /**
   * $select - Select specific fields to return
   * 
   * Comma-separated list of field names to include in the response.
   * Reduces payload size and improves performance.
   * 
   * @example "name,email,phone"
   * @example "id,customer/name" - With navigation path
   */
  $select: z.union([
    z.string(),           // "name,email"
    z.array(z.string()),  // ["name", "email"]
  ]).optional().describe('Fields to select'),

  /**
   * $filter - Filter results with conditions
   * 
   * OData filter expression using comparison operators, logical operators,
   * and functions.
   * 
   * Comparison: eq, ne, lt, le, gt, ge
   * Logical: and, or, not
   * Functions: contains, startswith, endswith, length, indexof, substring, etc.
   * 
   * @example "age gt 18"
   * @example "country eq 'US' and revenue gt 100000"
   * @example "contains(name, 'Smith')"
   * @example "startswith(email, 'admin') and isActive eq true"
   */
  $filter: z.string().optional().describe('Filter expression (OData filter syntax)'),

  /**
   * $orderby - Sort results
   * 
   * Comma-separated list of fields with optional asc/desc.
   * Default is ascending.
   * 
   * @example "name"
   * @example "revenue desc"
   * @example "country asc, revenue desc"
   */
  $orderby: z.union([
    z.string(),           // "name desc"
    z.array(z.string()),  // ["name desc", "email asc"]
  ]).optional().describe('Sort order'),

  /**
   * $top - Limit number of results
   * 
   * Maximum number of results to return.
   * Equivalent to SQL LIMIT or FETCH FIRST.
   * 
   * @example 10
   * @example 100
   */
  $top: z.number().int().min(0).optional().describe('Max results to return'),

  /**
   * $skip - Skip results for pagination
   * 
   * Number of results to skip before returning results.
   * Equivalent to SQL OFFSET.
   * 
   * @example 20
   * @example 100
   */
  $skip: z.number().int().min(0).optional().describe('Results to skip'),

  /**
   * $expand - Include related entities (lookup/master_detail fields)
   * 
   * Comma-separated list of navigation properties (relationship field names) to expand.
   * Loads related data in the same request by resolving lookup and master_detail fields.
   * The engine replaces foreign key IDs with full related objects via batch $in queries.
   * Supports nested expand via OData parenthetical syntax.
   * 
   * Behavior:
   * - Only fields with `type: 'lookup'` or `type: 'master_detail'` and a valid `reference` are expanded.
   * - Fields without a schema or reference definition are silently skipped (ID returned as-is).
   * - Maximum expand depth defaults to 3 (configurable via QueryAdapterConfig).
   * 
   * @example "orders"
   * @example "customer,products"
   * @example "orders($select=id,total)" - With nested query options
   */
  $expand: z.union([
    z.string(),           // "orders"
    z.array(z.string()),  // ["orders", "customer"]
  ]).optional().describe('Navigation properties to expand (reference fields: lookup/master_detail/user/tree)'),

  /**
   * $count - Include total count
   * 
   * When true, includes totalResults count in response.
   * Useful for pagination UI.
   * 
   * @example true
   */
  $count: z.boolean().optional().describe('Include total count'),

  /**
   * $search - Full-text search
   * 
   * Free-text search expression.
   * Search implementation is service-specific.
   * 
   * @example "John Smith"
   * @example "urgent AND support"
   */
  $search: z.string().optional().describe('Search expression'),

  /**
   * $format - Response format
   * 
   * Preferred response format.
   * 
   * @example "json"
   * @example "xml"
   */
  $format: z.enum(['json', 'xml', 'atom']).optional().describe('Response format'),

  /**
   * $apply - Data aggregation
   * 
   * Aggregation transformations (groupby, aggregate, etc.)
   * Part of OData aggregation extension.
   * 
   * @example "groupby((country),aggregate(revenue with sum as totalRevenue))"
   */
  $apply: z.string().optional().describe('Aggregation expression'),
}));

export type ODataQuery = z.infer<typeof ODataQuerySchema>;

// `ODataFilterOperatorSchema` — one more spelling of comparison
// (eq/ne/lt/le/gt/ge, and/or/not, `(`/`)`, in/has) — lived here with no
// importer in this repo, objectui, or cloud. Nothing parses an OData `$filter`
// against it: `$filter` is carried as an opaque string
// (`ODataQuerySchema.$filter`, and the `odata` adapter template in
// `query-adapter.zod.ts`), and an enum that mixes operators with parentheses
// could not validate an expression anyway — it describes tokens, not a grammar.
//
// A real OData implementation needs a parser, and that parser should lower onto
// `AST_OPERATOR_MAP` (`data/filter.zod.ts`) like every other entry point. Kept
// as an enum, this was only a way for the count of filter vocabularies to grow.
// objectui#2945.

/**
 * OData Filter Function
 * 
 * Standard functions available in OData filter expressions.
 */
export const ODataFilterFunctionSchema = lazySchema(() => z.enum([
  // String Functions
  'contains',      // contains(field, 'value')
  'startswith',    // startswith(field, 'value')
  'endswith',      // endswith(field, 'value')
  'length',        // length(field)
  'indexof',       // indexof(field, 'substring')
  'substring',     // substring(field, start, length)
  'tolower',       // tolower(field)
  'toupper',       // toupper(field)
  'trim',          // trim(field)
  'concat',        // concat(field1, field2)

  // Date/Time Functions
  'year',          // year(dateField)
  'month',         // month(dateField)
  'day',           // day(dateField)
  'hour',          // hour(datetimeField)
  'minute',        // minute(datetimeField)
  'second',        // second(datetimeField)
  'date',          // date(datetimeField)
  'time',          // time(datetimeField)
  'now',           // now()
  'maxdatetime',   // maxdatetime()
  'mindatetime',   // mindatetime()

  // Math Functions
  'round',         // round(numField)
  'floor',         // floor(numField)
  'ceiling',       // ceiling(numField)

  // Type Functions
  'cast',          // cast(field, 'Edm.String')
  'isof',          // isof(field, 'Type')

  // Collection Functions
  'any',           // collection/any(d:d/prop eq value)
  'all',           // collection/all(d:d/prop eq value)
]));

export type ODataFilterFunction = z.infer<typeof ODataFilterFunctionSchema>;

/**
 * OData Response Schema
 * 
 * Standard OData JSON response format.
 */
export const ODataResponseSchema = lazySchema(() => z.object({
  /**
   * OData context URL
   * Describes the payload structure
   */
  '@odata.context': z.string().url().optional().describe('Metadata context URL'),

  /**
   * Total count (when $count=true)
   */
  '@odata.count': z.number().int().optional().describe('Total results count'),

  /**
   * Next link for pagination
   */
  '@odata.nextLink': z.string().url().optional().describe('Next page URL'),

  /**
   * Result array
   */
  value: z.array(z.record(z.string(), z.unknown())).describe('Results array'),
}));

export type ODataResponse = z.infer<typeof ODataResponseSchema>;

/**
 * OData Error Response Schema
 * 
 * Standard OData error format.
 */
export const ODataErrorSchema = lazySchema(() => z.object({
  error: z.object({
    /**
     * Error code
     */
    code: z.string().describe('Error code'),

    /**
     * Error message
     */
    message: z.string().describe('Error message'),

    /**
     * Target of the error (field name, etc.)
     */
    target: z.string().optional().describe('Error target'),

    /**
     * Additional error details
     */
    details: z.array(z.object({
      code: z.string(),
      message: z.string(),
      target: z.string().optional(),
    })).optional().describe('Error details'),

    /**
     * Inner error for debugging
     */
    innererror: z.record(z.string(), z.unknown()).optional().describe('Inner error details'),
  }),
}));

export type ODataError = z.infer<typeof ODataErrorSchema>;

/**
 * OData Metadata Configuration
 * 
 * Configuration for OData metadata endpoint ($metadata).
 */
export const ODataMetadataSchema = lazySchema(() => z.object({
  /**
   * Service namespace
   */
  namespace: z.string().describe('Service namespace'),

  /**
   * Entity types to expose
   */
  entityTypes: z.array(z.object({
    name: z.string().describe('Entity type name'),
    key: z.array(z.string()).describe('Key fields'),
    properties: z.array(z.object({
      name: z.string(),
      type: z.string().describe('OData type (Edm.String, Edm.Int32, etc.)'),
      nullable: z.boolean().default(true),
    })),
    navigationProperties: z.array(z.object({
      name: z.string(),
      type: z.string(),
      partner: z.string().optional(),
    })).optional(),
  })).describe('Entity types'),

  /**
   * Entity sets
   */
  entitySets: z.array(z.object({
    name: z.string().describe('Entity set name'),
    entityType: z.string().describe('Entity type'),
  })).describe('Entity sets'),
}));

export type ODataMetadata = z.infer<typeof ODataMetadataSchema>;

/**
 * Helper functions for OData operations
 */
export const OData = {
  /**
   * Build OData query URL
   */
  buildUrl: (baseUrl: string, query: ODataQuery): string => {
    const params = new URLSearchParams();

    if (query.$select) {
      params.append('$select', Array.isArray(query.$select) ? query.$select.join(',') : query.$select);
    }
    if (query.$filter) {
      params.append('$filter', query.$filter);
    }
    if (query.$orderby) {
      params.append('$orderby', Array.isArray(query.$orderby) ? query.$orderby.join(',') : query.$orderby);
    }
    if (query.$top !== undefined) {
      params.append('$top', query.$top.toString());
    }
    if (query.$skip !== undefined) {
      params.append('$skip', query.$skip.toString());
    }
    if (query.$expand) {
      params.append('$expand', Array.isArray(query.$expand) ? query.$expand.join(',') : query.$expand);
    }
    if (query.$count !== undefined) {
      params.append('$count', query.$count.toString());
    }
    if (query.$search) {
      params.append('$search', query.$search);
    }
    if (query.$format) {
      params.append('$format', query.$format);
    }
    if (query.$apply) {
      params.append('$apply', query.$apply);
    }

    const queryString = params.toString();
    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
  },

  /**
   * Create a simple filter expression
   */
  filter: {
    eq: (field: string, value: string | number | boolean) => 
      `${field} eq ${typeof value === 'string' ? `'${value}'` : value}`,
    ne: (field: string, value: string | number | boolean) => 
      `${field} ne ${typeof value === 'string' ? `'${value}'` : value}`,
    gt: (field: string, value: number) => `${field} gt ${value}`,
    lt: (field: string, value: number) => `${field} lt ${value}`,
    contains: (field: string, value: string) => `contains(${field}, '${value}')`,
    and: (...expressions: string[]) => expressions.join(' and '),
    or: (...expressions: string[]) => expressions.join(' or '),
  },
} as const;

/**
 * OData Configuration Schema
 * 
 * Configuration for enabling OData v4 API endpoint.
 */
export const ODataConfigSchema = lazySchema(() => z.object({
  /** Enable OData endpoint */
  enabled: z.boolean().default(true).describe('Enable OData API'),
  
  /** OData endpoint path */
  path: z.string().default('/odata').describe('OData endpoint path'),
  
  /** Metadata configuration */
  metadata: ODataMetadataSchema.optional().describe('OData metadata configuration'),
}).passthrough()); // Allow additional properties for flexibility

export type ODataConfig = z.infer<typeof ODataConfigSchema>;
