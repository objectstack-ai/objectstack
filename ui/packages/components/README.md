# @object-ui/components

Standard UI component library for Object UI, built with Shadcn UI + Tailwind CSS.

## Features

- 🎨 **Tailwind Native** - Built entirely with Tailwind CSS utility classes
- 🧩 **Shadcn UI** - Based on Radix UI primitives for accessibility
- 📦 **60+ Components** - Complete set of UI components (46 from Shadcn + 14 custom)
- ♿ **Accessible** - WCAG compliant components
- 🎯 **Type-Safe** - Full TypeScript support
- 🔌 **Extensible** - Easy to customize and extend
- 🔄 **Sync Tools** - Scripts to keep components updated with latest Shadcn

## Keeping Components Updated

ObjectUI provides tools to sync components with the latest Shadcn UI versions:

```bash
# Analyze components (offline)
pnpm shadcn:analyze

# Check for updates (online)
pnpm shadcn:check

# Update a component
pnpm shadcn:update button --backup
```

**📚 See [README_SHADCN_SYNC.md](./README_SHADCN_SYNC.md) for the complete guide.**

## Installation

```bash
npm install @object-ui/components @object-ui/react @object-ui/core
```

**Peer Dependencies:**
- `react` ^18.0.0 || ^19.0.0
- `react-dom` ^18.0.0 || ^19.0.0
- `tailwindcss` ^4.2.1

## Setup

There is no `tailwind.config.js` step. This package is Tailwind 4, which is
configured in CSS: it has no such file of its own, and consuming it does not need
one on your side either.

### 1. Import Styles

Add to your main CSS file, after your own Tailwind entry:

```css
@import 'tailwindcss';
@import '@object-ui/components/style.css';
```

`style.css` is the stylesheet this package compiles at build time from its own
sources. It already carries every utility its components use **and** the theme
tokens those utilities are built on — `bg-primary`, `border-input`, `ring-ring`
and the rest of the Shadcn palette — so importing it is the whole of the styling
setup.

You do **not** add a `@source` line for `node_modules/@object-ui/components`.
Pointing Tailwind at the published files generates the shape-only utilities a
second time and still cannot produce the themed ones, because the `@theme` block
they come from lives in this package's unpublished source. Your own Tailwind
entry goes on generating the classes your own source uses, as it always did.

### 2. Register Components

```tsx
import { initializeComponents } from '@object-ui/components'

initializeComponents()
```

Importing the package already registers its components as a side effect;
`initializeComponents()` is the explicit call for bundlers that would otherwise
tree-shake that import away.

## Usage

### With SchemaRenderer

```tsx
import { SchemaRenderer } from '@object-ui/react'
import { initializeComponents } from '@object-ui/components'
import type { DeclaredNode } from '@object-ui/types'

initializeComponents()

const schema: DeclaredNode = {
  type: 'card',
  title: 'Welcome',
  children: {
    type: 'text',
    content: 'Hello from Object UI!'
  }
}

function App() {
  return <SchemaRenderer schema={schema} />
}
```

### Direct Import

You can also import UI components directly:

```tsx
import { Button, Input, Card } from '@object-ui/components'

function MyComponent() {
  return (
    <Card>
      <Input placeholder="Enter text" />
      <Button>Submit</Button>
    </Card>
  )
}
```

## Available Components

### Form Components
- `input` - Text input
- `textarea` - Multi-line text
- `select` - Dropdown select
- `checkbox` - Checkbox
- `radio` - Radio button
- `date-picker` - Date selection
- `switch` - Toggle switch

### Layout Components
- `container` - Container wrapper
- `grid` - Grid layout
- `flex` - Flexbox layout
- `card` - Card container
- `tabs` - Tab navigation
- `accordion` - Collapsible sections

#### Page region posture — `usePageRegionPosture()`

The page renderer measures each region of a page against the page body, using
`ResizeObserver` on the region, not the viewport, and tells the region's blocks
how much room they have:

```ts
import { usePageRegionPosture, type PageRegionPosture } from '@object-ui/components';

const posture: PageRegionPosture | null = usePageRegionPosture(); // 'compact' | 'full' | null
```

- `'compact'`: the region is narrower than `(page − 24) / 2`, that is, half
  the page less the 24 px gap between regions side by side. A half-and-half
  cell therefore stays `'full'`.
- `'full'`: the region is half the page or wider.
- `null`: outside a page region, or before the width is known (server render,
  no `ResizeObserver`). Read `null` as `'full'`.

The posture is measured, never authored, and no schema key sets it. The
`list-view` block in `@object-ui/plugin-list` reads it to draw a compact list.

#### Record heading through a field's face — `resolveFieldReadFace()`

