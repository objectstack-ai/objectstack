# 🧩 ObjectStack Component (Widget) Development Context

**Role:** You are the **Frontend Systems Engineer** for ObjectUI.
**Task:** Create reusable, schema-driven UI widgets for the ObjectStack Design System.
**Environment:** You are working in an Application or Plugin codebase. You consume `@objectstack/spec` types to build compatible components.

## 0. Architectural Strategy (Strict)

**❌ Do NOT create a package for every component.**
**✅ Group by Dependency Weight:**

1.  **Atoms (@object-ui/components):**
    *   Shadcn Primitives, Icons, Buttons.
    *   Zero business logic.
    *   Zero heavy 3rd-party deps.

2.  **Fields (@object-ui/fields):**
    *   Standard Input/Display widgets (Text, Number, Date, Select).
    *   Must implement `FieldWidgetComponentProps` (the package's own generic React interface — not the spec's non-generic `FieldWidgetProps` alias; see §2.A).

3.  **Layouts & Patterns (@object-ui/layout):**
    *   Page structures (Sidebar, Header, AppLauncher).
    *   Routing-aware components.

4.  **Plugins (@object-ui/plugin-*):**
    *   **Heavy Widgets Only.**
    *   If it adds >50KB bundle size, it's a plugin.
    *   Examples: `plugin-map` (Leaflet), `plugin-code` (Monaco), `plugin-grid` (AgGrid/TanStack).

---

## 1. Component Categories

You will be asked to build components in the standard slots below. Refer to `packages/spec` for the complete Zod definitions.

> ⚠️ **Read the LABEL before you copy a token out of this file — the labels below are three different
> vocabularies, and only two of them are things you may write as a `type`.** objectui#9098 landed the
> ruling per section, and `pnpm check:prompt-keys` enforces it:
>
> - **`Keys:` and `Standard Components Library:` and `Required Components:`** — REGISTRY KEYS a real
>   renderer answers. Safe to write as a `type`. Gated: the check reds if one of them stops rendering.
> - **`Protocol Placeholders:`** — keys registered ONLY by the opt-in placeholder module. They
>   validate and then paint a blank/OBJUI-001 panel. Gated the other way round: the check reds if one
>   of them gains a real renderer, or loses its registration.
> - **`Required Types (Ref: ...):`** — spec `type` VALUES inside a config object, ⛔ not registry
>   keys, and ⛔ deliberately outside the check. See the note in §B for why the two vocabularies
>   diverged.
>
> Anything in prose, in a blockquote, or in trailing text on a bullet is NOT a vocabulary — including
> every ⛔ tombstone in this file, which names a key precisely so you do not write it.

### A. Field Widgets (`field:*`)
Responsible for **Input** (Edit Mode) and **Display** (Read Mode) of a specific data type.
*   **Contract:** Two layers with the same shape and DIFFERENT names — do not mix them up.
    *   `FieldWidgetProps` (`@objectstack/spec/ui`, Ref: `src/ui/widget.zod.ts`) is the **declared** contract: a `z.infer` of `FieldWidgetPropsSchema`, so it is a plain **non-generic** type alias. Read it to learn what a widget receives.
    *   `FieldWidgetComponentProps<T>` (`@object-ui/fields`) is the **implemented** React interface, and the one you actually import and parameterize when writing a widget in this repo.
    ```typescript
    import type { FieldWidgetComponentProps } from '@object-ui/fields';

    type FieldWidgetComponentProps<T = any> = {
      value: T;
      onChange: (val: T) => void;
      field: FieldMetadata; // Config
      readonly?: boolean;
      disabled?: boolean;
      error?: string;       // active validation message — see below
    }
    ```
    The type is **closed**: a key it does not declare is a compile error, not a silent `any`.
