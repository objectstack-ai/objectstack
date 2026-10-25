# Filter Builder Component

An Airtable-like filter builder component for building complex query conditions in Object UI.

## Overview

The Filter Builder component provides a user-friendly interface for creating and managing filter conditions. It supports:

- ✅ Dynamic add/remove filter conditions
- ✅ Field selection from configurable list
- ✅ Type-aware operators (text, number, boolean, date, select)
- ✅ AND/OR logic toggling
- ✅ Clear all filters button
- ✅ Date picker support for date fields
- ✅ Dropdown support for select fields
- ✅ Schema-driven configuration
- ✅ Tailwind CSS styled with Shadcn UI components

## Usage

### Basic Example

```typescript
{
  type: 'filter-builder',
  name: 'userFilters',
  label: 'User Filters',
  fields: [
    { value: 'name', label: 'Name', type: 'text' },
    { value: 'email', label: 'Email', type: 'text' },
    { value: 'age', label: 'Age', type: 'number' },
    { value: 'status', label: 'Status', type: 'text' }
  ],
  value: {
    id: 'root',
    logic: 'and',
    conditions: [
      {
        id: 'cond-1',
        field: 'status',
        operator: 'equals',
        value: 'active'
      }
    ]
  }
}
```

### With Select Fields

```typescript
{
  type: 'filter-builder',
  name: 'productFilters',
  label: 'Product Filters',
  fields: [
    { value: 'name', label: 'Product Name', type: 'text' },
    { value: 'price', label: 'Price', type: 'number' },
    { 
      value: 'category', 
      label: 'Category', 
      type: 'select',
      options: [
        { value: 'electronics', label: 'Electronics' },
        { value: 'clothing', label: 'Clothing' },
        { value: 'food', label: 'Food' }
      ]
    },
    { value: 'inStock', label: 'In Stock', type: 'boolean' }
  ],
  value: {
    id: 'root',
    logic: 'and',
    conditions: []
  }
}
```

### With Date Fields

```typescript
{
  type: 'filter-builder',
  name: 'orderFilters',
  label: 'Order Filters',
  fields: [
    { value: 'orderId', label: 'Order ID', type: 'text' },
    { value: 'amount', label: 'Amount', type: 'number' },
    { value: 'orderDate', label: 'Order Date', type: 'date' },
    { value: 'shipped', label: 'Shipped', type: 'boolean' }
  ],
  showClearAll: true
}
```

## Props

### Schema Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `type` | `string` | ✅ | Must be `'filter-builder'` |
| `name` | `string` | ✅ | Form field name for the filter value |
| `label` | `string` | ❌ | Label displayed above the filter builder |
| `fields` | `Field[]` | ✅ | Array of available fields for filtering |
| `value` | `FilterGroup` | ❌ | Initial filter configuration |
| `showClearAll` | `boolean` | ❌ | Show "Clear all" button (default: true) |

### Field Type

```typescript
interface Field {
  value: string;    // Field identifier
  label: string;    // Display label
  type?: string;    // Field type: 'text' | 'number' | 'boolean' | 'date' | 'select'
  options?: Array<{ value: string; label: string }> // For select fields
}
```

### FilterGroup Type

The schema's `value` is `FilterGroup` from `@object-ui/types`, the authored group.
The React component's `value` / `onChange` use `FilterBuilderRowGroup` from
`@object-ui/components`: the same group, derived from `FilterGroup`, whose rows
are `FilterBuilderRow` (the builder's own operator ids and a required value).

```typescript
interface FilterBuilderRowGroup {
  id?: string;                   // Group identifier (optional: nothing reads it)
  logic: 'and' | 'or';          // Logic operator
  conditions: FilterBuilderRow[]; // Flat rows; a nested group is refused
}

interface FilterBuilderRow {
  id: string;                    // Row identifier (required)
  field: string;                 // Field value
  operator: FilterBuilderOperator; // Operator id (see below)
  value: string | number | boolean | (string | number | boolean)[]; // Filter value
}
```

## Operators

The available operators change based on the field type. Each is listed by the
id a row stores, the protocol's canonical spelling (`@objectstack/spec`'s
`ViewFilterOperator`). A filter stored with a legacy camelCase alias such as
`notEquals` is still read and folded onto these ids; new filters store the ids
below. The lists here are abridged: `operatorsForFieldType` in
`src/custom/filter-builder.tsx` holds the complete per-type set, including the
null checks and the opt-in `exists` / `notExists` (offered only through the
`extraOperators` prop).

### Text Fields
- `equals` - Equals
- `not_equals` - Does not equal
- `contains` - Contains
- `not_contains` - Does not contain
- `is_empty` - Is empty
- `is_not_empty` - Is not empty

### Number Fields
- `equals` - Equals
- `not_equals` - Does not equal
- `greater_than` - Greater than
- `less_than` - Less than
- `greater_than_or_equal` - Greater than or equal
- `less_than_or_equal` - Less than or equal
- `is_empty` - Is empty
- `is_not_empty` - Is not empty

### Boolean Fields
- `equals` - Equals
- `not_equals` - Does not equal

### Date Fields
- `equals` - Equals
- `not_equals` - Does not equal
- `before` - Before
- `after` - After
- `between` - Between
- `is_empty` - Is empty
- `is_not_empty` - Is not empty

### Select Fields
- `equals` - Equals
- `not_equals` - Does not equal
- `in` - In
- `not_in` - Not in
- `is_empty` - Is empty
- `is_not_empty` - Is not empty

## Events

The component emits change events when the filter configuration is modified:

```typescript
{
  target: {
    name: 'filters',
    value: {
      id: 'root',
      logic: 'and',
      conditions: [...]
    }
  }
}
```

## Demo

To see the filter builder in action:

```bash
pnpm --filter prototype dev
# Visit http://localhost:5173/?demo=filter-builder
```

## Styling

The component is fully styled with Tailwind CSS and follows the Object UI design system. All Shadcn UI components are used for consistent look and feel.

You can customize the appearance using the `className` prop or by overriding Tailwind classes.

## Integration

The Filter Builder integrates seamlessly with Object UI's schema system and can be used in:

- Forms
- Data tables
- Search interfaces
- Admin panels
- Dashboard filters

## Example in Context

```typescript
const pageSchema = {
  type: 'page',
  title: 'User Management',
  children: [
    {
      type: 'card',
      children: [
        {
          type: 'filter-builder',
          name: 'userFilters',
          label: 'Filter Users',
          fields: [
            { value: 'name', label: 'Name', type: 'text' },
            { value: 'email', label: 'Email', type: 'text' },
            { value: 'age', label: 'Age', type: 'number' },
            { value: 'department', label: 'Department', type: 'text' },
            { value: 'active', label: 'Active', type: 'boolean' }
          ]
        }
      ]
    },
    {
      type: 'table',
      // table configuration...
    }
  ]
};
```

## Technical Details

- Built with React 19 hooks
- Uses Radix UI primitives (Select, Popover)
- Type-safe with TypeScript
- Accessible keyboard navigation
- Responsive design

## Browser Support

Works in all modern browsers that support:
- ES6+
- CSS Grid
- Flexbox
- crypto.randomUUID()
