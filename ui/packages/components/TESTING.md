# Component and Renderer Testing Guide

## Overview

This document describes the comprehensive automated testing infrastructure for ObjectUI components and renderers. The tests are designed to automatically discover display, accessibility, and structural issues in UI components.

## Test Architecture

### Test Utilities (`test-utils.tsx`)

A suite of helper functions that provide automated checks for common display issues:

#### `renderComponent(schema, options)`
Renders a component from its schema definition for testing.

```typescript
const { container } = renderComponent({
  type: 'button',
  label: 'Click Me',
});
```

#### `checkAccessibility(element)`
Validates accessibility attributes and identifies common a11y issues:
- Missing ARIA labels on interactive elements
- Missing form labels
- Missing alt attributes on images

Returns:
```typescript
{
  hasRole: boolean;
  hasAriaLabel: boolean;
  hasAriaDescribedBy: boolean;
  issues: string[]; // List of detected issues
}
```

#### `checkDOMStructure(container)`
Analyzes DOM structure for potential issues:
- Empty components
- Excessive nesting (>20 levels)
- Missing content

Returns:
```typescript
{
  hasContent: boolean;
  isEmpty: boolean;
  hasChildren: boolean;
  nestedDepth: number;
  issues: string[]; // List of detected issues
}
```

#### `checkStyling(element)`
Validates component styling:
- Class presence
- Tailwind CSS usage
- Inline styles

Returns:
```typescript
{
  hasClasses: boolean;
  hasTailwindClasses: boolean;
  hasInlineStyles: boolean;
  classes: string[];
}
```

#### `validateComponentRegistration(componentType)`
Verifies component registration in ComponentRegistry:
- Component is registered
- Has configuration
- Has renderer function
- Has label and inputs
- Has default props

Returns:
```typescript
{
  isRegistered: boolean;
  hasConfig: boolean;
  hasRenderer: boolean;
  hasLabel: boolean;
  hasInputs: boolean;
  hasDefaultProps: boolean;
  config: any;
}
```

#### `getAllDisplayIssues(container)`
Comprehensive check that runs all validation checks and returns aggregated issues:

```typescript
const issues = getAllDisplayIssues(container);
// Returns array of issue descriptions
```

## Test Coverage

### Component Categories

The test suite covers all major component categories:

1. **Basic Components** (`basic-renderers.test.tsx`)
   - Text, Div, Span, Image, Icon, Separator, HTML

2. **Form Components** (`form-renderers.test.tsx`)
   - Button, Input, Textarea, Select, Checkbox, Switch
   - Radio Group, Slider, Label, Email, Password

3. **Layout Components** (`layout-data-renderers.test.tsx`)
   - Container, Grid, Flex

4. **Data Display Components** (`layout-data-renderers.test.tsx`)
   - List, Tree View, Badge, Avatar, Alert
   - Breadcrumb, Statistic, Kbd

5. **Feedback Components** (`feedback-overlay-renderers.test.tsx`)
   - Loading, Spinner, Progress, Skeleton, Empty, Toast

6. **Overlay Components** (`feedback-overlay-renderers.test.tsx`)
   - Dialog, Alert Dialog, Sheet, Drawer
   - Popover, Tooltip, Dropdown Menu, Context Menu
   - Hover Card, Menubar

7. **Disclosure Components** (`complex-disclosure-renderers.test.tsx`)
   - Accordion, Collapsible, Toggle Group

8. **Complex Components** (`complex-disclosure-renderers.test.tsx`)
   - Timeline, Data Table, Chatbot, Carousel
   - Scroll Area, Resizable, Filter Builder, Calendar View, Table

## What the Tests Check

### 1. Component Registration
Every component should be properly registered:
```typescript
it('should be properly registered', () => {
  const validation = validateComponentRegistration('button');
  expect(validation.isRegistered).toBe(true);
  expect(validation.hasConfig).toBe(true);
  expect(validation.hasLabel).toBe(true);
});
```

### 2. Rendering Without Errors
Components should render without throwing errors:
```typescript
it('should render without issues', () => {
  const { container } = renderComponent({
    type: 'button',
    label: 'Test',
  });
  expect(container).toBeDefined();
});
```

