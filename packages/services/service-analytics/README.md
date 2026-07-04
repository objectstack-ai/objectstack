# @objectstack/service-analytics

Analytics Service for ObjectStack — implements `IAnalyticsService` with multi-driver strategy pattern (NativeSQL, ObjectQL, InMemory).

## Features

- **Multi-Driver Architecture**: Choose the right execution strategy for your analytics queries
  - **NativeSQL**: Direct SQL execution for maximum performance on large datasets
  - **ObjectQL**: Leverage ObjectStack's query engine for metadata-aware analytics
  - **InMemory**: Fast aggregations on small datasets without database round-trips
- **Aggregation Functions**: SUM, COUNT, AVG, MIN, MAX, GROUP BY, HAVING
- **Time Series Analysis**: Time-based aggregations and grouping
- **Custom Metrics**: Define and track custom business metrics
- **Dashboard Integration**: Auto-generated REST endpoints for visualization
- **Type-Safe**: Full TypeScript support with inferred result types

## Installation

```bash
pnpm add @objectstack/service-analytics
```

## Basic Usage

```typescript
import { defineStack } from '@objectstack/spec';
import { ServiceAnalytics } from '@objectstack/service-analytics';

const stack = defineStack({
  services: [
    ServiceAnalytics.configure({
      defaultDriver: 'objectql', // or 'sql', 'memory'
      enableCaching: true,
    }),
  ],
});
```

## Configuration

```typescript
interface AnalyticsServiceConfig {
  /** Default execution driver */
  defaultDriver?: 'sql' | 'objectql' | 'memory';

  /** Enable query result caching */
  enableCaching?: boolean;

  /** Cache TTL in seconds (default: 300) */
  cacheTTL?: number;

  /** Maximum result set size for in-memory driver */
  maxMemoryResults?: number;
}
```

## Service API

```typescript
// Get analytics service from kernel
const analytics = kernel.getService<IAnalyticsService>('analytics');
```

### Basic Aggregations

```typescript
// Count records
const totalOrders = await analytics.count({
  object: 'order',
  filters: [{ field: 'status', operator: 'eq', value: 'completed' }],
});

// Sum field values
const totalRevenue = await analytics.sum({
  object: 'order',
  field: 'amount',
  filters: [{ field: 'created_at', operator: 'gte', value: '2024-01-01' }],
});

// Calculate average
const avgOrderValue = await analytics.avg({
  object: 'order',
  field: 'amount',
});

// Find min/max
const highestOrder = await analytics.max({
  object: 'order',
  field: 'amount',
});
```

### Group By Aggregations

```typescript
// Revenue by product category
const revenueByCategory = await analytics.groupBy({
  object: 'order_item',
  groupBy: ['product.category'],
  aggregations: [
    { function: 'sum', field: 'total', as: 'revenue' },
    { function: 'count', as: 'order_count' },
  ],
});

// Result format:
// [
//   { category: 'Electronics', revenue: 125000, order_count: 342 },
//   { category: 'Clothing', revenue: 98000, order_count: 567 },
// ]
```

### Time Series Analytics

```typescript
// Daily revenue for the past 30 days
const dailyRevenue = await analytics.timeSeries({
  object: 'order',
  dateField: 'created_at',
  interval: 'day',
  aggregations: [
    { function: 'sum', field: 'amount', as: 'revenue' },
    { function: 'count', as: 'orders' },
  ],
  filters: [
    {
      field: 'created_at',
      operator: 'gte',
      value: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    },
  ],
});

// Result format:
// [
//   { date: '2024-01-01', revenue: 12500, orders: 45 },
//   { date: '2024-01-02', revenue: 15200, orders: 52 },
// ]
```

### Custom Metrics

```typescript
// Define a metric
analytics.defineMetric({
  name: 'monthly_recurring_revenue',
  description: 'MRR from active subscriptions',
  calculation: {
    object: 'subscription',
    aggregation: 'sum',
    field: 'amount',
    filters: [{ field: 'status', operator: 'eq', value: 'active' }],
  },
});

// Query the metric
const mrr = await analytics.getMetric('monthly_recurring_revenue');
```

## Multi-Driver Strategy

### When to Use Each Driver

#### NativeSQL Driver
**Best for**: Large datasets, complex joins, database-specific optimizations

```typescript
const result = await analytics.query({
  driver: 'sql',
  object: 'order',
  aggregations: [{ function: 'sum', field: 'amount' }],
  groupBy: ['customer_id'],
  having: [{ field: 'sum_amount', operator: 'gt', value: 10000 }],
});
```

**Advantages:**
- Direct SQL execution for maximum performance
- Leverages database indexes and query optimization
- Handles millions of records efficiently

**Limitations:**
- Bypasses ObjectStack metadata layer
- May miss field-level transformations
- Less portable across databases

#### ObjectQL Driver
**Best for**: Metadata-aware analytics, cross-object aggregations

```typescript
const result = await analytics.query({
  driver: 'objectql',
  object: 'opportunity',
  aggregations: [
    { function: 'sum', field: 'amount' },
    { function: 'count' },
  ],
  groupBy: ['account.industry'],
});
```

**Advantages:**
- Respects object/field metadata and permissions
- Handles formula fields and computed values
- Consistent with ObjectQL query behavior

