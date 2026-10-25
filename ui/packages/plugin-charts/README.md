# Plugin Charts - Lazy-Loaded Recharts Components

A lazy-loaded charting component for Object UI based on Recharts.

## Features

- **Internal Lazy Loading**: Recharts is loaded on-demand using `React.lazy()` and `Suspense`
- **Zero Configuration**: Just import the package and use `type: 'bar-chart'` in your schema
- **Automatic Registration**: Components auto-register with the ComponentRegistry
- **Skeleton Loading**: Shows a skeleton while Recharts loads

## Installation

```bash
pnpm add @object-ui/plugin-charts
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx). This side-effect import
// is the one that registers the components; the type import below is erased at
// build time and registers nothing.
import '@object-ui/plugin-charts';
import type { BarChartSchema } from '@object-ui/plugin-charts';

// Now you can use the bar-chart type in your schemas
const schema: BarChartSchema = {
  type: 'bar-chart',
  data: [
    { name: 'Jan', value: 400 },
    { name: 'Feb', value: 300 },
    { name: 'Mar', value: 600 }
  ],
  dataKey: 'value',
  xAxisKey: 'name',
  height: 400
};
```

### Manual Integration

```typescript
import { chartComponents } from '@object-ui/plugin-charts';
import { ComponentRegistry } from '@object-ui/core';

// Manually register if needed. The third argument is not optional in practice:
// `register()` without a namespace is the deprecated form and warns at runtime.
// `plugin-charts` is the namespace this package registers under itself.
Object.entries(chartComponents).forEach(([type, component]) => {
  ComponentRegistry.register(type, component, { namespace: 'plugin-charts' });
});
```

### TypeScript Support

The plugin exports TypeScript types for full type safety:

```typescript
import type { BarChartSchema } from '@object-ui/plugin-charts';

const schema: BarChartSchema = {
  type: 'bar-chart',
  data: [
    { name: 'Jan', value: 400 },
    { name: 'Feb', value: 300 }
  ],
  dataKey: 'value',
  xAxisKey: 'name',
  height: 400
};
```

## Schema API

`BarChartSchema` is the published contract — import it (see **TypeScript Support**
above) rather than re-declaring this shape in your own code. It is re-exported
from `@object-ui/types`, so the type you annotate with and the schema that
validates your document are the same declaration.

| Member | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `type` | `'bar-chart'` | yes | — | The registry keyword this schema renders under. |
| `data` | `Array<Record<string, any>>` | no | `[]` | Rows to plot — one bar per row. |
| `dataKey` | `string` | no | `'value'` | Row key holding the bar's value (the y axis). |
| `xAxisKey` | `string` | no | `'name'` | Row key holding the bar's category label (the x axis). |
| `height` | `number` | no | `400` | Chart height in pixels — a number, not a CSS length. |
| `color` | `string` | no | `hsl(var(--primary))` | Bar fill colour, forwarded to Recharts verbatim. |
| `className` | `string` | no | `''` | Tailwind classes. Inherited from `BaseSchema`. |

Every default above is the renderer's own — the parameter defaults of
`ChartBarRenderer`'s implementation in `src/ChartImpl.tsx`, which is what an
omitted member actually resolves to at render time. Note `color`: the type's
JSDoc and the registration's `defaultProps` both still record `'#8884d8'`, but
neither is read on the render path, so an omitted `color` renders as the theme
token above.

## Lazy Loading Architecture

The plugin uses a two-file pattern for optimal code splitting:

1. **`ChartImpl.tsx`**: Contains the actual Recharts import (heavy ~541 KB)
2. **`index.tsx`**: Entry point with `React.lazy()` wrapper (light)

When bundled, Vite automatically creates separate chunks:
- `index.js` (~200 bytes) - The entry point
- `ChartImpl-xxx.js` (~541 KB minified, ~136 KB gzipped) - The lazy-loaded implementation

The Recharts library is only downloaded when a `bar-chart` component is actually rendered, not on initial page load.

## Build Output Example

```
dist/index.js                 0.19 kB  # Entry point
dist/ChartImpl-BJBP1UnW.js  541.17 kB  # Lazy chunk (loaded on demand)
dist/index.umd.cjs          393.20 kB  # UMD bundle
```

## Development

```bash
# Build the plugin
pnpm build

# The package will generate proper ESM and UMD builds with lazy loading preserved
```

## Bundle Size Impact

By using lazy loading, the main application bundle stays lean:
- Without lazy loading: +541 KB on initial load
- With lazy loading: +0.19 KB on initial load, +541 KB only when chart is rendered

This results in significantly faster initial page loads for applications that don't use charts on every page.

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-charts)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-charts)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
