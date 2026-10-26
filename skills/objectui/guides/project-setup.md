# ObjectUI Project Setup

Setting up a new ObjectUI project and configuring its build.

## Quick start: new project from scratch

### Using the CLI

```bash
npx @object-ui/cli init my-app
cd my-app
pnpm install
pnpm dev
```

The `init` command scaffolds a project with templates: `simple`, `form`, `dashboard`, etc.

### Manual setup (Vite + React)

```bash
pnpm create vite my-app --template react-ts
cd my-app
pnpm add @object-ui/components @object-ui/core @object-ui/react @object-ui/fields
pnpm add -D tailwindcss @tailwindcss/vite postcss
```

Then configure the required files (see "Essential configuration files" below).

## Essential configuration files

### package.json (minimum dependencies)

<!-- os:check -->
```json
{
  "dependencies": {
    "@object-ui/components": "latest",
    "@object-ui/core": "latest",
    "@object-ui/react": "latest",
    "@object-ui/fields": "latest",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^6.0.3",
    "vite": "^8.2.1",
    "@vitejs/plugin-react": "^6.0.5"
  }
}
```

Add plugins as needed (full plugin catalog):
<!-- os:check -->
```json
{
  "@object-ui/plugin-grid": "latest",
  "@object-ui/plugin-list": "latest",
  "@object-ui/plugin-detail": "latest",
  "@object-ui/plugin-form": "latest",
  "@object-ui/plugin-kanban": "latest",
  "@object-ui/plugin-calendar": "latest",
  "@object-ui/plugin-timeline": "latest",
  "@object-ui/plugin-gantt": "latest",
  "@object-ui/plugin-dashboard": "latest",
  "@object-ui/plugin-report": "latest",
  "@object-ui/plugin-charts": "latest",
  "@object-ui/plugin-map": "latest",
  "@object-ui/plugin-editor": "latest",
  "@object-ui/plugin-markdown": "latest",
  "@object-ui/plugin-view": "latest",
  "@object-ui/plugin-tree": "latest",
  "@object-ui/plugin-designer": "latest",
  "@object-ui/plugin-ai": "latest",
  "@object-ui/plugin-chatbot": "latest"
}
```

Opt-in platform packages (auth, i18n, mobile, realtime):
<!-- os:check -->
```json
{
  "@object-ui/auth": "latest",
  "@object-ui/permissions": "latest",
  "@object-ui/i18n": "latest",
  "@object-ui/mobile": "latest",
  "@object-ui/collaboration": "latest"
}
```

Embedding the shell into a third-party app (the theme and data-source providers come
from `@object-ui/react`):
<!-- os:check -->
```json
{
  "@object-ui/app-shell": "latest",
  "@object-ui/react": "latest"
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
});
```

### postcss.config.js

```javascript
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
```

### src/index.css (ObjectUI stylesheets)

This file is critical -- without it, ObjectUI components render unstyled.
There is no `tailwind.config.js` step: ObjectUI is Tailwind 4, configured in
CSS.

```css
@import "tailwindcss";
@import "@object-ui/components/style.css";
@import "@object-ui/fields/style.css";
```

That is the whole of the styling setup. Why the order is load-bearing, why you
do not point Tailwind at the packages in `node_modules`, and how to recolour by
overriding the token values: [`rules/styling.md`](../rules/styling.md).

### tsconfig.json

<!-- os:check -->
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

## CLI commands

| Command | What it does |
|---------|-------------|
| `objectui init` | Scaffold new project from template (`simple`, `form`, `dashboard`) |
| `objectui dev` | Dev server with HMR + schema watching (alias: `objectui serve`) |
| `objectui build` | Production build (Vite) |
| `objectui start` | Serve a previously-built production bundle |
| `objectui validate` | Validate a schema file (CI-friendly, exits non-zero on failure) |
| `objectui check` | Sweep the project's JSON files — not a validation verdict: a file whose root carries a structural key (`children`, `className`, `body`, …) is recognised by that key and never parsed against the schema; only a file with none of those keys is parsed, and it is listed as an advisory when its root `type` names a registered component but the document fails; exits non-zero on unreadable JSON and on a `${…}` refused on a text key its node never evaluates. Use `objectui validate` for the verdict |
| `objectui generate` | Code/schema generation (`object`, `page`, `plugin`) |
| `objectui doctor` | Diagnostics (Node version, deps, etc.) |
| `objectui analyze` | Bundle-size report over the built `dist/` output |

A plugin package is scaffolded by its own initializer, `npm create @object-ui/plugin NAME`, not by the CLI.

### Dev server modes

**Single schema file:**
```bash
objectui dev schema.json --port 3000
```

**File-system routing (pages/ directory):**
```
pages/
├── index.json        → /
├── dashboard.json    → /dashboard
└── settings.json     → /settings
```

```bash
objectui dev pages/ --port 3000
```

## objectstack.config.ts

Configuration for the ObjectStack runtime (objects, views, data, plugins):

```typescript
import { defineConfig } from '@objectstack/runtime';

export default defineConfig({
  apps: [
    {
      name: 'my-app',
      label: 'My Application',
      objects: [
        {
          name: 'contacts',
          label: 'Contacts',
          fields: [
            { name: 'name', type: 'text', label: 'Name', required: true },
            { name: 'email', type: 'email', label: 'Email' },
            { name: 'status', type: 'select', label: 'Status', options: ['active', 'inactive'] },
          ],
        },
      ],
    },
  ],
});
```

