# ObjectUI Testing

Testing components, plugins, schemas and pages: Vitest + React Testing Library for units, Playwright for end-to-end.

## Unit test patterns

### Pattern 1: Hook testing

```typescript
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBreakpoint } from '../useBreakpoint';

describe('useBreakpoint', () => {
  it('returns breakpoint state', () => {
    const { result } = renderHook(() => useBreakpoint());
    expect(result.current.breakpoint).toBeDefined();
  });

  it('responds to window resize', () => {
    const { result } = renderHook(() => useBreakpoint());
    act(() => {
      Object.defineProperty(window, 'innerWidth', { value: 480, writable: true });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.isMobile).toBe(true);
  });
});
```

### Pattern 2: Component registration testing

```typescript
import { describe, it, expect, beforeAll } from 'vitest';
import { ComponentRegistry } from '@object-ui/core';

describe('plugin-kanban registration', () => {
  beforeAll(async () => {
    await import('../index');
  });

  it('registers kanban component', () => {
    expect(ComponentRegistry.has('kanban')).toBe(true);
  });

  it('has correct metadata', () => {
    const config = ComponentRegistry.getConfig('kanban');
    expect(config?.meta?.label).toBe('Kanban Board');
    expect(config?.meta?.category).toBe('plugin');
    expect(config?.meta?.inputs).toContainEqual(
      expect.objectContaining({ name: 'columns', required: true })
    );
  });
});
```

### Pattern 3: Schema validation testing

<!-- Not opted into the example gate: `vitest` is a test runner the reader installs in their own project, not a package this repository publishes, so there is nothing here to type-check this block against. -->
```typescript
import { describe, it, expect } from 'vitest';
import { validateSchema, isValidSchema, formatValidationErrors } from '@object-ui/core';

describe('schema validation', () => {
  it('accepts minimal valid schema', () => {
    expect(isValidSchema({ type: 'text' })).toBe(true);
  });

  it('rejects schema without type', () => {
    // `validateSchema` takes the schema value as given, so a deliberately
    // invalid one goes in as-is. A type assertion here would add nothing and
    // would hide what this test feeds the validator.
    const result = validateSchema({});
    expect(result.valid).toBe(false);
    expect(formatValidationErrors(result)).toContain('type');
  });

  it('validates nested children', () => {
    const schema = {
      type: 'card',
      children: [
        { type: 'text', content: 'Hello' },
        { type: 'button', label: 'Click' },
      ],
    };
    expect(isValidSchema(schema)).toBe(true);
  });
});
```

### Pattern 4: Expression evaluation testing

<!-- Not opted into the example gate: `vitest` is a test runner the reader installs in their own project, not a package this repository publishes, so there is nothing here to type-check this block against. -->
```typescript
import { describe, it, expect } from 'vitest';
import { ExpressionEvaluator } from '@object-ui/core';

describe('ExpressionEvaluator', () => {
  // The CONTEXT is a constructor argument. `evaluate(expr, options)` and
  // `evaluateExpression(expr, options)` take EvaluationOptions as their second
  // argument — passing the context there is silently ignored, every `${…}`
  // resolves against an empty scope, and the template part falls back to its
  // own literal, so the test fails with the source string as `received`.
  const evaluator = new ExpressionEvaluator({
    data: { name: 'Alice', count: 42, items: [1, 2, 3] },
    user: { role: 'admin' },
  });

  it('evaluates template expressions', () => {
    expect(evaluator.evaluate('Hello ${data.name}')).toBe('Hello Alice');
  });

  it('preserves type for single expressions', () => {
    expect(evaluator.evaluate('${data.count}')).toBe(42);
  });

  it('evaluates boolean conditions', () => {
    expect(evaluator.evaluateExpression('user.role === "admin"')).toBe(true);
  });

  it('handles missing variables safely', () => {
    expect(evaluator.evaluate('${data.missing}')).toBeUndefined();
    expect(evaluator.evaluate('${data.missing || "fallback"}')).toBe('fallback');
  });
});
```

### Pattern 5: Component rendering with SchemaRenderer

Expression roots are the keys of the `scope` a host publishes through `PredicateScopeProvider`. `SchemaRendererProvider`'s
`dataSource` is the CRUD adapter and publishes none — a `hidden` gate on a name nothing published fails soft to `true`, hiding the node for every user ([`guides/auth-permissions.md`](./auth-permissions.md)).

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PredicateScopeProvider, SchemaRenderer } from '@object-ui/react';
import '@object-ui/components';

