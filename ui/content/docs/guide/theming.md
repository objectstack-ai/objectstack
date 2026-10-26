---
title: "Theming & Customization"
description: "Customize the look-and-feel of ObjectUI components with CSS custom properties, Tailwind CSS, cva variants, and runtime theme switching"
---

# Theming & Customization

ObjectUI's theming system is built on three layers: **CSS custom properties** (design tokens), **Tailwind CSS** (utility classes), and **class-variance-authority** (component variants). Together they give you full control over appearance — from global palettes down to individual component states.

## How Theming Works

```
Theme JSON  →  ThemeProvider  →  CSS Custom Properties  →  Tailwind utilities  →  Components
```

1. You define a **Theme** object (colors, fonts, radii, spacing).
2. `ThemeProvider` from `@object-ui/react` resolves inheritance and converts the theme to CSS custom properties injected on `document.documentElement`.
3. Tailwind classes reference those properties (e.g. `bg-primary` maps to `hsl(var(--primary))`).
4. Components use `cva()` for variant logic and `cn()` for class merging.

## CSS Custom Properties

ObjectUI follows the Shadcn convention. Design tokens are defined as HSL channel values on `:root` and `.dark`:

```css
/* globals.css */
@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 222.2 84% 4.9%;
    --primary: 222.2 47.4% 11.2%;
    --primary-foreground: 210 40% 98%;
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    --border: 214.3 31.8% 91.4%;
    --ring: 222.2 84% 4.9%;
    --radius: 0.5rem;
  }

  .dark {
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    --primary: 210 40% 98%;
    --primary-foreground: 222.2 47.4% 11.2%;
    /* ... remaining dark tokens */
  }
}
```

Components reference these tokens through Tailwind:

<!-- doc-snippet: fragment — two sibling elements shown without a parent: the fence deliberately holds two JSX roots because the point is the Tailwind class names, not a renderable tree -->
```tsx
<div className="bg-background text-foreground border-border" />
<button className="bg-primary text-primary-foreground" />
```

## Tailwind Setup

There is no `tailwind.config.js` step. ObjectUI is Tailwind 4, which is configured in CSS: the packages have no such file of their own, and consuming them does not need one on your side either.

Import the published stylesheets after your own Tailwind entry:

```css
/* src/index.css */
@import "tailwindcss";
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
```

Each `style.css` is a real export, mapped to that package's `dist/index.css` and compiled at build time from the package's own sources.

`@object-ui/components/style.css` is the base of the pair. It carries every utility its components use **and** the `@theme` block those utilities are built on, so the whole Shadcn palette (`bg-background`, `bg-primary`, `border-input`, `ring-ring`) arrives with that one import. You do not restate those tokens in a config of your own.

`@object-ui/fields/style.css` is a supplement, and the order matters: it is compiled against the components theme and then has every rule that sheet already ships subtracted from it, so it contains only the utilities the field widgets add — the tag colour map, the signature canvas cursor, the rating hover states, and 17 themed utilities such as `hover:bg-accent/30` and `ring-destructive/50` that no consumer-side configuration can generate, because the tokens they resolve live in unpublished package source. Import it before the components sheet, or alone, and those rules resolve against tokens that are not there yet.

`@object-ui/plugin-grid/style.css` and `@object-ui/plugin-kanban/style.css` are the same shape again, one per plugin you install:

```css
@import "@object-ui/plugin-grid/style.css";
@import "@object-ui/plugin-kanban/style.css";
```

Each is compiled against the components theme and then has that sheet's rules subtracted, which is why they are ~16 kB and ~11 kB rather than another 170 each. Between them they carry the 25 themed utilities the two plugins use and neither base sheet contains — `bg-muted/10`, `bg-card/60`, `ring-primary/40` and friends — which nothing on your side can generate ([#4929](https://github.com/objectstack-ai/objectui/issues/4929)). No other `@object-ui/plugin-*` package publishes a stylesheet yet.

Do **not** point Tailwind at the packages inside `node_modules` — neither with a v4 `@source` line nor a v3 `content` entry. Scanning the published files regenerates the shape-only utilities (`inline-flex`, `rounded-md`, `h-9`) the two sheets already contain, and it cannot produce the themed ones at all: the `@theme` block they come from lives in package source, which is not published. Your Tailwind entry goes on generating the classes *your* source uses, exactly as before.

To recolour ObjectUI, override the token values rather than the utilities — either the `:root` custom properties shown above, or a `Theme` object handed to `ThemeProvider` (see below). Both re-theme every component without any scanning.

