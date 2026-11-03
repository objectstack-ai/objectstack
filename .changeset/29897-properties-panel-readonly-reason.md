---
'@object-ui/app-shell': patch
---

fix(app-shell): on a read-only item, the Properties panel shown with nothing selected says why its controls are disabled

Clause-②: no
Metadata-protocol: none

On the metadata editor page (Studio's All metadata item page, Setup's metadata pages), a locked item, a read-only package, a caller without `manage_metadata`, a code-shipped artifact or a walled catalog type disables every control in the Properties panel. The scoped inspector (a selected flow node or edge) already said why; the panel shown with nothing selected (an object's or view's default inspector, or the generic form a flow shows) greyed its controls silently, and Tab never reached them. The page now wraps that panel, and the generic form on a page without a canvas, in the same reason wrapper the scoped inspectors use: hovering a disabled control or tabbing to the panel opens a tooltip with the reason, and the panel's accessible description is that reason. A writable item renders the panel exactly as before. No registered default inspector changes: the page draws the reason around it.
