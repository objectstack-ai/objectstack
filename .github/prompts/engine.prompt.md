# ⚙️ ObjectStack Runtime Engine Development Context

**Role:** You are the **Core Framework Engineer** for ObjectStack.
**Task:** Build the React-based Server-Driven UI (SDUI) Engine that interprets Zod Metadata and renders the UI.
**Environment:** A frontend application (e.g., Next.js, Vite) consuming the `@objectstack/spec` package.

---

## 1. The Trinity of Engines

A complete ObjectUI Runtime consists of three coordinating engines. Each engine consumes specific types from `@objectstack/spec`.

### A. Layout Engine (`<PageRenderer />`)
Responsible for recursive rendering of the UI tree.
*   **Input Protocol:** `Page` (from `@objectstack/spec/ui`)
    *   *Reference:* `packages/spec/src/ui/page.zod.ts`
*   **Block Protocol:** `PageComponent` (from `@objectstack/spec/ui`)
    *   *Reference:* `packages/spec/src/ui/block.zod.ts`
*   **Logic:**
    1.  Recursively traverse `Page.regions` and `Region.components`.
    2.  Map `component.type` (e.g., `page:tabs`) to the React Component via `widgetRegistry`.
    3.  Pass `component.properties` as Props (Typed as `ComponentProps` from `@objectstack/spec/ui`).
    4.  Inject `context` (Record ID, User Info) into the component tree.
*   **Key Hook:** `useComponentResolver(type)`

### B. Data Engine (`useObjectData()`)
Responsible for data fetching, caching, and state management.
*   **Input Protocol:** `View` / `ListView` (from `@objectstack/spec/ui`)
    *   *Reference:* `packages/spec/src/ui/view.zod.ts`
*   **Filter Protocol:** `FilterCondition` (from `@objectstack/spec/data`)
    *   *Reference:* `packages/spec/src/data/filter.zod.ts`
*   **Library:** React Query (TanStack Query) + SWR.
*   **Logic:**
    1.  Convert `View.filters` and `View.sort` into ObjectQL Query.
    2.  Handle `isLoading`, `error`, `data` states.
    3.  Provide `refresh()` and `mutations` (Create/Update/Delete).
*   **Key Hook:** `useRecord(object, id)`, `useList(object, view)`

### C. Action Engine (`useAction()`)
Responsible for executing business logic and side effects.
*   **Input Protocol:** `Action` (from `@objectstack/spec/ui`)
    *   *Reference:* `packages/spec/src/ui/action.zod.ts`
*   **Logic:**
    1.  **Pre-check:** Evaluate `disabled` state and permissions.
    2.  **Confirmation:** Show Modal if `confirmText` is present.
    3.  **Execution:** Call API / Run Script / Navigate URL.
    4.  **Feedback:** Show Toast (Success/Error) and trigger `DataEngine.refresh()`.

---

## 2. Standard Contexts

Your engine must provide these React Contexts to all widgets:

### `ObjectContext`
*   **Definition:** `@objectstack/spec/data` -> `ObjectSchema`
*   Current `objectName` (e.g., "project_task")
*   Field definitions (Schema)

### `RecordContext`
*   Current `recordId`
*   Live record data (e.g., `{ id: "123", name: "Fix Bug" }`)
*   Permissions (`allowEdit`, `allowDelete`)

### `UIContext`
*   **Definition:** `@objectstack/spec/ui` -> `ThemeSchema`
*   Device State (`isMobile`)
*   Theme Config (`mode: 'dark' | 'light'`)
*   Navigation Helpers (`openModal`, `navigate`)

---

## 3. Implementation Patterns

### The Resolver Pattern (for PageRenderer)
```typescript
import { Page, PageComponent } from '@objectstack/spec/ui';

function PageRenderer({ schema }: { schema: Page }) {
  return (
    <div className="page-layout">
      {schema.regions.map(region => (
        <div key={region.name} className={`region-${region.width}`}>
          {region.components.map((block: PageComponent) => (
            <ComponentBlock key={block.id} config={block} />
          ))}
        </div>
      ))}
    </div>
  );
}
```

### The HoC Pattern (for Widget Enrichment)
Wrap every widget in a Higher-Order Component to handle common logic:
```typescript
import { PageComponent } from '@objectstack/spec/ui';

function withEngine(Widget: React.ComponentType) {
  return (props: { config: PageComponent }) => {
    // 1. Auto-handle Visibility (Expressions like: "record.status == 'closed'")
    if (!evalVisibility(props.config.visibility)) return null;

    // 2. Error Boundary per functionality block
    return (
      <ErrorBoundary fallback={({error}) => <AtomError message={error.message} />}>
         <Suspense fallback={<AtomSpinner />}>
            <Widget {...props} />
         </Suspense>
      </ErrorBoundary>
    );
  };
}
```

