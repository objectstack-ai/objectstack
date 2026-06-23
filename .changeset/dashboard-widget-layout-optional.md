---
"@objectstack/spec": patch
---

fix(spec): make dashboard widget `layout` optional (auto-flowed when omitted)

`DashboardWidgetSchema.layout` was required, but the entire runtime treats it as
optional: the renderer (`DashboardGridLayout`) auto-flows any widget without a
layout (`x: (i % 4) * 3, y: ⌊i/4⌋ * 4, w: 3, h: 4`), and the Studio dashboard
designer adds widgets **without** a layout by design.

The mismatch meant every dashboard authored in the Studio designer failed spec
validation the moment a widget was added — the draft `PUT /meta/dashboard/...`
returned **422** ("widgets: Invalid type: expected object, received undefined"),
so the draft never saved and **Publish stayed disabled**, even though the widget
rendered correctly in the canvas. Found by dogfooding the dashboard designer in
the browser.

`layout` is now optional; absence means "auto-place". Authors may still pin an
explicit grid position. Backward-compatible — existing dashboards that specify
`layout` are unaffected.
