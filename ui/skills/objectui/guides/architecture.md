# Architecture & Implementation Patterns

The JSON node shape every renderer reads, and the two runtime patterns built on it:
the registry that maps a `type` string to a component, and the recursion that turns a
schema tree into React. Read it before writing a custom renderer, or when choosing which
integration package to install. Day-to-day schema authoring is
[`page-builder.md`](./page-builder.md); packaging a renderer as a plugin is
[`plugin-development.md`](./plugin-development.md).

## Choosing an integration package

- **Embedding ObjectUI into a third-party React app with your own router/shell?** → use `@object-ui/app-shell` + `@object-ui/providers`.
- **Running a schema as a standalone app?** → use `@object-ui/runner` or the `objectui` CLI.
- **Custom rendering only (no shell)?** → use `@object-ui/react` (`SchemaRenderer`) directly.

## The JSON Protocol (The "DNA")

Every node in the UI tree follows this shape — enforce it on every input.

⚠️ The fence below is a deliberately SIMPLIFIED teaching copy of the published
`BaseSchema` (`import type { BaseSchema } from '@object-ui/types';`), KEPT
rather than replaced by an import: it teaches the SHAPE, not the member list,
and nothing checks the copy against the real type. `BaseSchema` has **no index
signature**, so a key no member declares gets one verdict per
face: on the TypeScript authoring face it is a compile error in a fresh typed
literal (TypeScript excess-checks only a FRESH object literal, so a value that
reached its annotation through a wider variable is not re-checked); on the
tolerant zod / JSON face (`.passthrough()`) it is kept, and the named reader
decides. That is why `props` and `events` are **absent** from the fence:
`props` is the `element:*` config envelope the runtime reads and the TypeScript
face does not declare; `events` is read by nothing on either face. The "Keys
Live on the Node" and "Actions Are Node Types" rules in `rules/protocol.md` say
who reads each.

```typescript
// @object-ui/types — abridged; the full BaseSchema member list is packages/types/src/base.ts
interface BaseSchema {
  /** The unique identifier for the renderer registry (e.g., 'input', 'grid', 'card') */
  type: string;

  /** Unique ID for DOM accessibility and event targeting */
  id?: string;

  /** Data binding path (e.g., 'user.address.city') */
  bind?: string;

  /** Styling overrides (Tailwind classes) */
  className?: string;

  /** Dynamic Behavior */
  hidden?: boolean | ExpressionWire; // e.g. "${data.role != 'admin'}"
  disabled?: boolean | ExpressionWire; // same wire as hidden

  /** Layout Slots */
  children?: BaseSchema[]; // object half; the real slot also admits primitives

  // no index signature: a key no member declares is a compile error in a fresh typed literal
}
```

See `rules/protocol.md` for which fields are expression-evaluated and which are not.

## Implementation Patterns

### Pattern A: The Component Registry (Extensibility)

How users add their own components (e.g. a `Map` widget):

```typescript
// packages/core/src/registry/Registry.ts — one shared instance, not free functions
export const ComponentRegistry = new Registry<any>();

// register(type, component, meta?) — `meta.namespace` makes the key `namespace:type`
ComponentRegistry.register('map', MapRenderer, { namespace: 'plugin-map' });

// get(type, namespace?) — undefined when nothing is registered; the caller
// (SchemaRenderer) is what falls back, the registry does not.
const impl = ComponentRegistry.get('map');
```

### Pattern B: The Renderer Loop (Recursion)

How the schema tree becomes React:

```typescript
// packages/react/src/SchemaRenderer.tsx
export const SchemaRenderer = ({ schema }: { schema: BaseSchema }) => {
  const Component = resolveComponent(schema.type);
  const { isHidden } = useExpression(schema.hidden);

  if (isHidden) return null;

  return (
    <Component
      schema={schema}
      className={cn(schema.className)}
      {...schema.props}
    >
      {schema.children?.map(child => (
        <SchemaRenderer key={child.id} schema={child} />
      ))}
    </Component>
  );
};
```
