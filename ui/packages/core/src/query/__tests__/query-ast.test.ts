/**
 * @object-ui/core - Query AST Builder Tests
 */

import { describe, it, expect } from 'vitest';
import { QueryASTBuilder } from '../query-ast';
import type { DriverQueryConfig } from '@object-ui/types';

describe('QueryASTBuilder', () => {
  const builder = new QueryASTBuilder();

  describe('Basic Query Building', () => {
    it('should build simple SELECT query', () => {
      const query: DriverQueryConfig = {
        object: 'users',
        fields: ['id', 'name', 'email'],
      };

      const ast = builder.build(query);

      expect(ast.select.type).toBe('select');
      expect(ast.select.fields).toHaveLength(3);
      expect(ast.from.table).toBe('users');
    });

    it('should build SELECT * when no fields specified', () => {
      const query: DriverQueryConfig = {
        object: 'users',
      };

      const ast = builder.build(query);

      expect(ast.select.fields).toHaveLength(1);
      expect(ast.select.fields[0]).toMatchObject({
        type: 'field',
        name: '*',
      });
    });

    it('should build query with WHERE clause', () => {
      const query: DriverQueryConfig = {
        object: 'users',
        fields: ['id', 'name'],
        filter: {
          conditions: [
            {
              field: 'status',
              operator: 'equals',
              value: 'active',
            },
          ],
        },
      };

      const ast = builder.build(query);

      expect(ast.where).toBeDefined();
      expect(ast.where?.type).toBe('where');
      expect(ast.where?.condition.type).toBe('operator');
    });

    it('should build query with ORDER BY', () => {
      const query: DriverQueryConfig = {
        object: 'users',
        fields: ['id', 'name'],
        sort: [
          { field: 'created_at', order: 'desc' },
          { field: 'name', order: 'asc' },
        ],
      };

      const ast = builder.build(query);

      expect(ast.order_by).toBeDefined();
      expect(ast.order_by?.fields).toHaveLength(2);
      expect(ast.order_by?.fields[0].direction).toBe('desc');
    });

    it('should build query with LIMIT and OFFSET', () => {
      const query: DriverQueryConfig = {
        object: 'users',
        fields: ['id', 'name'],
        limit: 10,
        offset: 20,
      };

      const ast = builder.build(query);

      expect(ast.limit).toBeDefined();
      expect(ast.limit?.value).toBe(10);
      expect(ast.offset).toBeDefined();
      expect(ast.offset?.value).toBe(20);
    });
  });

  describe('Advanced Query Building', () => {
    it('should build query with JOIN', () => {
      const query: DriverQueryConfig = {
        object: 'users',
        fields: ['id', 'name', 'orders.total'],
        joins: [
          {
            type: 'left',
            object: 'orders',
            on: {
              local_field: 'id',
              foreign_field: 'user_id',
            },
          },
        ],
      };

      const ast = builder.build(query);

      expect(ast.joins).toBeDefined();
      expect(ast.joins).toHaveLength(1);
      expect(ast.joins?.[0].join_type).toBe('left');
      expect(ast.joins?.[0].table).toBe('orders');
    });

    it('should build query with aggregations', () => {
      const query: DriverQueryConfig = {
        object: 'orders',
        aggregations: [
          {
            function: 'count',
            alias: 'total_count',
          },
          {
            function: 'sum',
            field: 'amount',
            alias: 'total_amount',
          },
        ],
      };

      const ast = builder.build(query);

      expect(ast.select.fields).toHaveLength(2);
      expect(ast.select.fields[0]).toMatchObject({
        type: 'aggregate',
        function: 'count',
        alias: 'total_count',
      });
    });

    it('should build query with GROUP BY', () => {
      const query: DriverQueryConfig = {
        object: 'orders',
        fields: ['user_id'],
        group_by: ['user_id'],
        aggregations: [
          {
            function: 'count',
            alias: 'order_count',
          },
        ],
      };

      const ast = builder.build(query);

      expect(ast.group_by).toBeDefined();
      expect(ast.group_by?.fields).toHaveLength(1);
      expect(ast.group_by?.fields[0]).toMatchObject({
        type: 'field',
        name: 'user_id',
      });
    });
  });

  describe('Complex Filters', () => {
    it('should build query with nested AND/OR filters', () => {
      const query: DriverQueryConfig = {
        object: 'users',
        filter: {
          operator: 'and',
          conditions: [
            {
              field: 'status',
              operator: 'equals',
              value: 'active',
            },
          ],
          groups: [
            {
              operator: 'or',
              conditions: [
                {
                  field: 'role',
                  operator: 'equals',
                  value: 'admin',
                },
                {
                  field: 'role',
                  operator: 'equals',
                  value: 'moderator',
                },
              ],
            },
          ],
        },
      };

      const ast = builder.build(query);

      expect(ast.where).toBeDefined();
      expect(ast.where?.condition.operator).toBe('and');
      expect(ast.where?.condition.operands.length).toBeGreaterThan(0);
    });
  });
});