## Component Variants with `cva`

ObjectUI uses [class-variance-authority](https://cva.style) to define type-safe component variants. Each component exports a `*Variants` function alongside the component itself:

<!-- doc-snippet: fragment — quotes the published Badge source: it imports class-variance-authority, which the reader installs in their own app but which is not a dependency of this repository's root, so the specifier does not resolve here -->
```tsx
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@object-ui/components";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
```

To add a custom variant to an existing component, wrap it:

<!-- doc-snippet: fragment — continues the block above — cva, Badge and cn are already imported there; this block shows only the wrapper -->
```tsx
const statusVariants = cva("", {
  variants: {
    status: {
      active: "bg-green-500/15 text-green-700 border-green-500/25",
      pending: "bg-yellow-500/15 text-yellow-700 border-yellow-500/25",
      inactive: "bg-gray-500/15 text-gray-500 border-gray-500/25",
    },
  },
});

function StatusBadge({ status, className, ...props }: { status: "active" | "pending" | "inactive" } & React.HTMLAttributes<HTMLDivElement>) {
  return <Badge className={cn(statusVariants({ status }), className)} variant="outline" {...props} />;
}
```

## Class Overrides with `cn()`

The `cn()` utility from `@object-ui/components` combines `clsx` and `tailwind-merge` so that later classes win over earlier ones without producing duplicate utilities:

<!-- doc-snippet: fragment — usage excerpt for cn(): isActive and className are the reader's own values, shown bare so the merge behaviour is the only thing on screen -->
```tsx
import { cn } from "@object-ui/components";

// tailwind-merge resolves conflicts: "p-4" wins over "p-2"
cn("p-2 bg-red-500", "p-4");
// → "bg-red-500 p-4"

// Conditional classes with clsx syntax
cn("base-class", isActive && "bg-primary", className);
```

Every ObjectUI component accepts a `className` prop that is merged via `cn()`, so consumers can always override styles:

<!-- doc-snippet: fragment — prop excerpt: a single Button usage, shown to demonstrate that className is merged; Button comes from the reader's own import of @object-ui/components -->
```tsx
<Button className="rounded-full px-8" variant="outline">
  Custom Shape
</Button>
```

## Dark Mode

ObjectUI supports three modes: `light`, `dark`, and `auto` (follows system preference). The `ThemeProvider` applies a `light` or `dark` class to the root element and listens for `prefers-color-scheme` changes.

<!-- doc-snippet: fragment — MyApp is the reader's own root component — the block shows where ThemeProvider goes, not what it wraps -->
```tsx
import { ThemeProvider } from "@object-ui/react";

function App() {
  return (
    <ThemeProvider defaultMode="auto">
      <MyApp />
    </ThemeProvider>
  );
}
```

Toggle mode at runtime with the `useTheme` hook:

```tsx
import { useTheme } from "@object-ui/react";

function ModeToggle() {
  const { resolvedMode, setMode } = useTheme();

  return (
    <button onClick={() => setMode(resolvedMode === "dark" ? "light" : "dark")}>
      {resolvedMode === "dark" ? "☀️ Light" : "🌙 Dark"}
    </button>
  );
}
```

There is no `darkMode` option to set on your side. ObjectUI declares the class-based dark variant in its own CSS — `@custom-variant dark (&:where(.dark, .dark *))` — so `.dark`-scoped utilities are already compiled into the stylesheet you import. What you do need is for the `dark` class to sit on an ancestor of your components; `ThemeProvider` puts it on `document.documentElement` for you.

## Custom Component Themes

Register one or more theme definitions with `ThemeProvider`. Each theme is a plain JSON object:

<!-- doc-snippet: fragment — App is the reader's own root component; the trailing ThemeProvider usage is shown in place so the theme object and its consumer read as one unit -->
```tsx
import type { Theme } from "@object-ui/types";

const corporateTheme: Theme = {
  name: "corporate",
  label: "Corporate",
  // `colors` keys are ColorPalette keys, NOT Shadcn variable names. The engine
  // maps them: text → --foreground, surface → --card, error → --destructive,
  // textSecondary → --muted-foreground. A key that is not on ColorPalette is
  // dropped, so the *-foreground pairs go through `customVars` below.
  colors: {
    primary: "220 70% 50%",
    background: "0 0% 100%",
    text: "220 20% 10%",
    accent: "200 80% 55%",
  },
  // Emitted verbatim as `--<key>: <value>` — the declared door for any custom
  // property that has no ColorPalette key.
  customVars: {
    "primary-foreground": "0 0% 100%",
    "accent-foreground": "0 0% 100%",
  },
  typography: {
    fontFamily: { base: "IBM Plex Sans, system-ui" },
  },
  borderRadius: { base: "0.375rem" },
};

<ThemeProvider themes={[corporateTheme]} defaultTheme="corporate">
  <App />
</ThemeProvider>
```

Themes support **inheritance** via the `extends` field. A child theme only needs to declare its overrides:

<!-- doc-snippet: fragment — continues the block above — corporateTheme is declared there; App is the reader's own root component -->
```tsx
const darkCorporate: Theme = {
  name: "corporate-dark",
  label: "Corporate Dark",
  extends: "corporate",
  colors: {
    primary: "220 70% 50%",
    background: "220 20% 8%",
    text: "0 0% 95%",
  },
};

<ThemeProvider themes={[corporateTheme, darkCorporate]} defaultTheme="corporate-dark">
  <App />
</ThemeProvider>
```

## Creating a Custom Color Palette

Start from HSL values and define both light and dark variants:

```tsx
import type { Theme } from "@object-ui/types";

export const brand: Theme = {
  name: "brand",
  label: "Brand",
  colors: {
    // Every key here is a ColorPalette key; the comment is the CSS variable
    // the engine emits it as.
    primary: "262 83% 58%",         // --primary          (Purple)
    secondary: "262 30% 94%",       // --secondary
    accent: "160 84% 39%",          // --accent           (Teal accent)
    background: "0 0% 100%",        // --background
    surface: "0 0% 100%",           // --card
    text: "262 20% 10%",            // --foreground
    textSecondary: "262 10% 45%",   // --muted-foreground
    disabled: "262 20% 95%",        // --muted
    border: "262 20% 90%",          // --border
    error: "0 84% 60%",             // --destructive
  },
  // Shadcn pairs the palette with foreground/ring variables that have no
  // ColorPalette key of their own. Author those here — they are emitted
  // verbatim as `--<key>: <value>`.
  customVars: {
    "primary-foreground": "0 0% 100%",
    "secondary-foreground": "262 83% 30%",
    "accent-foreground": "0 0% 100%",
    "destructive-foreground": "0 0% 100%",
    ring: "262 83% 58%",
  },
  borderRadius: { base: "0.5rem" },  // --radius
};
```

> **Tip:** Use the [Shadcn Themes tool](https://ui.shadcn.com/themes) to generate a full palette, then paste the HSL values into your Theme object.

## Runtime Theme Switching

`ThemeProvider` accepts multiple themes. Switch between them at runtime with `setTheme`:

```tsx
import { useTheme } from "@object-ui/react";

function ThemeSwitcher() {
  const { activeTheme, themes, setTheme } = useTheme();

  return (
    <select value={activeTheme ?? ""} onChange={(e) => setTheme(e.target.value)}>
      {themes.map((t) => (
        <option key={t.name} value={t.name}>{t.name}</option>
      ))}
    </select>
  );
}
```

Enable **persistence** so the user's choice survives page reloads:

<!-- doc-snippet: fragment — persistence excerpt: lightTheme, darkTheme and brandTheme are the reader's own theme objects and App is their root component -->
```tsx
<ThemeProvider
  themes={[lightTheme, darkTheme, brandTheme]}
  defaultTheme="light"
  persist
  storageKey="my-app-theme"
>
  <App />
</ThemeProvider>
```

The provider stores the active theme name and mode in `localStorage` under the keys `<storageKey>-name` and `<storageKey>-mode`.

## RTL Support

ObjectUI components use **logical CSS properties** (`ms-`, `me-`, `ps-`, `pe-`) where available via Tailwind's logical utilities. For full RTL support:

1. Set the `dir` attribute on your root element:

<!-- doc-snippet: fragment — an opening tag on its own, shown to isolate the dir and lang attributes — it is deliberately unclosed because the reader's document supplies the rest -->
```tsx
<html dir="rtl" lang="ar">
```

2. Use Tailwind's RTL modifier for directional overrides:

```tsx
<div className="ps-4 pe-2 rtl:ps-2 rtl:pe-4">
  Directional padding
</div>
```

3. Avoid `left` / `right` utilities — prefer `start` / `end` equivalents (`text-start`, `ms-4`, `rounded-s-lg`).

> **Note:** RTL support requires Tailwind CSS v3.3+ or v4 with logical property utilities enabled.
