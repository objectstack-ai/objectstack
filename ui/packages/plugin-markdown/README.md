# Plugin Markdown - Lazy-Loaded Markdown Renderer

A lazy-loaded markdown component for Object UI based on react-markdown with GitHub Flavored Markdown support.

## Features

- **Internal Lazy Loading**: react-markdown is loaded on-demand using `React.lazy()` and `Suspense`
- **Zero Configuration**: Just import the package and use `type: 'markdown'` in your schema
- **Automatic Registration**: Components auto-register with the ComponentRegistry
- **Skeleton Loading**: Shows a skeleton while react-markdown loads
- **XSS Protection**: All content is sanitized via rehype-sanitize
- **GitHub Flavored Markdown**: Full support for tables, strikethrough, task lists, etc.

## Installation

```bash
pnpm add @object-ui/plugin-markdown
```

## Usage

### Automatic Registration (Side-Effect Import)

```typescript
// In your app entry point (e.g., App.tsx or main.tsx)
import '@object-ui/plugin-markdown';
import type { MarkdownSchema } from '@object-ui/plugin-markdown';

// Now you can use markdown type in your schemas
const schema: MarkdownSchema = {
  type: 'markdown',
  content: '# Hello World\n\nThis is **markdown** text.'
};
```

### Manual Integration

```typescript
import { markdownComponents } from '@object-ui/plugin-markdown';
import { ComponentRegistry } from '@object-ui/core';

// Manually register if needed
Object.entries(markdownComponents).forEach(([type, component]) => {
  ComponentRegistry.register(type, component, { namespace: 'plugin-markdown' });
});
```

### TypeScript Support

The plugin exports TypeScript types for full type safety:

```typescript
import type { MarkdownSchema } from '@object-ui/plugin-markdown';

const schema: MarkdownSchema = {
  type: 'markdown',
  content: '# Hello World\n\nThis is **markdown** text.'
};
```

## Schema API

`MarkdownSchema` has one authority — it is declared in `@object-ui/types` and
re-exported by this package — so the members are listed here rather than
re-declared as a second copy in a code block.

| Member | Type | Required | Default | Read by |
| --- | --- | --- | --- | --- |
| `type` | `'markdown'` | yes | none | the registry, to resolve this renderer (registered under the `plugin-markdown` namespace) |
| `content` | `string` | yes | none — see the note below | `MarkdownRenderer`, which forwards it to the lazy implementation; supports GitHub Flavored Markdown |
| `className` | `string` | no | none | `MarkdownRenderer`, which puts it on the markdown container as Tailwind classes |

Every other member is inherited from `BaseSchema`; this renderer reads none of
them.

> ⚠️ **`content`: what the contract says and what the runtime does.** The type
> declares `content` REQUIRED and the component's `inputs` manifest declares it
> `required: true` — but the renderer reads `schema.content || ''`, so a node
> that omits it renders empty instead of failing. Both statements are true, and
> neither is widened or narrowed here.

`sanitize` and `components` appear on the interface only as ADR-0049 retirement
tombstones (`?: never`, objectui#6972) — they are not authorable members and
nothing reads them. Sanitization is unconditional: there is no authored spelling
that turns it off.

## Supported Markdown Features

- Headers (H1-H6)
- Bold, italic, and inline code
- Links and images
- Lists (ordered, unordered, and nested)
- Tables
- Blockquotes
- Code blocks with syntax highlighting
- Strikethrough
- Task lists
- Autolinks

## Lazy Loading Architecture

The plugin uses a two-file pattern for optimal code splitting:

1. **`MarkdownImpl.tsx`**: Contains the actual react-markdown import (heavy ~100-200 KB)
2. **`index.tsx`**: Entry point with `React.lazy()` wrapper (light)

When bundled, Vite automatically creates separate chunks:
- `index.js` (~200 bytes) - The entry point
- `MarkdownImpl-xxx.js` (~100-200 KB) - The lazy-loaded implementation

The react-markdown library is only downloaded when a `markdown` component is actually rendered, not on initial page load.

## Bundle Size Impact

By using lazy loading, the main application bundle stays lean:
- Without lazy loading: +100-200 KB on initial load
- With lazy loading: +0.19 KB on initial load, +100-200 KB only when markdown is rendered

This results in significantly faster initial page loads for applications that don't use markdown on every page.

## Development

```bash
# Build the plugin
pnpm build

# The package will generate proper ESM and UMD builds with lazy loading preserved
```

## Links

- 📚 [Documentation](https://www.objectui.org/docs/plugins/plugin-markdown)
- 📦 [npm package](https://www.npmjs.com/package/@object-ui/plugin-markdown)
- 📝 [Changelog](./CHANGELOG.md)
- 🐛 [Report an issue](https://github.com/objectstack-ai/objectui/issues)
- 🤝 [Contributing Guide](https://github.com/objectstack-ai/objectui/blob/main/CONTRIBUTING.md)
- 🗺️ [Roadmap](https://github.com/objectstack-ai/objectui/blob/main/ROADMAP.md)

## License

MIT — see [LICENSE](./LICENSE).
