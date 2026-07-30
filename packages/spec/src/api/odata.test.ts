import { describe, it, expect } from 'vitest';
import {
  ODataQuerySchema,
  ODataFilterFunctionSchema,
  ODataResponseSchema,
  ODataErrorSchema,
  ODataMetadataSchema,
  OData,
  type ODataQuery,
} from './odata.zod';

describe('ODataQuerySchema', () => {
  describe('$select parameter', () => {
    it('should accept string select', () => {
      const query = ODataQuerySchema.parse({
        $select: 'name,email',
      });

      expect(query.$select).toBe('name,email');
    });

    it('should accept array select', () => {
      const query = ODataQuerySchema.parse({
        $select: ['name', 'email', 'phone'],
      });

      expect(query.$select).toEqual(['name', 'email', 'phone']);
    });

    it('should accept navigation path select', () => {
      const query = ODataQuerySchema.parse({
        $select: 'id,customer/name',
      });

      expect(query.$select).toBe('id,customer/name');
    });
  });

  describe('$filter parameter', () => {
    it('should accept simple equality filter', () => {
      const query = ODataQuerySchema.parse({
        $filter: "status eq 'active'",
      });

      expect(query.$filter).toBe("status eq 'active'");
    });

    it('should accept complex filter with and/or', () => {
      const query = ODataQuerySchema.parse({
        $filter: "country eq 'US' and revenue gt 100000",
      });

      expect(query.$filter).toBe("country eq 'US' and revenue gt 100000");
    });

    it('should accept filter with functions', () => {
      const query = ODataQuerySchema.parse({
        $filter: "contains(name, 'Smith')",
      });

      expect(query.$filter).toBe("contains(name, 'Smith')");
    });

    it('should accept complex nested filter', () => {
      const query = ODataQuerySchema.parse({
        $filter: "startswith(email, 'admin') and isActive eq true",
      });

      expect(query.$filter).toBeDefined();
    });
  });

  describe('$orderby parameter', () => {
    it('should accept string orderby', () => {
      const query = ODataQuerySchema.parse({
        $orderby: 'name',
      });

      expect(query.$orderby).toBe('name');
    });

    it('should accept orderby with direction', () => {
      const query = ODataQuerySchema.parse({
        $orderby: 'revenue desc',
      });

      expect(query.$orderby).toBe('revenue desc');
    });

    it('should accept array orderby', () => {
      const query = ODataQuerySchema.parse({
        $orderby: ['name asc', 'revenue desc'],
      });

      expect(query.$orderby).toEqual(['name asc', 'revenue desc']);
    });

    it('should accept multiple fields orderby', () => {
      const query = ODataQuerySchema.parse({
        $orderby: 'country asc, revenue desc',
      });

      expect(query.$orderby).toBe('country asc, revenue desc');
    });
  });

  describe('$top and $skip parameters', () => {
    it('should accept top parameter', () => {
      const query = ODataQuerySchema.parse({
        $top: 10,
      });

      expect(query.$top).toBe(10);
    });

    it('should accept skip parameter', () => {
      const query = ODataQuerySchema.parse({
        $skip: 20,
      });

      expect(query.$skip).toBe(20);
    });

    it('should accept both top and skip for pagination', () => {
      const query = ODataQuerySchema.parse({
        $top: 25,
        $skip: 50,
      });

      expect(query.$top).toBe(25);
      expect(query.$skip).toBe(50);
    });

    it('should reject negative top', () => {
      expect(() => ODataQuerySchema.parse({
        $top: -1,
      })).toThrow();
    });

    it('should reject negative skip', () => {
      expect(() => ODataQuerySchema.parse({
        $skip: -5,
      })).toThrow();
    });
  });

  describe('$expand parameter', () => {
    it('should accept string expand', () => {
      const query = ODataQuerySchema.parse({
        $expand: 'orders',
      });

      expect(query.$expand).toBe('orders');
    });

    it('should accept array expand', () => {
      const query = ODataQuerySchema.parse({
        $expand: ['orders', 'customer', 'products'],
      });

      expect(query.$expand).toEqual(['orders', 'customer', 'products']);
    });

    it('should accept expand with nested options', () => {
      const query = ODataQuerySchema.parse({
        $expand: 'orders($select=id,total)',
      });

      expect(query.$expand).toBe('orders($select=id,total)');
    });
  });

  describe('$count parameter', () => {
    it('should accept count true', () => {
      const query = ODataQuerySchema.parse({
        $count: true,
      });

      expect(query.$count).toBe(true);
    });

    it('should accept count false', () => {
      const query = ODataQuerySchema.parse({
        $count: false,
      });

      expect(query.$count).toBe(false);
    });
  });

  describe('$search parameter', () => {
    it('should accept simple search', () => {
      const query = ODataQuerySchema.parse({
        $search: 'John Smith',
      });

      expect(query.$search).toBe('John Smith');
    });

    it('should accept search with AND', () => {
      const query = ODataQuerySchema.parse({
        $search: 'urgent AND support',
      });

      expect(query.$search).toBe('urgent AND support');
    });
  });

  describe('$format parameter', () => {
    it('should accept json format', () => {
      const query = ODataQuerySchema.parse({
        $format: 'json',
      });

      expect(query.$format).toBe('json');
    });

    it('should accept xml format', () => {
      const query = ODataQuerySchema.parse({
        $format: 'xml',
      });

      expect(query.$format).toBe('xml');
    });

    it('should accept atom format', () => {
      const query = ODataQuerySchema.parse({
        $format: 'atom',
      });

      expect(query.$format).toBe('atom');
    });

    it('should reject invalid format', () => {
      expect(() => ODataQuerySchema.parse({
        $format: 'csv',
      })).toThrow();
    });
  });

  describe('$apply parameter', () => {
    it('should accept aggregation expression', () => {
      const query = ODataQuerySchema.parse({
        $apply: 'groupby((country),aggregate(revenue with sum as totalRevenue))',
      });

      expect(query.$apply).toBeDefined();
    });
  });

  describe('Complete Query', () => {
    it('should accept comprehensive OData query', () => {
      const query = ODataQuerySchema.parse({
        $select: ['name', 'email'],
        $filter: "country eq 'US' and revenue gt 100000",
        $orderby: 'revenue desc',
        $top: 10,
        $skip: 20,
        $expand: ['orders'],
        $count: true,
      });

      expect(query.$select).toEqual(['name', 'email']);
      expect(query.$filter).toBe("country eq 'US' and revenue gt 100000");
      expect(query.$top).toBe(10);
      expect(query.$count).toBe(true);
    });
  });
});