**Limitations:**
- Slightly slower than direct SQL
- Additional abstraction layer

#### InMemory Driver
**Best for**: Small datasets, pre-filtered results, real-time dashboards

```typescript
const result = await analytics.query({
  driver: 'memory',
  object: 'task',
  aggregations: [{ function: 'count' }],
  groupBy: ['status'],
});
```

**Advantages:**
- Zero database round-trips for cached data
- Instant results for small datasets
- Useful for client-side analytics

**Limitations:**
- Limited to `maxMemoryResults` (default: 10,000)
- Requires data to be loaded into memory first

## REST API Endpoints

When used with `@objectstack/rest`:

```
POST   /api/v1/analytics/count          # Count records
POST   /api/v1/analytics/sum             # Sum field values
POST   /api/v1/analytics/avg             # Calculate average
POST   /api/v1/analytics/min             # Find minimum
POST   /api/v1/analytics/max             # Find maximum
POST   /api/v1/analytics/group-by        # Group by aggregation
POST   /api/v1/analytics/time-series     # Time series analysis
GET    /api/v1/analytics/metrics         # List custom metrics
GET    /api/v1/analytics/metrics/:name   # Get metric value
```

## Dashboard Integration

```typescript
// Define a dashboard with multiple metrics
const salesDashboard = {
  title: 'Sales Dashboard',
  metrics: [
    {
      title: 'Total Revenue',
      query: {
        object: 'order',
        aggregation: 'sum',
        field: 'amount',
      },
    },
    {
      title: 'Revenue by Region',
      query: {
        object: 'order',
        aggregations: [{ function: 'sum', field: 'amount', as: 'revenue' }],
        groupBy: ['account.billing_region'],
      },
    },
  ],
};

// Execute all dashboard queries
const dashboardData = await analytics.executeDashboard(salesDashboard);
```

## Advanced Features

### Query Caching

```typescript
// Enable caching for expensive queries
const result = await analytics.query({
  object: 'order',
  aggregations: [{ function: 'sum', field: 'amount' }],
  cache: {
    enabled: true,
    ttl: 600, // 10 minutes
  },
});

// Invalidate cache when data changes
analytics.invalidateCache('order');
```

### Comparative Analytics

```typescript
// Compare current vs. previous period
const comparison = await analytics.compare({
  object: 'order',
  aggregation: 'sum',
  field: 'amount',
  currentPeriod: {
    start: '2024-01-01',
    end: '2024-01-31',
  },
  comparisonPeriod: {
    start: '2023-12-01',
    end: '2023-12-31',
  },
});

// Result:
// {
//   current: 125000,
//   comparison: 110000,
//   change: 15000,
//   percentChange: 13.64
// }
```

### Funnel Analysis

```typescript
// Define a conversion funnel
const funnel = await analytics.funnel({
  steps: [
    { object: 'lead', stage: 'new' },
    { object: 'lead', stage: 'qualified' },
    { object: 'opportunity', stage: 'proposal' },
    { object: 'opportunity', stage: 'closed_won' },
  ],
  dateRange: {
    start: '2024-01-01',
    end: '2024-01-31',
  },
});

// Result:
// {
//   steps: [
//     { stage: 'new', count: 1000, percentage: 100 },
//     { stage: 'qualified', count: 450, percentage: 45 },
//     { stage: 'proposal', count: 200, percentage: 20 },
//     { stage: 'closed_won', count: 75, percentage: 7.5 },
//   ],
//   overallConversion: 0.075
// }
```

## Contract Implementation

Implements `IAnalyticsService` from `@objectstack/spec/contracts`:

```typescript
interface IAnalyticsService {
  count(options: CountOptions): Promise<number>;
  sum(options: AggregationOptions): Promise<number>;
  avg(options: AggregationOptions): Promise<number>;
  min(options: AggregationOptions): Promise<number>;
  max(options: AggregationOptions): Promise<number>;
  groupBy(options: GroupByOptions): Promise<AggregationResult[]>;
  timeSeries(options: TimeSeriesOptions): Promise<TimeSeriesResult[]>;
  defineMetric(metric: MetricDefinition): void;
  getMetric(name: string): Promise<number | AggregationResult[]>;
}
```

## Performance Optimization

1. **Choose the Right Driver**: Use SQL for large datasets, InMemory for small
2. **Enable Caching**: Cache expensive queries with appropriate TTL
3. **Optimize Filters**: Filter early to reduce dataset size
4. **Use Indexes**: Ensure database indexes on frequently queried fields
5. **Batch Queries**: Execute multiple metrics in a single dashboard query

## Best Practices

1. **Driver Selection**: Start with ObjectQL, optimize to SQL if needed
2. **Metric Definitions**: Define reusable metrics for consistency
3. **Cache Strategy**: Cache expensive queries, invalidate on data changes
4. **Time Series**: Use appropriate intervals (hour/day/week/month)
5. **Group By**: Limit grouping dimensions to avoid explosion of result sets

## License

Apache-2.0. See [LICENSING.md](../../../LICENSING.md).

## See Also

- [@objectstack/objectql](../../objectql/)
- [@objectstack/spec/contracts](../../spec/src/contracts/)
- [Analytics Guide](/content/docs/data-modeling/analytics.mdx)