---

## 4. Advanced Scenarios & Solutions

### A. Dynamic Registry (Lazy Loading)
Don't bundle entire component libraries. Use `React.lazy` mapping.
```typescript
// registry.ts
export const widgetRegistry = {
  'page:tabs': lazy(() => import('@objectstack/components/structure/PageTabs')),
  'record:details': lazy(() => import('@objectstack/components/record/RecordDetails')),
  // ... extended by plugins
};
```

### B. Inter-Component Communication (Event Bus)
Start Scenario: A "Save" button in `page:header` needs to submit a form in `record:details`.
*   **Solution:** Use a scoped `EventBus` provided by `PageContext`.
*   **Protocol:** `bus.emit('record:save')` -> `RecordDetails` listens and submits.

### C. Form State (React Hook Form + Zod)
Scenario: Validating fields based on metadata rules (`maxLength`, `min`, `regex`).
*   **Solution:** Automatically generate Zod Validation Schema from `field.zod.ts` definitions at runtime.
*   **Pattern:** `useZodForm(objectSchema)` hook that bridges Metadata -> React Hook Form.

### D. Field-Level Security (FLS)
Scenario: User sees the record but lacks permission to view 'Salary' field.
*   **Solution:** `DataEngine` must filter restricted fields *before* they reach the UI component, or `RecordDetails` component must check `perm.canRead(field)` for each user.

### E. Theme Injection
Scenario: App branding (`branding.primaryColor`) must apply to all Buttons.
*   **Solution:** Convert `App.branding` values into CSS Variables (`--os-primary: #ff0000`) injected at the root `<LayoutProvider>`. All atom-level primitives (the `Button` component imported from `@object-ui/components`) consume these variables.
    *   ⛔ `atom:` is a grouping label, NOT a registry namespace: nothing registers an `atom:` key, so it is never a `type` an author writes. See §E of `component.prompt.md` (objectui#9098).

---

## 5. The Expression Engine

The engine must support "Metadata Expressions" to allow logic without compilation.

### A. Syntax
Use generic string interpolation `{ !... }` or specific prefixes.
*   **Binding:** `"{!record.amount}"` (Values)
*   **Logic:** `"{!record.status} == 'closed'"` (Boolean)
*   **Global:** `"{!user.name}"`, `"{!today}"`

### B. Implementation (Safe Eval)
Use a specialized parser (like `filtrex` or `jsep`) instead of `eval()`.
```typescript
// utils/eval.ts
export function evalExpression(expr: string, context: any): any {
  if (!expr.startsWith('{!') || !expr.endsWith('}')) return expr; // Literal
  const logic = expr.slice(2, -1);
  return safeEvaluate(logic, context); // context = { record, user, global }
}
```

### C. Reactive Binding
Expressions must re-evaluate when `context` changes.
*   **Hook:** `useExpression(expressionString, dependencyArray)`

---

## 6. Slot & Component Injection

Layouts often nest components. The engine must map `PageComponent.children` (Array) to React `props.children`.

### A. The "Slot" Prop
Standard blocks (like `page:card` or `page:tabs`) accept a `children` prop in strict React, but in metadata, they are just nested IDs.

### B. Recursive Rendering Logic
The `PageRenderer` must handle the recursion, not the component.
```typescript
// Correct Pattern
const CardBlock = ({ config, children }) => (
  <div className="card">
    <div className="card-body">
      {/* The engine has already converted config.children into React Elements */}
      {children}
    </div>
  </div>
);
```

### C. Named Slots (Advanced)
Some components have multiple areas (e.g., `header`, `footer`).
*   **Metadata:** `regions: [{ name: "header", components: [...] }, { name: "footer", components: [...] }]`
*   **React:** `<PageHeader actions={<RegionRenderer region="header" />} />`

---

## 7. Dirty State Management

Protocol for handling unsaved changes across independent widgets.

### A. Distributed State
Each form widget manages its own state (e.g., `react-hook-form`).

### B. The "Dirty" Registry
A context where widgets register their dirty status.
```typescript
// DirtyContext.tsx
const registerDirty = (id: string, isDirty: boolean) => { ... }

// Usage in Widget
useEffect(() => {
  registerDirty(props.id, formState.isDirty);
}, [formState.isDirty]);
```

### C. Navigation Guard
Listen to `beforeunload` and Router events. If `dirtyRegistry` has any `true` values, block navigation.