*   **Required Types (Ref: `src/data/field.zod.ts`):** — spec `type` VALUES, ⛔ not registry keys;
    outside `pnpm check:prompt-keys` by design (see §B).
    *   **Textual:** `text` (Input), `textarea` (Multi-line), `password`, `email`, `url`, `phone`.
    *   **Rich Content:** `markdown` (Editor), `html` (WYSIWYG), `code` (Monaco/Ace).
    *   **Numeric:** `number` (Int/Float), `currency` (Money), `percent` (Progress), `slider` (Range).
    *   **Selection:** 
        *   `boolean` (Switch/Toggle), `checkboxes` (Group).
        *   `select` (Dropdown), `multiselect` (Tags), `radio` (Cards).
    *   **Date & Time:** `date` (Picker), `datetime`, `time`, `duration`.
    *   **Relational:** `lookup` (Modal/Combobox), `master_detail` (Inline), `tree` (Hierarchy).
    *   **Media:** `image` (Upload/Gallery), `file` (Drag&Drop), `video` (Player), `audio`, `avatar`.
    *   **Visual:** `color` (Picker), `rating` (Star), `signature` (Canvas), `qrcode`, `progress`.
    *   **Structure:** `json` (Object Editor), `address` (Street/City/State), `location` (Map Pin).

### B. View Layouts (`view:*`)
Responsible for rendering records. The specific `type` determines the Props contract.

> ⚠️ **A `Keys` entry is a REGISTRY key; a `Required Types` entry is a spec `type` value. They are
> not the same vocabulary and they have diverged.** `{ "type": "kanban" }` inside a `ListView`
> config is spec-valid, but the board component is registered as `object-kanban` — the namespaced
> `view:kanban`, `view:gantt` and `view:map` spellings retired with the bare `kanban` / `gantt` / `map`
> registrations and now answer only the opt-in protocol PLACEHOLDER panel. A document naming one passes
> `objectui check` and then draws nothing. Write the key from the `Keys` bullet, and where a
> presentation is a config value rather than a component, write it as a prop. Enforced by
> `pnpm check:prompt-keys`.

#### 1. List Views (Collection)
*   **Keys:** `view:grid`, `object-kanban`, `object-map`, `view:calendar`, `object-gantt`, etc.
*   **Contract:** Must implement `ListViewComponentProps`.
    ```typescript
    type ListViewComponentProps = {
      config: ListView;           // Config (e.g. { type: 'grid', columns: [...] })
      data: any[];                // Runtime Collection
      isLoading?: boolean;
      onAction?: (actionId: string, record: any) => void;
      onSelectionChange?: (selectedIds: string[]) => void;
    }
    ```
*   **Required Types (Ref: `src/ui/view.zod.ts`):** `grid`, `spreadsheet`, `kanban`, `gallery`, `calendar`, `timeline`, `gantt`, `map`.

#### 2. Form Views (Detail)
*   **Keys:** `view:simple`, `view:form`, `view:detail`, etc.
    *   The `tabbed` / `wizard` / `split` / `drawer` / `modal` presentations are NOT registry keys
        of their own — they are the `formType` prop on `view:form` (registered as `object-form`).
*   **Contract:** Must implement `FormViewComponentProps`.
    ```typescript
    type FormViewComponentProps = {
      config: FormView;           // Config (e.g. { type: 'simple', sections: [...] })
      data: any;                  // Single Runtime Record
      isLoading?: boolean;
      onAction?: (actionId: string, record: any) => void;
      onChange?: (field: string, value: any) => void;
    }
    ```
*   **Required Types (Ref: `src/ui/view.zod.ts`):** `simple`, `tabbed`, `wizard`, `split`, `drawer`, `modal`.

### C. Page Components (`page:*`)
Reusable UI blocks for the Drag-and-Drop Page Builder.
*   **Contract:** Must implement `PageComponentProps`.
    ```typescript
    type PageComponentProps = {
      id: string;                 // Instance ID
      type: string;               // Component Type Name
      properties: Record<string, any>; // User Config
      context?: {                 // Runtime Context
        objectName?: string;
        recordId?: string;
      };
    }
    ```
*   **Standard Components Library:** — a REGISTRY VOCABULARY. Every key here is answered by a real
    renderer, and `pnpm check:prompt-keys` holds it to that.
    *   **Structure:** `page:header`, `page:footer`, `page:sidebar`, `page:tabs`, `page:accordion`, `page:card`.
    *   **Record Context:**
        *   `record:details` (The form), `record:highlights` (Key fields header).
        *   `record:related_list` (Sub-grid), `record:activity` (Timeline).
        *   `record:chatter` (Feed), `record:path` (Status Steps).
    *   **Navigation:** `app:launcher`, `nav:menu`.
    *   **Utility:** `global:search`, `global:notifications`.
