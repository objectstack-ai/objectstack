---
'@object-ui/core': minor
'@object-ui/types': minor
---

**BREAKING:** the `module` widget source is retired. `WidgetRegistry` no longer loads a widget's code from a URL at runtime (objectui#13450).

`RuntimeWidgetSource` had a `module` member, `{ type: 'module', url, exportName? }`, and `WidgetRegistry.load()` resolved it with a dynamic `import()` built through the Function constructor so that bundlers could not see it. That is the runtime dynamic import AGENTS.md commandment #6 forbids ("No `eval()` / runtime dynamic imports to load components"), and it also needs `unsafe-eval` under a strict Content Security Policy. The member, its `WidgetSourceModule` interface and the loader arm are removed. `RuntimeWidgetSource` is now `WidgetSourceInline | WidgetSourceRegistry`.

An old manifest is refused loudly, not skipped. In TypeScript, `type: 'module'` no longer type-checks, and importing `WidgetSourceModule` is `TS2305`. A manifest that reaches `WidgetRegistry.load()` untyped (plain JavaScript, a cast, or an older `@object-ui/types`) is rejected before anything is fetched. The rejection names the retired `module` source and both replacements, `load()` emits `widget:error`, and `loadAll()` reports the error for that widget. Any other unknown source type is rejected the same way, and the message lists the supported types.

Migration, FROM → TO:

- FROM `source: { type: 'module', url: '/widgets/chart.js', exportName: 'Chart' }`
- TO `import { Chart } from './widgets/chart';` and then `source: { type: 'inline', component: Chart }`. The component is imported at build time, so the bundler sees it.
- OR register the component once with the component registry (`ComponentRegistry.register('chart', Chart)`) and declare `source: { type: 'registry', registryKey: 'chart' }`.

One-line fix: replace each `{ type: 'module', url }` with `{ type: 'inline', component }`, where `component` is imported at build time.

Remote widgets as a product capability would be a new contract (a signed manifest and an allow-listed origin, decided in `@objectstack/spec`). This release does not add one.

Clause-②: no (narrowing)
Metadata-protocol: narrowed