describe('ODataFilterFunctionSchema', () => {
  it('should accept string functions', () => {
    const functions = [
      'contains', 'startswith', 'endswith', 'length', 
      'indexof', 'substring', 'tolower', 'toupper', 'trim', 'concat'
    ];
    
    functions.forEach(fn => {
      expect(() => ODataFilterFunctionSchema.parse(fn)).not.toThrow();
    });
  });

  it('should accept date/time functions', () => {
    const functions = [
      'year', 'month', 'day', 'hour', 'minute', 'second',
      'date', 'time', 'now', 'maxdatetime', 'mindatetime'
    ];
    
    functions.forEach(fn => {
      expect(() => ODataFilterFunctionSchema.parse(fn)).not.toThrow();
    });
  });

  it('should accept math functions', () => {
    const functions = ['round', 'floor', 'ceiling'];
    
    functions.forEach(fn => {
      expect(() => ODataFilterFunctionSchema.parse(fn)).not.toThrow();
    });
  });

  it('should accept type functions', () => {
    expect(() => ODataFilterFunctionSchema.parse('cast')).not.toThrow();
    expect(() => ODataFilterFunctionSchema.parse('isof')).not.toThrow();
  });

  it('should accept collection functions', () => {
    expect(() => ODataFilterFunctionSchema.parse('any')).not.toThrow();
    expect(() => ODataFilterFunctionSchema.parse('all')).not.toThrow();
  });
});

describe('ODataResponseSchema', () => {
  it('should accept basic response', () => {
    const response = ODataResponseSchema.parse({
      value: [
        { id: '1', name: 'Item 1' },
        { id: '2', name: 'Item 2' },
      ],
    });

    expect(response.value).toHaveLength(2);
  });

  it('should accept response with context', () => {
    const response = ODataResponseSchema.parse({
      '@odata.context': 'https://api.example.com/$metadata#Customers',
      value: [{ id: '1', name: 'Customer 1' }],
    });

    expect(response['@odata.context']).toBeDefined();
  });

  it('should accept response with count', () => {
    const response = ODataResponseSchema.parse({
      '@odata.count': 100,
      value: [{ id: '1' }],
    });

    expect(response['@odata.count']).toBe(100);
  });

  it('should accept response with nextLink', () => {
    const response = ODataResponseSchema.parse({
      '@odata.nextLink': 'https://api.example.com/customers?$skip=10',
      value: [{ id: '1' }],
    });

    expect(response['@odata.nextLink']).toBeDefined();
  });

  it('should accept complete response', () => {
    const response = ODataResponseSchema.parse({
      '@odata.context': 'https://api.example.com/$metadata#Customers',
      '@odata.count': 100,
      '@odata.nextLink': 'https://api.example.com/customers?$skip=10',
      value: [
        { id: '1', name: 'Customer 1' },
        { id: '2', name: 'Customer 2' },
      ],
    });

    expect(response.value).toHaveLength(2);
    expect(response['@odata.count']).toBe(100);
  });
});

