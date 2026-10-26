# Styling Rules

> **Critical:** ObjectUI uses Tailwind CSS exclusively. No inline styles, CSS modules, or styled-components.
> The single carve-out — *author-declared, data-driven* colour published as CSS custom
> properties — is stated in full under **Rule: Author-Declared, Data-Driven Colour**.

## Rule: Use Tailwind Utility Classes Only

**✅ CORRECT:**
<!-- os:check -->
```json
{
  "type": "card",
  "className": "col-span-12 lg:col-span-4 p-6"
}
```

**❌ FORBIDDEN:**
```typescript
// Never do this in ObjectUI
<Card style={{ padding: '24px', color: 'red' }} />
```

Both halves are wrong, for different reasons: `padding` has a utility, and `color: 'red'`
is a colour the *component* chose. A colour the *author* declared is the one case inline
`style` is permitted, and only in one shape — see **Rule: Author-Declared, Data-Driven
Colour**.

## Rule: Use `cn()` for Class Merging

When combining classes programmatically, always use the `cn()` utility:

```typescript
import { cn } from '@object-ui/components';

function MyComponent({ className, ...props }) {
  return (
    <div className={cn('rounded-lg border p-4', className)}>
      {/* content */}
    </div>
  );
}
```

**Why:** `cn()` uses `tailwind-merge` + `clsx` to properly handle class conflicts (e.g., `p-4` vs `p-6`).

## Rule: Use Semantic Color Tokens

**✅ CORRECT:**
```typescript
className="bg-primary text-primary-foreground"
className="bg-secondary text-secondary-foreground"
className="bg-muted text-muted-foreground"
className="bg-destructive text-destructive-foreground"
className="border-border"
```

**❌ FORBIDDEN:**
```typescript
className="bg-blue-500 text-white"  // ❌ Hard-coded color
className="bg-[#3b82f6]"             // ❌ Arbitrary value — a colour literal
```

**Why:** Semantic tokens support theming and dark mode automatically.

What is banned is the colour **literal**, not the arbitrary-value syntax itself:
`bg-[color:var(--os-badge-bg)]` carries a custom property rather than a colour, and is the
sanctioned carrier for author-declared colour — see the next rule.

## Rule: Author-Declared, Data-Driven Colour (the one carve-out)

The rules above ban **component-authored** colour. They do not ban rendering a colour the
*author* declared — an `options[].color` on a select field, a Gantt task's `color`, a
conditional-formatting rule's `backgroundColor`. Those values exist only at runtime, so no
class string can carry them, and quietly discarding or quantizing them is a bug in its own
right.

The permitted shape is narrow: publish the declared colour as **CSS custom properties** on
the element, and let **static** Tailwind utilities consume them.

**✅ CORRECT:**
```typescript
// The utility string is a literal, so Tailwind emits these classes at build time —
// and `dark:` stays a real variant that the theme still controls.
const HEX_BADGE_CLASSES =
  'bg-[color:var(--os-badge-bg)] text-[color:var(--os-badge-fg)] ' +
  'dark:bg-[color:var(--os-badge-bg-dark)] dark:text-[color:var(--os-badge-fg-dark)]';

<span
  className={HEX_BADGE_CLASSES}
  style={{
    '--os-badge-bg': surface,
    '--os-badge-fg': label,
    '--os-badge-bg-dark': surfaceDark,
    '--os-badge-fg-dark': labelDark,
  } as React.CSSProperties}
/>
```

**❌ FORBIDDEN — the same author value, painted straight in:**
```typescript
<span style={{ backgroundColor: option.color }} />  // ❌ dark mode renders identically
```

**Still banned, unchanged:**

- colour the **component** chose, in any form — that is what semantic tokens are for;
- colour **literals** in class strings (`bg-blue-500`, `bg-[#3b82f6]`);
- **any** inline style that hard-codes a colour such that dark mode renders identically.
  That last one is the property that actually decides a case — not whether the word
  `style` appears in the diff.

**Why:** semantic tokens exist so that theming and dark mode work automatically. A pattern
that preserves that property satisfies the rule; a pattern that defeats it does not.
Routing an author's value through custom properties keeps both themes under the design
system's control — the component supplies *values*, the stylesheet still supplies the
*rules*, and a theme can still restyle or override them. Writing the value into
`backgroundColor` hands the component the rules as well, and dark mode is the first thing
that is lost.

Read that rationale as the test. It decides cases this page does not list: a new widget
that paints an author's colour, a token added to the palette, a helper that returns a
style object. If the design system keeps theme control, the pattern is in; if the rendered
colour is the same byte in both themes, it is out.

