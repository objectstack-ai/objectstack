/**
 * ObjectUI - Query AST Builder
 * Phase 3.3: DriverQueryConfig AST implementation
 * ObjectStack Spec v2.0.1: Window functions support
 */

import type {
  SqlQueryAST,
  DriverQueryConfig,
  SelectNode,
  FromNode,
  WhereNode,
  JoinNode,
  GroupByClauseNode,
  OrderByNode,
  LimitNode,
  OffsetNode,
  AggregateNode,
  WindowNode,
  WindowConfig,
  FieldNode,
  LiteralNode,
  OperatorNode,
  LogicalOperator,
  AdvancedFilterSchema,
  AdvancedFilterCondition,
  QuerySortConfig,
  JoinConfig,
  AggregationConfig,
} from '@object-ui/types';

/**
 * Query AST Builder - Converts DriverQueryConfig to AST
 */
export class QueryASTBuilder {
  build(query: DriverQueryConfig): SqlQueryAST {
    const ast: SqlQueryAST = {
      select: this.buildSelect(query),
      from: this.buildFrom(query),
    };

    if (query.filter) {
      ast.where = this.buildWhere(query.filter);
    }

    if (query.joins && query.joins.length > 0) {
      ast.joins = query.joins.map(join => this.buildJoin(join));
    }

    if (query.group_by && query.group_by.length > 0) {
      ast.group_by = this.buildGroupBy(query.group_by);
    }

    if (query.sort && query.sort.length > 0) {
      ast.order_by = this.buildOrderBy(query.sort);
    }

    if (query.limit !== undefined) {
      ast.limit = this.buildLimit(query.limit);
    }

    if (query.offset !== undefined) {
      ast.offset = this.buildOffset(query.offset);
    }

    return ast;
  }

  private buildSelect(query: DriverQueryConfig): SelectNode {
    const fields: (FieldNode | AggregateNode | WindowNode)[] = [];

    if (query.fields && query.fields.length > 0) {
      fields.push(...query.fields.map(field => this.buildField(field)));
    } else if (!query.aggregations || query.aggregations.length === 0) {
      // Only add '*' if there are no aggregations
      fields.push(this.buildField('*'));
    }

    if (query.aggregations && query.aggregations.length > 0) {
      fields.push(...query.aggregations.map(agg => this.buildAggregation(agg)));
    }

    // Add window functions (ObjectStack Spec v2.0.1)
    if (query.windows && query.windows.length > 0) {
      fields.push(...query.windows.map(win => this.buildWindow(win)));
    }

    return {
      type: 'select',
      fields,
      distinct: false,
    };
  }

  private buildFrom(query: DriverQueryConfig): FromNode {
    return {
      type: 'from',
      table: query.object,
    };
  }

  private buildWhere(filter: AdvancedFilterSchema): WhereNode {
    return {
      type: 'where',
      condition: this.buildFilterCondition(filter),
    };
  }

  private buildFilterCondition(filter: AdvancedFilterSchema): OperatorNode {
    const operator = filter.operator || 'and';
    const operands: (OperatorNode | FieldNode | LiteralNode)[] = [];

    if (filter.conditions && filter.conditions.length > 0) {
      operands.push(...filter.conditions.map(cond => this.buildCondition(cond)));
    }

    if (filter.groups && filter.groups.length > 0) {
      operands.push(...filter.groups.map(group => this.buildFilterCondition(group)));
    }

    return {
      type: 'operator',
      operator: operator as LogicalOperator,
      operands,
    };
  }