describe('ODataErrorSchema', () => {
  it('should accept basic error', () => {
    const error = ODataErrorSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input data',
      },
    });

    expect(error.error.code).toBe('VALIDATION_ERROR');
    expect(error.error.message).toBe('Invalid input data');
  });

  it('should accept error with target', () => {
    const error = ODataErrorSchema.parse({
      error: {
        code: 'INVALID_FIELD',
        message: 'Field is required',
        target: 'email',
      },
    });

    expect(error.error.target).toBe('email');
  });

  it('should accept error with details', () => {
    const error = ODataErrorSchema.parse({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Multiple validation errors',
        details: [
          { code: 'required', message: 'Email is required', target: 'email' },
          { code: 'min_length', message: 'Name too short', target: 'name' },
        ],
      },
    });

    expect(error.error.details).toHaveLength(2);
  });

  it('should accept error with inner error', () => {
    const error = ODataErrorSchema.parse({
      error: {
        code: 'server_error',
        message: 'Internal error',
        innererror: {
          stackTrace: 'Error at line 123...',
          requestId: 'req-abc-123',
        },
      },
    });

    expect(error.error.innererror).toBeDefined();
  });
});

describe('ODataMetadataSchema', () => {
  it('should accept basic metadata', () => {
    const metadata = ODataMetadataSchema.parse({
      namespace: 'MyService',
      entityTypes: [
        {
          name: 'Customer',
          key: ['id'],
          properties: [
            { name: 'id', type: 'Edm.String' },
            { name: 'name', type: 'Edm.String' },
          ],
        },
      ],
      entitySets: [
        { name: 'Customers', entityType: 'Customer' },
      ],
    });

    expect(metadata.namespace).toBe('MyService');
    expect(metadata.entityTypes).toHaveLength(1);
    expect(metadata.entitySets).toHaveLength(1);
  });

  it('should accept entity type with navigation properties', () => {
    const metadata = ODataMetadataSchema.parse({
      namespace: 'MyService',
      entityTypes: [
        {
          name: 'Order',
          key: ['id'],
          properties: [
            { name: 'id', type: 'Edm.String' },
            { name: 'total', type: 'Edm.Decimal' },
          ],
          navigationProperties: [
            { name: 'customer', type: 'Customer' },
          ],
        },
      ],
      entitySets: [
        { name: 'Orders', entityType: 'Order' },
      ],
    });

    expect(metadata.entityTypes[0].navigationProperties).toHaveLength(1);
  });

  it('should apply default nullable', () => {
    const metadata = ODataMetadataSchema.parse({
      namespace: 'MyService',
      entityTypes: [
        {
          name: 'Product',
          key: ['id'],
          properties: [
            { name: 'id', type: 'Edm.String' },
          ],
        },
      ],
      entitySets: [
        { name: 'Products', entityType: 'Product' },
      ],
    });

    expect(metadata.entityTypes[0].properties[0].nullable).toBe(true);
  });
});

describe('OData Helper Functions', () => {
  describe('buildUrl', () => {
    it('should build URL with select', () => {
      const url = OData.buildUrl('/api/customers', {
        $select: 'name,email',
      });

      expect(url).toBe('/api/customers?%24select=name%2Cemail');
    });

    it('should build URL with filter', () => {
      const url = OData.buildUrl('/api/customers', {
        $filter: "status eq 'active'",
      });

      expect(url).toContain('%24filter'); // URL-encoded $filter
    });

    it('should build URL with multiple parameters', () => {
      const url = OData.buildUrl('/api/customers', {
        $select: ['name', 'email'],
        $top: 10,
        $skip: 20,
        $count: true,
      });

      expect(url).toContain('%24select'); // URL-encoded $select
      expect(url).toContain('%24top');
      expect(url).toContain('%24skip');
      expect(url).toContain('%24count');
    });

    it('should return base URL when no query parameters', () => {
      const url = OData.buildUrl('/api/customers', {});

      expect(url).toBe('/api/customers');
    });
  });

  describe('filter helpers', () => {
    it('should create eq filter', () => {
      const filter = OData.filter.eq('status', 'active');
      expect(filter).toBe("status eq 'active'");
    });

    it('should create ne filter', () => {
      const filter = OData.filter.ne('status', 'inactive');
      expect(filter).toBe("status ne 'inactive'");
    });

    it('should create gt filter', () => {
      const filter = OData.filter.gt('revenue', 1000);
      expect(filter).toBe('revenue gt 1000');
    });

    it('should create lt filter', () => {
      const filter = OData.filter.lt('age', 30);
      expect(filter).toBe('age lt 30');
    });

    it('should create contains filter', () => {
      const filter = OData.filter.contains('name', 'Smith');
      expect(filter).toBe("contains(name, 'Smith')");
    });

    it('should create and filter', () => {
      const filter = OData.filter.and(
        OData.filter.eq('country', 'US'),
        OData.filter.gt('revenue', 100000)
      );
      expect(filter).toBe("country eq 'US' and revenue gt 100000");
    });

    it('should create or filter', () => {
      const filter = OData.filter.or(
        OData.filter.eq('status', 'active'),
        OData.filter.eq('status', 'pending')
      );
      expect(filter).toBe("status eq 'active' or status eq 'pending'");
    });

    it('should handle number values', () => {
      const filter = OData.filter.eq('count', 5);
      expect(filter).toBe('count eq 5');
    });

    it('should handle boolean values', () => {
      const filter = OData.filter.eq('isActive', true);
      expect(filter).toBe('isActive eq true');
    });
  });
});
