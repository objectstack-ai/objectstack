---
'@object-ui/fields': patch
---

fix(fields): a line-item grid whose first load failed loads again on its next mount, with no page reload

Clause-②: no
Metadata-protocol: none

The line-item grid's body loads on first use. When that first load failed once (a network blip, a deploy that swapped chunk names) and the host had not preloaded it, the grid showed its error from then on, even after the body was reachable again, until the page was reloaded. `GridField` / `LineItemsField` no longer hold the body in a `React.lazy`, which keeps a failed load for good: each mount that finds the body still loading asks for it once, a failure still reaches the nearest error boundary, and the next mount asks again. The `grid` form-field widget (the registered `field:grid` and `getLazyFieldWidget('grid')`) now resolves to that same face, so it recovers the same way.

What does not change: a mount after the body has loaded renders it directly, `preloadGridField()` still never rejects, and the props of both names are unchanged. A form drawing a `grid` field shows the grid's own loading placeholder while the body loads. No metadata key, value or default changes.
