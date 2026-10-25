# Component Tests

This directory contains comprehensive automated tests for all ObjectUI component renderers.

## Test Files

### `test-utils.tsx`
Core testing utilities that provide automated checks for:
- Component rendering
- Accessibility validation
- DOM structure analysis
- Styling verification
- Component registration validation
- Comprehensive display issue detection

### `basic-renderers.test.tsx`
Tests for basic UI elements:
- Text, Div, Span, Image, Icon, Separator, HTML

**Coverage:** 22 tests

### `form-renderers.test.tsx`
Tests for form components:
- Button, Input, Textarea, Select, Checkbox, Switch
- Radio Group, Slider, Label, Email, Password

**Coverage:** 32 tests

### `layout-data-renderers.test.tsx`
Tests for layout and data display components:
- Layout: Container, Grid, Flex
- Data Display: List, Tree View, Badge, Avatar, Alert, Breadcrumb, Statistic, Kbd

**Coverage:** 33 tests

### `feedback-overlay-renderers.test.tsx`
Tests for feedback and overlay components:
- Feedback: Loading, Spinner, Progress, Skeleton, Empty, Toast
- Overlay: Dialog, Alert Dialog, Sheet, Drawer, Popover, Tooltip, Dropdown Menu, Context Menu, Hover Card, Menubar

**Coverage:** 35 tests

### `complex-disclosure-renderers.test.tsx`
Tests for complex and disclosure components:
- Disclosure: Accordion, Collapsible, Toggle Group
- Complex: Timeline, Data Table, Chatbot, Carousel, Scroll Area, Resizable, Filter Builder, Calendar View, Table

**Coverage:** 31 tests

## Running Tests

```bash
# Run all component tests
pnpm vitest run packages/components/src/__tests__/

# Run specific test file
pnpm vitest run packages/components/src/__tests__/form-renderers.test.tsx

# Watch mode
pnpm vitest packages/components/src/__tests__/

# With coverage
pnpm vitest run --coverage packages/components/src/__tests__/
```

## What Gets Tested

Each component test typically checks:

1. ✅ **Registration** - Component is registered in ComponentRegistry
2. ✅ **Rendering** - Component renders without errors
3. ✅ **Props** - All documented props work correctly
4. ✅ **Variants** - Different style variants render correctly
5. ✅ **Accessibility** - ARIA attributes and roles are present
6. ✅ **DOM Structure** - No excessive nesting or empty elements
7. ✅ **Content** - Text content and children render correctly
8. ✅ **State** - Disabled, readonly, required states work

## Automatic Issue Detection

Tests automatically detect:

- 🔍 Missing accessibility labels
- 🔍 Images without alt attributes
- 🔍 Excessive DOM nesting (>20 levels)
- 🔍 Empty component output
- 🔍 Form elements without labels
- 🔍 Missing component registration
- 🔍 Incorrect prop usage

## Test Results

Current Status:
- **150 total tests**
- **140 passing** (93%)
- **10 failing** (identifying real issues to fix)

The failing tests have discovered legitimate issues with component schemas and props that need to be addressed.

## Adding New Tests

When adding a new component, follow this pattern — the imports are the ones a
file in this directory writes, so copy the block whole:

<!-- doc-snippet: fragment — this pattern is a test file for THIS suite, so it imports `vitest` — which only the repository root declares, and which `scripts/check-doc-snippet-types.mjs` refuses for that reason — and the sibling `./test-utils`, a suite-local module `@object-ui/components` does not ship (its `files` list is `dist` only, and `dist/` holds no `test-utils`). Both specifiers are correct where the reader writes them and neither resolves in a probe compiled at the repository root -->
```typescript
import { describe, it, expect } from 'vitest';

import {
  getAllDisplayIssues,
  renderComponent,
  validateComponentRegistration,
} from './test-utils';

describe('NewComponent Renderer', () => {
  it('should be properly registered', () => {
    const validation = validateComponentRegistration('new-component');
    expect(validation.isRegistered).toBe(true);
  });

  it('should render without issues', () => {
    const { container } = renderComponent({
      type: 'new-component',
      requiredProp: 'value',
    });

    expect(container).toBeDefined();
    const issues = getAllDisplayIssues(container);
    expect(issues.length).toBe(0);
  });
});
```

See `../TESTING.md` for comprehensive documentation.