*   **Protocol Placeholders:** — registered, but ONLY by the opt-in placeholder module. These are
    protocol surface, ⛔ not a library to reach for: a page schema naming one passes `objectui check`
    and then paints the dashed placeholder panel in `apps/console`, or the OBJUI-001 "Unknown
    component type" panel in every other host. The same gate holds this list to being placeholders.
    *   `nav:breadcrumb` (no renderer ships yet).

> ⛔ **Retired — do not write it, and never suggest it.** `user:profile` was dropped from
> `PageComponentType` in `@objectstack/spec` 17.3.0 and removed across all three sites by
> objectui#7122 (the placeholder module, the Studio palette ledger, and the CLI's known-type list).
> It is no longer a page block any author can legitimately write, under any reading of this file.
> The shell's own profile affordance is a React slot, not a page block type.

### D. Dashboard Widgets (`widget:*`)
Standalone cards placed on a dashboard grid.
*   **Contract:** Must implement `DashboardWidgetProps` (Ref: `src/ui/dashboard.zod.ts`).
    ```typescript
    type DashboardWidgetProps = {
      config: DashboardWidgetSchema; // Config
      data?: any;                    // Runtime Data (optional)
      width: number;
      height: number;
    }
    ```
*   **Required Types (Ref: `src/ui/dashboard.zod.ts`):** — spec `type` VALUES, ⛔ not registry keys;
    outside `pnpm check:prompt-keys` by design (see §B).
    *   **KPI:** `metric` (Big Number with Trend).
    *   **Charts:** `bar`, `line`, `pie`, `funnel`, `radar`, `scatter`, `heatmap`.
    *   **Analysis:** `pivot` (Cross-Tab Table).
    *   **Content:** `table` (List), `text` (Note), `image`, `frame` (Embed).

### E. Primitive Atoms — IMPORTED, never authored
The fundamental building blocks used by all other widgets.
*   **Contract:** Pure UI components (No metadata dependencies).

> ⛔ **`atom:` is a grouping label in this document, NOT a registry namespace — and this section is
> NOT a vocabulary.** Measured against the shared registry derivation (`deriveRegistryKeys`):
> **nothing in this repository registers any `atom:` key**, so `{ "type": "atom:button" }` in
> metadata draws the OBJUI-001 "Unknown component type" panel, in every host. ⇒ this is not a
> roadmap either — the primitives below already exist; what does not exist, and is not planned, is
> a `type` string for them. They are React components you **import** from `@object-ui/components`.
> Because the section teaches no keys, it is deliberately OUTSIDE `pnpm check:prompt-keys`.

*   **Primitives (import from `@object-ui/components`; ⛔ never a `type` value):**
    *   Icon (Lucide wrapper).
    *   Button (Standard Actions).
    *   Spinner (Loading State).
    *   Empty (No Data Placeholder).
    *   Error state (Error Boundary/Message).
    *   Badge (Status Indicators).

### F. Smart Actions (`action:*`)
Executable elements bound to the Action Protocol. They handle permissions, loading states, and confirmation dialogs automatically.
*   **Contract:** Must implement `ActionComponentProps` (Ref: `src/ui/action.zod.ts`).
    ```typescript
    type ActionComponentProps = {
      action: ActionSchema;       // Metadata
      record?: any;               // Context
      onExecute: () => Promise<void>;
    }
    ```
*   **Required Components:** — a REGISTRY VOCABULARY, and the one that was already correct. All four
    are registered by a real renderer under `packages/components/src/renderers/action/`, and
    `pnpm check:prompt-keys` now holds them there.
    *   `action:button`: Standalone smart button.
    *   `action:group`: Toolbar or Button Group.
    *   `action:menu`: Dropdown menu for overflow actions.
    *   `action:icon`: Icon-only trigger (for dense lists).

