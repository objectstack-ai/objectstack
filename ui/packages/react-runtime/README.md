# @object-ui/react-runtime

Runs a JSX/TSX **source string** as real React, in the main React tree.

This is the engine behind `kind:'react'` pages (ADR-0080). It transpiles the
source with [Sucrase](https://github.com/alangpierce/sucrase), evaluates it
against an injected scope, and renders the result behind a built-in error
boundary. Vendored from [react-runner](https://github.com/nihgwu/react-runner)
(MIT) rather than depended on, so we control the scope/imports surface and can
lazy-load it behind a capability flag.

> **⚠️ No sandbox — this is the trusted execution tier.**
> The source is `new Function(...)`'d with full access to the page's React tree
> and everything in scope. It is not isolated, not restricted, and not
> validated. Only run source you would run as first-party code.
>
> For untrusted authors use **`kind:'html'`** instead: constrained JSX, parsed
> into a schema tree and never executed. See
> [React pages](../../content/docs/guide/react-pages.md).

## Installation

```bash
npm install @object-ui/react-runtime
```

`react ^18.0.0 || ^19.0.0` is a peer dependency.

## Usage

```tsx
import type { ComponentType } from 'react';
import { ReactRunner } from '@object-ui/react-runtime';

// Whatever your app already has to hand: the values it injects into the runtime
// scope, and the sink it reports errors to.
declare const ObjectGrid: ComponentType;
declare const useAdapter: () => unknown;
declare const data: unknown;
declare const report: (error: Error) => void;

<ReactRunner
  code={`
    function Page() {
      const [n, setN] = React.useState(0);
      return <button onClick={() => setN(n + 1)}>clicked {n} times</button>;
    }
  `}
  scope={{ ObjectGrid, useAdapter, data }}
  fallback={(error) => <pre>{String(error)}</pre>}
  onError={(error) => report(error)}
/>
```

### Props

| Prop | Type | Notes |
|---|---|---|
| `code` | `string` | The JSX/TSX source. Required. |
| `scope` | `Record<string, unknown>` | Values injected as closure variables. `React` is always present. **Keep the object identity stable** — see below. |
| `fallback` | `(error: Error) => ReactNode` | Rendered when the source throws at transpile, eval, or render time. |
| `onError` | `(error: Error) => void` | Called once per error, including errors caught at mount. |

## Accepted source shapes

`ReactRunner` renders the source's **default export**. An implicit
`export default` is inserted when the source *starts with* JSX, a `function`
declaration, `()`, or `class`:

```tsx
// `React` is always in the runtime scope, so a source never imports it.
declare const React: typeof import('react');

<p>hi</p>                                   // ✅ bare JSX
function PageFunction() { return <p/>; }    // ✅ function declaration
() => <p>hi</p>                             // ✅ arrow expression
class PageClass extends React.Component {}  // ✅ class

const PageNotExported = () => <p/>;         // ❌ exports nothing — see below
const PageExported = () => <p/>;
export default PageExported;                // ✅ export it explicitly
```

Each line above is a **separate source** — they are alternatives, not one file.
They carry different names only so the block compiles as a single program; the
rule is about the shape the source *starts with*, never about the name.

The `const Page = …` form is the one authors reach for most, and it does **not**
get the implicit export. It used to render a blank page with no error anywhere;
it now throws with a message naming the fix, which `fallback` surfaces.
`export default null` still means "render nothing".

### Imports

There is no module resolver. `import x from 'y'` compiles to a `require('y')`
that reads `scope.import`:

```tsx
import { ReactRunner } from '@object-ui/react-runtime';

declare const code: string;
declare const dateFns: Record<string, unknown>;

<ReactRunner code={code} scope={{ import: { 'date-fns': dateFns } }} />
```

Anything not provided there throws `Module not found`.

## Styling

**Do not author Tailwind utility classes in page `source`** — on either tier. A
page's `source` is *runtime metadata*: the console's Tailwind is compiled at
build time by scanning the console's own `src`, and there is no safelist, so it
never sees your page. An authored utility class produces CSS only by coincidence
(when objectui already ships that exact class) and otherwise produces nothing,
with no error anywhere. `os validate` reports it as
`page-source-className-tailwind`, a warning on both tiers. (ADR-0065; ADR-0080's
2026-06-30 amendment.)

Style a `kind:'react'` page with inline `style` objects, and a `kind:'html'` page
with the blocks' own structured props (`<flex direction gap>`, `<grid columns>`)
plus a JSON `style` object. Colors on both tiers come from the theme as
`hsl(var(--token))`, so a page follows light/dark and whatever theme the
deployment installs.

## Stable scope identity matters

Every evaluation produces a **new** component function — a new element *type* —
which React unmounts and remounts. `ReactRunner` therefore memoises the
transpile+eval on `(code, scope)` by identity and only recompiles when one of
them actually changes.

That means an inline `scope={{ ... }}` object literal recompiles and **remounts
the rendered tree on every render**, silently discarding whatever state it held.
Build the scope with `useMemo` (or hoist it to module scope) and keep its
dependencies stable.

```tsx
import { useMemo, type ComponentType } from 'react';
import { ReactRunner } from '@object-ui/react-runtime';

declare const src: string;
declare const ObjectGrid: ComponentType;
declare const data: unknown;

// ❌ new object every render — the page remounts and loses its useState
<ReactRunner code={src} scope={{ ObjectGrid, data }} />

// ✅
const scope = useMemo(() => ({ ObjectGrid, data }), [data]);
<ReactRunner code={src} scope={scope} />
```

## Error handling

`ReactRunner` is its own error boundary and holds the error until `code` or
`scope` changes, so `fallback` is reached for render-phase errors too — not
just transpile/eval failures. New inputs clear it and recompile.

## Lower-level API

```ts
import { generateElement, transform, type Scope } from '@object-ui/react-runtime';

declare const code: string;
declare const scope: Scope;

transform(code)                  // JSX/TS → JS (classic runtime, imports → require)
generateElement(code, scope)     // transpile + eval → ReactElement | null (throws, see above)
```

## Related

- [React pages guide](../../content/docs/guide/react-pages.md) — authoring
  `kind:'react'` pages, the injected block scope, and the capability gate.
- `@object-ui/sdui-parser` — the `kind:'html'` tier: parse, never execute.

## License

MIT