Scope: **colour only**, and only where the value is an author's declaration. This is not a
general licence for `style={{}}` — layout, spacing and sizing stay on utilities, and a
runtime *geometry* value (a computed bar offset, a virtualiser's row height) is a separate
question this carve-out does not answer.

**Worked reference:** `getBadgeHexAppearance` / `getDotHexAppearance` in
`packages/fields/src/index.tsx` — the derived surface, label and border
are published as custom properties and consumed by the static utility pair above.

## Rule: Use Component Variants (CVA)

For component variations, use `class-variance-authority`:

<!-- os:check -->
```typescript
import { cva } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center rounded-md', // base
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground',
        destructive: 'bg-destructive text-destructive-foreground',
        outline: 'border border-input bg-background',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-8',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);
```

## Rule: Expose `className` on the Schema Node

**Every component must accept `className` on its schema node** to allow JSON-level style overrides. Like every other key, it is read off the node itself — not out of a `props` envelope, which the renderers never read:

<!-- os:check -->
```jsonc
{
  "type": "card",
  "className": "bg-red-500",  // ✅ User can override styles
  "title": "Alert"
}
```

## Rule: Responsive Classes

Use Tailwind's responsive prefixes in schemas:

<!-- os:check -->
```json
{
  "type": "grid",
  "className": "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
}
```

## Rule: Dark Mode with Semantic Tokens

**❌ DO NOT** manually add `dark:` variants:

```typescript
// ❌ Wrong
className="bg-white dark:bg-gray-900"
```

**✅ CORRECT:**
```typescript
// ✅ Semantic tokens handle dark mode automatically
className="bg-background text-foreground"
```

The one exception is the custom-property carrier for author-declared colour, where an
explicit `dark:` variant is what *keeps* dark mode real rather than bypassing it — see
**Rule: Author-Declared, Data-Driven Colour**. Hand-picking a `dark:` colour the component
chose is still wrong.

## Rule: No Manual Z-Index

**❌ DO NOT** manually set `z-index` on overlay components:

```typescript
// ❌ Wrong
<Dialog className="z-[9999]" />
```

**✅ CORRECT:**
```typescript
// ✅ Dialog, Sheet, Popover, etc. handle their own stacking context
<Dialog />
```

## Rule: Spacing with `gap-*` not `space-*`

**✅ CORRECT:**
```typescript
className="flex flex-col gap-4"
className="grid grid-cols-3 gap-6"
```

**❌ FORBIDDEN:**
```typescript
className="space-y-4"  // ❌ Deprecated
className="space-x-6"  // ❌ Use gap instead
```

## Rule: Use `size-*` for Equal Dimensions

**✅ CORRECT:**
```typescript
className="size-10"  // width and height both 40px
```

**❌ FORBIDDEN:**
```typescript
className="w-10 h-10"  // ❌ Redundant
```

## Rule: Use `truncate` Shorthand

**✅ CORRECT:**
```typescript
className="truncate"
```

**❌ FORBIDDEN:**
```typescript
className="overflow-hidden text-ellipsis whitespace-nowrap"
```

## Rule: Tailwind 4 CSS Variables Setup

For ObjectUI components to render correctly, a third-party project imports the
stylesheets the packages **publish**. There is no `tailwind.config.js` step: ObjectUI is
Tailwind 4, configured in CSS.

**✅ CORRECT:**
```css
/* src/index.css */
@import "tailwindcss";
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
```

Each `style.css` is a real package export, mapped to that package's `dist/index.css` and
compiled at build time from the package's own sources.

`@object-ui/components/style.css` is the base of the pair. It carries every utility its
components use **and** the `@theme` block those utilities are built on, so the whole
Shadcn palette (`bg-background`, `bg-primary`, `border-input`, `ring-ring`) plus the
`:root` / `.dark` token defaults arrive with that one import. You do **not** restate
those tokens in a `@theme` block of your own.

The order is load-bearing. `@object-ui/fields/style.css` is a supplement: it is compiled
against the components theme and then has every rule that sheet already ships subtracted
from it, so it holds only what the field widgets add — the tag colour map, the signature
canvas cursor, and 17 themed utilities such as `hover:bg-accent/30` that no consumer-side
configuration can generate. Import it first, or alone, and those rules resolve against
tokens that are not there yet. `@object-ui/fields` is a separate dependency, not a
transitive one — install it, or leave that second line out.

**❌ FORBIDDEN — pointing Tailwind at the installed packages:**

Do not scan the ObjectUI packages inside `node_modules`, with neither a v4 `@source` line
nor a v3 `content` entry. It regenerates the shape-only utilities (`inline-flex`,
`rounded-md`, `h-9`) the two sheets already contain, and it cannot produce the themed ones
at all: the `@theme` block they come from lives in package source, which is not published
(the tarballs carry `dist` only). Your own Tailwind entry goes on generating the classes
*your* source uses, exactly as before.

Inside the ObjectUI workspace the picture is different, and `@source` is right there: the
packages are linked to their sources, so an app scans `packages/*/src` and declares the
theme itself. `apps/console/src/index.css` is the maintained reference for that case.

To recolour, override the token **values** rather than the utilities. They are Shadcn HSL
channel triples, not finished colours:

```css
:root {
  --primary: 222.2 47.4% 11.2%;
  --primary-foreground: 210 40% 98%;
}
```

See `content/docs/guide/theming.md` for the full token list and the `ThemeProvider` route.

**Without these imports, ObjectUI components will render but look completely unstyled.**