## Runtime & integration packages

ObjectUI ships three integration layers for third-party apps. Pick the smallest one that fits.

### `@object-ui/react` — pure renderer (lowest level)

Use when you have your own router, shell and providers and only need to render schemas.

```tsx
import { SchemaRenderer, SchemaRendererProvider } from '@object-ui/react';

<SchemaRendererProvider dataSource={dataSource}>
  <SchemaRenderer schema={pageSchema} />
</SchemaRendererProvider>
```

### Context providers

The provider stack for a third-party app comes from the packages that read it:

- `SchemaRendererProvider` (`@object-ui/react`) — the ambient data source; pass the
  adapter as its `dataSource` prop.
- `ThemeProvider` / `useTheme` (`@object-ui/react`) — theme documents and the
  `auto` / `light` / `dark` mode.
- `MetadataProvider` / `useMetadata` (`@object-ui/app-shell`) — apps / objects /
  dashboards / pages metadata from the API.
- `UploadProvider` / `useUpload` (`@object-ui/providers`) — the upload adapter the
  file and image fields upload through.

```tsx
import { SchemaRendererProvider, ThemeProvider } from '@object-ui/react';

<ThemeProvider defaultMode="auto">
  <SchemaRendererProvider dataSource={myDataSource}>
    <App />
  </SchemaRendererProvider>
</ThemeProvider>
```

### `@object-ui/app-shell` — minimal shell + renderers

Use when integrating ObjectUI into a host system (CRM, ERP, custom admin) and you want:

- `AppShell` (sidebar + main split layout)
- `ObjectView`, `RecordDetailView`, `DashboardView`, `PageView`, `ReportView`
- `AdapterProvider`, `MetadataProvider`, `ExpressionProvider`
- `useObjectActions`, `useRecentItems`, `useAdapter`, `useMetadataItem`

⚠️ These are `*View`, not `*Renderer`. `ObjectRenderer` exists nowhere in the
repo; `DashboardRenderer` is `@object-ui/plugin-dashboard`'s; `PageRenderer` is
internal to `@object-ui/components` and is reached through the registry, not by
import. Importing any of the three from `app-shell` does not resolve.

```tsx
import { AppShell, AdapterProvider, MetadataProvider } from '@object-ui/app-shell';

<AdapterProvider adapter={myAdapter}>
  <MetadataProvider adapter={myAdapter}>
    <AppShell sidebar={<MySidebar />}>
      {/* your React Router routes — ObjectView mounts on an object route, see below */}
    </AppShell>
  </MetadataProvider>
</AdapterProvider>
```

App-shell runs under React Router: `react-router-dom` is its peer dependency, and
`ObjectView` resolves the object and view from the route (the console mounts it on
`/apps/:appName/:objectName` and `/apps/:appName/:objectName/view/:viewId`), so it
takes no `objectName` prop. Its props are the exported `ConsoleObjectViewProps` —
`dataSource`, `objects`, `onEdit`, and the optional `externalRefreshKey`. Copy the
mount from the "ObjectView" section of `packages/app-shell/README.md`: that block is
the one `pnpm check:doc-snippets` compiles, and this guide does not restate it.

### Running a schema as a standalone app

Use the `objectui dev` CLI (`@object-ui/cli`). The repository's `packages/runner` is
a private workspace demo app, not a published package.

### Decision matrix

| Need | Use |
|------|-----|
| Bare renderer in existing app | `@object-ui/react` |
| Need the data-source / theme providers | `SchemaRendererProvider`, `ThemeProvider` from `@object-ui/react` |
| Need file / image uploads | + `@object-ui/providers` (`UploadProvider`) |
| Need shell + object/dashboard/page/record views | + `@object-ui/app-shell` |
| Need full admin console (sidebar, system hub, navigation) | study `apps/console` patterns |
| Need a CLI-driven dev server | `@object-ui/cli` (`objectui dev`) |

## Deployment

### Vite production build

```bash
pnpm build            # Produces dist/
pnpm preview          # Serve dist/ locally
```

### Environment variables

```bash
VITE_API_BASE_URL=/api/v1
VITE_AUTH_BASE_URL=/api/v1/auth
```

Access in code: `import.meta.env.VITE_API_BASE_URL`

## Troubleshooting

### Components render unstyled
- Missing the `@object-ui/components/style.css` / `@object-ui/fields/style.css` imports — ObjectUI's own utilities never reach the page
- The two sheets imported in the wrong order, or the components one left out — the fields sheet carries no tokens of its own
- Overridden `:root` tokens written as finished colours instead of Shadcn HSL channel triples (`0 0% 100%`), so `hsl(var(--token))` resolves to nothing
- CSS file not imported in `main.tsx`

### Module not found errors
- Run `pnpm install` to ensure workspace links are resolved
- Run `pnpm build` — downstream packages need built `dist/` directories
- Check `tsconfig.json` path aliases match project structure

### Turbo cache issues
- `pnpm turbo run build --force` to bypass cache
- Delete `.turbo/` directory for clean state

### Vite HMR not working
- Check `vite.config.ts` has `react()` plugin
- Ensure file extensions are `.tsx` not `.jsx` when using TypeScript
