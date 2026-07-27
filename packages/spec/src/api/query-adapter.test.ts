import { describe, it, expect } from 'vitest';
import {
  QueryAdapterTargetSchema,
  OperatorMappingSchema,
  RestQueryAdapterSchema,
  ODataQueryAdapterSchema,
  QueryAdapterConfigSchema,
} from './query-adapter.zod';

describe('QueryAdapterTargetSchema', () => {
  it('should accept all target protocols', () => {
    const targets = ['rest', 'odata'] as const;

    targets.forEach(target => {
      expect(() => QueryAdapterTargetSchema.parse(target)).not.toThrow();
    });
  });

  it('should reject invalid targets', () => {
    expect(() => QueryAdapterTargetSchema.parse('soap')).toThrow();
  });
});

describe('OperatorMappingSchema', () => {
  it('should accept minimal operator mapping', () => {
    const mapping = OperatorMappingSchema.parse({
      operator: 'eq',
    });

    expect(mapping.operator).toBe('eq');
  });

  it('should accept full operator mapping', () => {
    const mapping = OperatorMappingSchema.parse({
      operator: 'contains',
      rest: 'filter[{field}][contains]',
      odata: "contains({field}, '{value}')",
    });

    expect(mapping.operator).toBe('contains');
    expect(mapping.rest).toBeDefined();
    expect(mapping.odata).toBeDefined();
  });
});

describe('RestQueryAdapterSchema', () => {
  it('should apply default values', () => {
    const adapter = RestQueryAdapterSchema.parse({});

    expect(adapter.filterStyle).toBe('bracket');
    expect(adapter.fieldsParam).toBe('fields');
  });

  it('should accept all filter styles', () => {
    const styles = ['bracket', 'dot', 'flat', 'rsql'] as const;

    styles.forEach(style => {
      const adapter = RestQueryAdapterSchema.parse({ filterStyle: style });
      expect(adapter.filterStyle).toBe(style);
    });
  });

  it('should accept custom pagination parameters', () => {
    const adapter = RestQueryAdapterSchema.parse({
      pagination: {
        limitParam: 'page_size',
        offsetParam: 'skip',
        cursorParam: 'after',
        pageParam: 'p',
      },
    });

    expect(adapter.pagination?.limitParam).toBe('page_size');
    expect(adapter.pagination?.offsetParam).toBe('skip');
  });

  it('should accept custom sort configuration', () => {
    const adapter = RestQueryAdapterSchema.parse({
      sorting: {
        param: 'order_by',
        format: 'pipe',
      },
    });

    expect(adapter.sorting?.param).toBe('order_by');
    expect(adapter.sorting?.format).toBe('pipe');
  });

  it('should accept all sort formats', () => {
    const formats = ['comma', 'array', 'pipe'] as const;

    formats.forEach(format => {
      const adapter = RestQueryAdapterSchema.parse({
        sorting: { format },
      });
      expect(adapter.sorting?.format).toBe(format);
    });
  });
});


describe('ODataQueryAdapterSchema', () => {
  it('should apply default values', () => {
    const adapter = ODataQueryAdapterSchema.parse({});

    expect(adapter.version).toBe('v4');
    expect(adapter.usePrefix).toBe(true);
  });

  it('should accept OData v2 configuration', () => {
    const adapter = ODataQueryAdapterSchema.parse({
      version: 'v2',
      usePrefix: false,
    });

    expect(adapter.version).toBe('v2');
    expect(adapter.usePrefix).toBe(false);
  });

  it('should accept string function configuration', () => {
    const adapter = ODataQueryAdapterSchema.parse({
      stringFunctions: ['contains', 'startswith', 'endswith', 'tolower'],
    });

    expect(adapter.stringFunctions).toHaveLength(4);
    expect(adapter.stringFunctions).toContain('contains');
  });

  it('should accept expand configuration', () => {
    const adapter = ODataQueryAdapterSchema.parse({
      expand: {
        enabled: true,
        maxDepth: 5,
      },
    });

    expect(adapter.expand?.enabled).toBe(true);
    expect(adapter.expand?.maxDepth).toBe(5);
  });
});

describe('QueryAdapterConfigSchema', () => {
  it('should accept empty configuration', () => {
    const config = QueryAdapterConfigSchema.parse({});

    expect(config.rest).toBeUndefined();
    expect(config.graphql).toBeUndefined();
    expect(config.odata).toBeUndefined();
  });

  it('should accept complete configuration', () => {
    const config = QueryAdapterConfigSchema.parse({
      operatorMappings: [
        { operator: 'eq', rest: 'filter[{field}][eq]', odata: '{field} eq {value}' },
        { operator: 'contains', rest: 'filter[{field}][contains]', odata: "contains({field}, '{value}')" },
      ],
      rest: {
        filterStyle: 'bracket',
        pagination: { limitParam: 'limit', offsetParam: 'offset' },
        sorting: { param: 'sort', format: 'comma' },
      },
      odata: {
        version: 'v4',
        usePrefix: true,
        expand: { enabled: true, maxDepth: 3 },
      },
    });

    expect(config.operatorMappings).toHaveLength(2);
    expect(config.rest?.filterStyle).toBe('bracket');
    expect(config.odata?.version).toBe('v4');
  });

  it('should accept REST-only configuration', () => {
    const config = QueryAdapterConfigSchema.parse({
      rest: { filterStyle: 'rsql' },
    });

    expect(config.rest?.filterStyle).toBe('rsql');
    expect(config.graphql).toBeUndefined();
    expect(config.odata).toBeUndefined();
  });
});
