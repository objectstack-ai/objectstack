# Plugin Editor - Lazy-Loaded Monaco Editor

A lazy-loaded code editor component for Object UI based on Monaco Editor.

## Features

- **Internal Lazy Loading**: The Monaco Editor is loaded on-demand using `React.lazy()` and `Suspense`
- **Zero Configuration**: Just import the package and use `type: 'code-editor'` in your schema
- **Automatic Registration**: Components auto-register with the ComponentRegistry
- **Skeleton Loading**: Shows a skeleton while Monaco loads

## Installation

```bash
pnpm add @object-ui/plugin-editor
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-editor';
import type { CodeEditorSchema } from '@object-ui/plugin-editor';

// Now you can use code-editor type in your schemas
const schema: CodeEditorSchema = {
  type: 'code-editor',
  value: 'console.log("Hello, World!");',
  language: 'javascript',
  theme: 'vs-dark',
  height: '400px'
};
```

### Manual Integration

```typescript
import { editorComponents } from '@object-ui/plugin-editor';
import { ComponentRegistry } from '@object-ui/core';

// Manually register if needed. The third argument is the namespace this plugin's
// own registration passes (`src/index.tsx`); the two-argument form still compiles,
// but `register` warns that it is the deprecated pattern.
Object.entries(editorComponents).forEach(([type, component]) => {
  ComponentRegistry.register(type, component, { namespace: 'plugin-editor' });
});
```

### TypeScript Support

The plugin exports TypeScript types for full type safety:

```typescript
import type { CodeEditorSchema } from '@object-ui/plugin-editor';

const schema: CodeEditorSchema = {
  type: 'code-editor',
  value: 'console.log("Hello, World!");',
  language: 'javascript',
  theme: 'vs-dark',
  height: '400px'
};
```

## Schema API

`CodeEditorSchema` is declared in `@object-ui/types` and re-exported by this
plugin, so the type an author reads and the schema that validates their document
are one declaration. It extends `BaseSchema`, which is where `className` comes
from.

| Member | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `type` | `'code-editor'` | yes | — | The registry key this plugin registers. |
| `value` | `string` | no | `''` | Code content. A host-supplied `value` prop wins over it. |
| `language` | `string` | no | `'javascript'` | The contract is `string`: the renderer forwards it verbatim, so any language id Monaco knows resolves. The registration's `inputs` manifest narrows the authoring picker to `javascript`, `typescript`, `python`, `json`, `html` and `css` — a shortlist, not the accepted set. |
| `theme` | `'vs-dark' \| 'light'` | no | `'vs-dark'` | Closed, unlike `language`. |
| `height` | `string` | no | `'400px'` | Forwarded to Monaco as a CSS length. |
| `readOnly` | `boolean` | no | `false` | Whether the editor refuses edits. |
| `className` | `string` | no | `''` | Tailwind classes, from `BaseSchema`. |

The defaults above are the renderer's own destructuring defaults
(`src/MonacoImpl.tsx`) — what an omitted key actually produces.

## Lazy Loading Architecture

The plugin uses a two-file pattern for optimal code splitting:

1. **`MonacoImpl.tsx`**: Contains the actual Monaco Editor import (heavy)
2. **`index.tsx`**: Entry point with `React.lazy()` wrapper (light)

When bundled, Vite automatically creates separate chunks:
- `index.js` (~200 bytes) - The entry point
- `MonacoImpl-xxx.js` (~15-20 KB) - The lazy-loaded implementation

The Monaco Editor library is only downloaded when a `code-editor` component is actually rendered, not on initial page load.

## Build Output Example

```
dist/index.js                 0.19 kB  # Entry point
dist/MonacoImpl-DCiwKyYW.js  19.42 kB  # Lazy chunk (loaded on demand)
dist/index.umd.cjs           30.37 kB  # UMD bundle
```

## Development

```bash
# Build the plugin
pnpm build

# The package will generate proper ESM and UMD builds with lazy loading preserved
```

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-editor)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-editor)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