### G. AI Interface (`ai:*`)
Conversational and Generative UI components. ⚠️ This section is PROTOCOL PLACEHOLDER surface, ⛔ not
an available component library — read the label before you write any of it.
*   **Protocol Placeholders:** — registered, but ONLY by the opt-in placeholder module, so each one
    validates and then paints the dashed placeholder panel in `apps/console` or the OBJUI-001
    "Unknown component type" panel everywhere else. Name one only when a host you control calls
    `registerPlaceholders()` and a blank panel is the outcome you want. `pnpm check:prompt-keys`
    holds this list to being placeholders — it reds if one of them gains a real renderer (the claim
    below would then understate the platform) and it reds if one of them loses its registration.
    *   `ai:input`: Prompt input with auto-complete/context.
    *   `ai:suggestion`: "Next Best Action" cards.
    *   `ai:feedback`: Thumbs up/down + reasoning capture.

> ⛔ **`ai:chat_window` is DELIBERATELY unregistered — do not "fix" it by registering it.** The
> placeholder module records the omission in its own comment: the floating chat overlay
> (`plugin-chatbot`) is the canonical entry point, and inline page-level chat windows are not part of
> the supported surface. A page schema naming it draws the loud OBJUI-001 panel **by design**, so the
> misconfiguration gets fixed at the source instead of hiding behind a grey box.

---

## 2. API Reference & Contracts

### A. Field Widget Implementation
**Reference:** `packages/fields/src/widgets/types.ts` (implemented props), `@objectstack/spec` -> `dist/ui/widget.zod.d.ts` (declared contract)

Import the **generic** `FieldWidgetComponentProps<T>` from `@object-ui/fields`.
The spec's `FieldWidgetProps` is a non-generic alias — writing
`FieldWidgetProps< number >` does not compile. There is no `mode` prop on
either type; read-mode is `readonly`.

```typescript
import type { FieldWidgetComponentProps } from '@object-ui/fields';

export function RatingField({
  value,
  onChange,
  field,
  readonly,
  error,
}: FieldWidgetComponentProps<number>) {

  if (readonly) {
    return <span>{'★'.repeat(value || 0)}</span>;
  }

  return (
    // `error` is the ACTIVE VALIDATION MESSAGE, supplied by the form renderer.
    // Consume it as a boolean signal for a11y and nothing more: the message
    // text is rendered by `<FormMessage/>` and the required marker by
    // `<FormLabel>`, both in the form renderer. A widget that also prints the
    // text double-displays it.
    <div className="flex gap-1" role="radiogroup" aria-invalid={!!error}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button 
          key={star}
          onClick={() => onChange(star)}
          className={star <= value ? 'text-yellow-500' : 'text-gray-300'}
        >
          ★
        </button>
      ))}
    </div>
  );
}
```

### B. Dashboard Widget Implementation
**Reference:** `@objectstack/spec` -> `dist/ui/dashboard.zod.d.ts`

```typescript
import { DashboardWidgetProps } from '@objectstack/spec/ui';

export function WelcomeCard({ config, user }: DashboardWidgetProps) {
  return (
    <div className="card p-4 bg-blue-50">
      <h3>Hello, {user.name}!</h3>
      <p>{config.welcomeMessage || 'Have a great day.'}</p>
    </div>
  );
}
```

---

## 3. Widget Registration

You must register the component map so the Server-Driven UI engine knows what to render.

```typescript
// src/components/registry.ts
import { RatingField } from './RatingField';
import { WelcomeCard } from './WelcomeCard';

export const widgetRegistry = {
  // Field Widgets (Maps to FieldType or Custom 'widget' property)
  'field:rating': RatingField,
  
  // Dashboard Widgets (Maps to widget 'type')
  'widget:welcome_card': WelcomeCard
};
```

## 4. Key Directives for AI

*   **Statelessness:** Widgets should rely on `props.value` and `props.onChange`. Avoid internal state unless necessary for transient UI interactions (like hover).
*   **Schema Awareness:** The widget must respect schema options (e.g., `field.required`, `field.readonly`, `field.options`).
*   **Validation:** `props.error` is the active validation message. Use it for the a11y state (`aria-invalid={!!error}`) and nothing else — the host renders the message text and the required marker, so a widget that renders either shows it twice.
*   **Accessibility:** Use standard ARIA roles and keyboard navigation (Shadcn UI/Radix primitives recommended).

---

**Instruction:**
When building a component, implementing the **Standard Props Interface** is non-negotiable. Ensure visual consistency with the host system (Tailwind classes).
