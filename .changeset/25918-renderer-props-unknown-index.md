---
'@object-ui/types': patch
'@object-ui/components': patch
---

fix(types,components)!: a renderer's props index signature is `unknown`, not `any`, so a forwarded key must be narrowed before it is used

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (type-surface-only ui/packages/types/src/base.ts#ComponentRendererProps) A TypeScript annotation narrowing on a published renderer-props type: no metadata key, accepted value, export or error code is removed or renamed, nothing at runtime changes, and `objectstack migrate meta` has nothing to rewrite. The affected party is a TypeScript consumer, reached by its own compiler. -->

**BREAKING** type-surface narrowing, compile-time only. Nothing a renderer receives or renders at runtime changes.

- **`@object-ui/types`.** `ComponentRendererProps` keeps its index signature, so every key the host forwards is still admitted, but the signature now maps to `unknown` instead of `any`.
- **`@object-ui/components`.** The built-in renderers' own inline props annotations move the same way. The three host keys renderers read by name and pass to their root element (`data-obj-id`, `data-obj-type` and `style`, written or forwarded by `SchemaRenderer`) are declared once in a package-local type instead. The host-supplied callbacks and values a renderer reads by name (`onPageChange` on `pagination`, `onChange` / `value` on `input-otp`, `loading` on `button`, `className` on `text`, react-hook-form's `ref` on the form's built-in controls) are declared on that renderer's props.

**Migration.** A renderer typed with `ComponentRendererProps` that reads a forwarded key:

```ts
// FROM — compiled, because the key was `any`
const Pager = ({ schema, ...props }: ComponentRendererProps<PagerSchema>) =>
  <Nav onSelect={(n) => props.onPageChange(n)} />;

// TO — declare the key you read on your own props, or narrow it before use
type PagerProps = ComponentRendererProps<PagerSchema> & { onPageChange?: (page: number) => void };
const Pager = ({ schema, onPageChange }: PagerProps) =>
  <Nav onSelect={(n) => onPageChange?.(n)} />;
```

What to do: nothing if your renderers never read a forwarded key off `ComponentRendererProps` without declaring it. Otherwise declare the key on your renderer's props (as above) or narrow the `unknown` value (`typeof x === 'function'`, `typeof x === 'string'`) before using it.