  private buildCondition(condition: AdvancedFilterCondition): OperatorNode {
    const field = this.buildField(condition.field);
    
    // Map filter operators to comparison operators
    const operatorMap: Record<string, string> = {
      'equals': '=',
      'not_equals': '!=',
      'greater_than': '>',
      'greater_than_or_equal': '>=',
      'less_than': '<',
      'less_than_or_equal': '<=',
      'contains': 'contains',
      'not_contains': 'contains',
      'starts_with': 'starts_with',
      'ends_with': 'ends_with',
      'like': 'like',
      'ilike': 'ilike',
      'in': 'in',
      'not_in': 'not_in',
      'is_null': 'is_null',
      'is_not_null': 'is_not_null',
      'between': 'between',
    };

    const operator = operatorMap[condition.operator] || '=';
    
    // Handle special operators
    if (operator === 'between' && condition.values && condition.values.length === 2) {
      return {
        type: 'operator',
        operator: 'between' as any,
        operands: [
          field,
          this.buildLiteral(condition.values[0]),
          this.buildLiteral(condition.values[1])
        ],
      };
    }

    if ((operator === 'in' || operator === 'not_in') && condition.values) {
      return {
        type: 'operator',
        operator: operator as any,
        operands: [field, ...condition.values.map(v => this.buildLiteral(v))],
      };
    }

    if (operator === 'is_null' || operator === 'is_not_null') {
      return {
        type: 'operator',
        operator: operator as any,
        operands: [field],
      };
    }

    // Standard binary operator
    const value = this.buildLiteral(condition.value);
    return {
      type: 'operator',
      operator: operator as any,
      operands: [field, value],
    };
  }

  private buildJoin(join: JoinConfig): JoinNode {
    const onCondition: OperatorNode = {
      type: 'operator',
      operator: '=',
      operands: [
        this.buildField(join.on.local_field),
        this.buildField(join.on.foreign_field, join.alias || join.object),
      ],
    };

    return {
      type: 'join',
      join_type: join.type,
      table: join.object,
      alias: join.alias,
      on: onCondition,
    };
  }

  private buildGroupBy(fields: string[]): GroupByClauseNode {
    return {
      type: 'group_by',
      fields: fields.map(field => this.buildField(field)),
    };
  }

  private buildOrderBy(sorts: QuerySortConfig[]): OrderByNode {
    return {
      type: 'order_by',
      fields: sorts.map(sort => ({
        field: this.buildField(sort.field),
        direction: sort.order,
      })),
    };
  }

  private buildLimit(limit: number): LimitNode {
    return {
      type: 'limit',
      value: limit,
    };
  }

  private buildOffset(offset: number): OffsetNode {
    return {
      type: 'offset',
      value: offset,
    };
  }

  private buildField(field: string, table?: string): FieldNode {
    const parts = field.split('.');
    
    if (parts.length === 2) {
      return {
        type: 'field',
        table: parts[0],
        name: parts[1],
      };
    }

    return {
      type: 'field',
      table,
      name: field,
    };
  }

  private buildLiteral(value: any): LiteralNode {
    let dataType: 'string' | 'number' | 'boolean' | 'date' | 'null' = 'string';
    
    if (value === null || value === undefined) {
      dataType = 'null';
    } else if (typeof value === 'number') {
      dataType = 'number';
    } else if (typeof value === 'boolean') {
      dataType = 'boolean';
    } else if (value instanceof Date) {
      dataType = 'date';
    }

    return {
      type: 'literal',
      value,
      data_type: dataType,
    };
  }

  private buildAggregation(agg: AggregationConfig): AggregateNode {
    return {
      type: 'aggregate',
      function: agg.function,
      field: agg.field ? this.buildField(agg.field) : undefined,
      alias: agg.alias,
      distinct: agg.distinct,
    };
  }

  /**
   * Build window function node (ObjectStack Spec v2.0.1)
   */
  private buildWindow(config: WindowConfig): WindowNode {
    const node: WindowNode = {
      type: 'window',
      function: config.function,
      alias: config.alias,
    };

    if (config.field) {
      node.field = this.buildField(config.field);
    }

    if (config.partitionBy && config.partitionBy.length > 0) {
      node.partitionBy = config.partitionBy.map(field => this.buildField(field));
    }

    if (config.orderBy && config.orderBy.length > 0) {
      node.orderBy = config.orderBy.map(sort => ({
        field: this.buildField(sort.field),
        direction: sort.direction,
      }));
    }

    if (config.frame) {
      node.frame = config.frame;
    }

    if (config.offset !== undefined) {
      node.offset = config.offset;
    }

    if (config.defaultValue !== undefined) {
      node.defaultValue = this.buildLiteral(config.defaultValue);
    }

    return node;
  }

  optimize(ast: SqlQueryAST): SqlQueryAST {
    return ast;
  }
}

export const defaultQueryASTBuilder = new QueryASTBuilder();

export function buildQueryAST(query: DriverQueryConfig): SqlQueryAST {
  return defaultQueryASTBuilder.build(query);
}