On a record page, `page:header` heads the page with the object's declared
`nameField`. When that field declares a widget whose read face is a component
of its own, as `recipient-picker` and `object-ref` are, the heading draws the
value through that face, the one the field's list column draws. A record share
(`nameField: 'recipient_id'`, `widget: 'recipient-picker'`) heads its page with
the recipient's name, not the user id it stores.

The face comes from the field registry in `@object-ui/fields`, which depends on
this package and so cannot be imported here. This package owns a slot, and
`@object-ui/fields` fills it when it loads:

```ts
import { resolveFieldReadFace, type FieldReadFace } from '@object-ui/components';

// `undefined`: no face of the field's own, so the stored text is drawn.
const face: FieldReadFace | undefined = resolveFieldReadFace({ name: 'subject', type: 'text' });
```

- A host that loads `@object-ui/fields` has nothing to wire.
- `resolveFieldReadFace(field)` answers `undefined` when no resolver is installed
  (`@object-ui/fields` is not loaded), the field declares no widget with a read
  face of its own, or no face is registered under that widget's key. The
  heading then prints the stored text, as it did before.
- `setFieldReadFaceResolver(resolver)` installs the resolver. The last install
  wins and `undefined` removes it. `@object-ui/fields` is its caller.
- A face is drawn with the props of a read cell (`FieldReadFaceProps`): the stored
  `value`, the `field` declaration and the whole record as `dependentValues`,
  so a face that reads a sibling field (`dependsOn`) finds it.
- `RecordTitleChip` draws the face in its heading through the optional
  `titleNode` prop. `title` stays a required string.
- The resolver is read when the heading renders. Installing one later does not
  re-render a heading already drawn.

#### The object label's host note

A record page host can attach a one-line note to the header's object label (for
example, how the object is managed) by passing `objectLabelNote` to
`RecordContextProvider` (`@object-ui/react`). `page:header` forwards it to
`RecordTitleChip.objectLabelNote`:

- With a note, the label is a focusable tooltip trigger. Hover or focus shows
  the label, a middle dot and the note, and the note is the label's accessible description
  (`aria-describedby`).
- Without one, the label draws exactly as before. The note is host-injected and
  never authored in a page schema.
- The console sets it on record pages inside the Setup app, where the floating
  managed-by badge is not drawn.

### Data Display
- `table` - Data table
- `list` - List view
- `badge` - Badge label
- `avatar` - User avatar
- `progress` - Progress bar

### Feedback
- `alert` - Alert messages
- `toast` - Toast notifications
- `dialog` - Modal dialog
- `popover` - Popover overlay

### Navigation
- `button` - Button component
- `link` - Link component
- `breadcrumb` - Breadcrumb navigation

## Notification Surfaces

Direct-import React components (not schema blocks) that render the notifications
raised through `NotificationProvider` from `@object-ui/react`. One per spec
`displayType`, so a `banner` no longer presents as a toast:

| Component | `displayType` | Where to mount it |
| --- | --- | --- |
| `<NotificationSnackbar />` | `snackbar` | anywhere inside the provider — it anchors itself bottom-center |
| `<NotificationBanners />` | `banner` | top of the content area (it takes space in the flow) |
| `<NotificationAlerts />` | `alert` | anywhere inside the provider — blocking dialog, FIFO queue |
| `<NotificationInline scope="…" />` | `inline` | in the surface that raises them |

`toast` stays with the host's `onToast` delegate (sonner in the console). All of
them draw the notification's `severity` icon unless it declares an `icon`
override naming a real Lucide icon. See the
[notifications guide](https://objectui.org/docs/guide/notifications).

<!-- doc-snippet: fragment — router-layout excerpt: `Outlet` is react-router's, supplied by the host application -->
```tsx
import { NotificationBanners, NotificationAlerts } from '@object-ui/components';

<main>
  <NotificationBanners />
  <Outlet />
  <NotificationAlerts />
</main>
```

## Customization

### Override Styles

All components accept `className` for Tailwind classes:

```json
{
  "type": "button",
  "label": "Click Me",
  "className": "bg-blue-500 hover:bg-blue-700 text-white"
}
```

### Custom Components

Register your own components:

```tsx
import { ComponentRegistry } from '@object-ui/core'
import { Button } from '@object-ui/components'

function CustomButton(props: Record<string, unknown>) {
  return <Button {...props} className="my-custom-style" />
}

ComponentRegistry.register('custom-button', CustomButton)
```

`ComponentRegistry` is a process-level singleton exported by `@object-ui/core`;
`SchemaRenderer` resolves every `type` against it, so a component registered
here is renderable from schema anywhere in the app.

## API Reference

See [full documentation](https://objectui.org/docs/components) for detailed API reference.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/components)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/components)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