### 3. Accessibility
Components should be accessible:
```typescript
it('should have proper accessibility', () => {
  const { container } = renderComponent({
    type: 'button',
    label: 'Click Me',
  });
  
  const issues = getAllDisplayIssues(container);
  const a11yIssues = issues.filter(i => i.includes('accessible'));
  expect(a11yIssues).toHaveLength(0);
});
```

### 4. DOM Structure
Components should have valid DOM structure:
```typescript
it('should have valid structure', () => {
  const { container } = renderComponent({
    type: 'container',
    children: [{ type: 'text', content: 'Content' }],
  });
  
  const domCheck = checkDOMStructure(container);
  expect(domCheck.hasContent).toBe(true);
  expect(domCheck.isEmpty).toBe(false);
  expect(domCheck.nestedDepth).toBeLessThan(20);
});
```

### 5. Props and Variants
Components should support their documented props:
```typescript
it('should support variants', () => {
  const variants = ['default', 'secondary', 'destructive'];
  
  variants.forEach(variant => {
    const { container } = renderComponent({
      type: 'button',
      label: 'Test',
      variant,
    });
    expect(container).toBeDefined();
  });
});
```

## Running Tests

### Run All Tests
```bash
pnpm test
```

### Run Component Tests Only
```bash
pnpm vitest run packages/components/src/__tests__/
```

### Run Specific Test File
```bash
pnpm vitest run packages/components/src/__tests__/form-renderers.test.tsx
```

### Watch Mode
```bash
pnpm test:watch
```

### Coverage Report
```bash
pnpm test:coverage
```

### Interactive UI
```bash
pnpm test:ui
```

## Test Results

Current test coverage:
- **150 total tests** across all component categories
- **140 passing** (93% pass rate)
- **10 failing** - identifying real schema/prop mismatches that need fixing

The failing tests are valuable as they automatically discovered:
- Components with missing props
- Schema mismatches (e.g., `content` vs `html`, `text` vs `content`)
- Missing default values
- Incorrect prop expectations

## Adding New Tests

### For New Components

When adding a new component, create tests following this pattern:

```typescript
describe('MyComponent Renderer', () => {
  it('should be properly registered', () => {
    const validation = validateComponentRegistration('my-component');
    expect(validation.isRegistered).toBe(true);
    expect(validation.hasConfig).toBe(true);
  });

  it('should render without issues', () => {
    const { container } = renderComponent({
      type: 'my-component',
      // ... required props
    });

    expect(container).toBeDefined();
    const issues = getAllDisplayIssues(container);
    expect(issues).toHaveLength(0);
  });

  it('should support required props', () => {
    const { container } = renderComponent({
      type: 'my-component',
      requiredProp: 'value',
    });

    expect(container.textContent).toContain('value');
  });
});
```

### For Display Issue Detection

Add specific checks for known issues:

```typescript
it('should not have excessive nesting', () => {
  const { container } = renderComponent({
    type: 'complex-component',
    data: complexData,
  });

  const domCheck = checkDOMStructure(container);
  expect(domCheck.nestedDepth).toBeLessThan(20);
});

it('should have proper ARIA attributes', () => {
  const { container } = renderComponent({
    type: 'interactive-component',
  });

  const button = container.querySelector('button');
  const a11y = checkAccessibility(button);
  expect(a11y.issues).toHaveLength(0);
});
```

## Benefits

This testing infrastructure provides:

1. **Automated Issue Detection** - Tests automatically find display and accessibility issues
2. **Regression Prevention** - Catches breaking changes in component rendering
3. **Documentation** - Tests serve as examples of how components should be used
4. **Confidence** - High test coverage ensures components work as expected
5. **Quick Feedback** - Fast test execution helps during development

## Future Enhancements

Potential improvements:

1. Visual regression testing with screenshot comparison
2. Performance benchmarking for complex components
3. Cross-browser testing
4. Responsive design testing
5. Theme variation testing
6. Integration tests with SchemaRenderer