describe('SchemaRenderer', () => {
  const scope = {
    users: [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ],
    userRole: 'admin',
  };

  it('renders component from schema', () => {
    render(
      <PredicateScopeProvider scope={scope}>
        <SchemaRenderer schema={{ type: 'text', content: 'Hello World' }} />
      </PredicateScopeProvider>
    );
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('hides component when hidden expression is true', () => {
    const secret = { type: 'text', content: 'Secret', hidden: '${userRole !== "admin"}' };
    const { rerender } = render(
      <PredicateScopeProvider scope={scope}>
        <SchemaRenderer schema={secret} />
      </PredicateScopeProvider>
    );
    // admin should see it
    expect(screen.getByText('Secret')).toBeDefined();
    rerender(
      <PredicateScopeProvider scope={{ ...scope, userRole: 'viewer' }}>
        <SchemaRenderer schema={secret} />
      </PredicateScopeProvider>
    );
    // a viewer should not
    expect(screen.queryByText('Secret')).toBeNull();
  });
});
```

### Pattern 6: Auth provider testing

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth, type AuthClient } from '@object-ui/auth';

function AuthConsumer() {
  const { isAuthenticated, user, isLoading } = useAuth();
  if (isLoading) return <div>Loading...</div>;
  if (isAuthenticated) return <div>Hello {user?.name}</div>;
  return <div>Not authenticated</div>;
}

describe('AuthProvider', () => {
  it('shows loading then authenticated state', async () => {
    // Of every method `AuthClient` declares in `packages/auth/src/types.ts`, this path reaches
    // `getSession` on mount and `listOrganizations` once a user is set; an empty list ends the
    // organization load there. Type the literal `Partial<AuthClient>` and each stub against its
    // own member (`AuthClient['getSession']`): the key, the signature and the resolved value are
    // then all checked, and the widening happens ONCE, in a named place. `any` unchecks all three.
    const stub: Partial<AuthClient> = {
      getSession: vi.fn<AuthClient['getSession']>().mockResolvedValue({
        user: { id: '1', email: 'alice@example.com', name: 'Alice' },
        session: { token: 'abc' },
      }),
      listOrganizations: vi.fn<AuthClient['listOrganizations']>().mockResolvedValue([]),
    };

    render(
      <AuthProvider authUrl="/api/v1/auth" client={stub as unknown as AuthClient}>
        <AuthConsumer />
      </AuthProvider>
    );

    expect(screen.getByText('Loading...')).toBeDefined();

    await waitFor(() => {
      expect(screen.getByText('Hello Alice')).toBeDefined();
    });
  });
});
```

### Pattern 7: DataSource adapter testing

<!-- Not opted into the example gate: `vitest` is a test runner the reader installs in their own project, not a package this repository publishes, so there is nothing here to type-check this block against. -->
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObjectStackAdapter } from '@object-ui/data-objectstack';

describe('ObjectStackAdapter', () => {
  let adapter: ObjectStackAdapter;

  beforeEach(() => {
    adapter = new ObjectStackAdapter({
      baseUrl: 'http://localhost:3000',
      // `connect()` reads discovery through THIS injected fetch, not through the
      // client, so stub it or every call fails before it reaches the client.
      fetch: async () => new Response('{}', { status: 200 }),
    });
  });

  it('delegates find to the client', async () => {
    // `getClient()` is the public seam: it hands back the very client the
    // adapter calls, so the double needs no reach into a private field and
    // stays checked against the client's real signature.
    const find = vi
      .spyOn(adapter.getClient().data, 'find')
      .mockResolvedValue({ records: [], total: 0 });

    await adapter.find('contacts', { $filter: { active: true } });

    // The adapter lowers `$filter` into the ObjectQL AST before calling the
    // client, so assert the lowered shape rather than the input.
    expect(find).toHaveBeenCalledWith('contacts', expect.objectContaining({
      filters: ['active', '=', true],
    }));
  });
});
```

## Playwright E2E patterns

### Smoke test

<!-- Not opted into the example gate: `@playwright/test` is a test runner the reader installs in their own project, not a package this repository publishes, so there is nothing here to type-check this block against. -->
```typescript
import { test, expect } from '@playwright/test';

const BASE_URL = 'http://localhost:4173'; // vite preview

test('page loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto(BASE_URL);
  await page.waitForFunction(
    () => (document.getElementById('root')?.children.length ?? 0) > 0,
    { timeout: 30_000 },
  );

  expect(errors).toHaveLength(0);
});
```

### Content verification

```typescript
test('renders main content', async ({ page }) => {
  await page.goto(`${BASE_URL}/console`);
  await page.waitForSelector('[data-testid="app-shell"]');
  
  // Verify navigation renders
  await expect(page.locator('nav')).toBeVisible();
  
  // Verify page title
  await expect(page).toHaveTitle(/ObjectUI/);
});
```

### Bundle validation

```typescript
test('all assets load without 404', async ({ page }) => {
  const failedRequests: string[] = [];
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedRequests.push(`${response.status()} ${response.url()}`);
    }
  });

  await page.goto(BASE_URL);
  await page.waitForLoadState('networkidle');

  expect(failedRequests).toHaveLength(0);
});
```

## Test file naming conventions

| Pattern | Use for |
|---------|---------|
| `*.test.ts` | Pure logic tests (evaluators, validators, adapters) |
| `*.test.tsx` | Component/hook tests needing React rendering |
| `*.spec.ts` | Playwright E2E tests (in `e2e/` directory) |

## Mocking strategies

### MSW for API mocking in integration tests

```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

const server = setupServer(
  http.get('/api/v1/contacts', () => {
    return HttpResponse.json({
      records: [{ id: 1, name: 'Alice' }],
      total: 1,
    });
  }),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### Vitest mocks for unit tests

```typescript
import { vi } from 'vitest';

// Mock a module
vi.mock('@object-ui/core', async () => {
  const actual = await vi.importActual('@object-ui/core');
  return {
    ...actual,
    ComponentRegistry: {
      get: vi.fn().mockReturnValue(MockComponent),
      has: vi.fn().mockReturnValue(true),
    },
  };
});
```

## Common testing mistakes

- Not importing plugin packages in test setup — `ComponentRegistry` is empty, SchemaRenderer produces fallback components.
- Using `jsdom` instead of `happy-dom` for UI tests — slower and more memory-hungry.
- Testing implementation details (internal state) rather than user-visible behavior.
- Forgetting `act()` wrapper when testing hooks that trigger state updates.
- Not awaiting async operations in auth/data tests — assertions run before state settles.
