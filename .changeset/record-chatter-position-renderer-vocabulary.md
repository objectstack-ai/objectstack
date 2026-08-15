---
"@objectstack/spec": minor
---

fix(spec): `record:chatter` / `record:discussion` `position` speaks the renderer's vocabulary, and the row's schema defaults are dropped (#8762)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`RecordChatterProps.position` declared `sidebar | inline | drawer` — a
vocabulary NO renderer read point ever compared. Measured at objectui pin
`665661ab0932`, the renderer chain is self-consistent in three places and
speaks `bottom | right | left`: `RecordChatterPanel` docks on `right`/`left`
and renders in flow on `bottom`, the designer registration publishes
`enum: ['bottom', 'right', 'left']`, and the renderer merge falls back to
`bottom`. So the schema's own default (`sidebar`, materialized onto every
parsed node that said nothing) was a silent no-op falling through to the
in-flow render, while the value that actually docks the panel (`right`) was
refused at publish. The maintainer ruling (2026-08-15) converged the row on
the renderer's vocabulary — one vocabulary, no mapping layer.

**FROM → TO:** `position: 'sidebar'` → `'right'` (the docked side panel the
spelling meant); `'inline'` → `'bottom'` (the in-flow branch it already
landed in); `'drawer'` → `'right'` (no overlay drawer was ever implemented —
the docked panel is the nearest surviving intent). One-line fix: re-spell
`position` to `bottom`/`right`/`left`; `os migrate meta` rewrites sources
mechanically via the ADR-0087 conversion
`record-chatter-position-vocabulary`, and stored `sys_metadata` rows replay
clean through the rehydration seam. A live author gets a per-value "was
removed" prescription from the enum's own error map.

**All three schema defaults are dropped** (`position: 'sidebar'`,
`collapsible: true`, `defaultCollapsed: false`) per the `maxVisible`
principle — renderer fallbacks stay the renderer's facts. The old
`collapsible` default *inverted* the renderer merge's own `false` fallback,
turning "the author said nothing" into "the author asked for collapsible". A
page that wants the collapse affordance authors `collapsible: true`
explicitly; unset keys now parse to nothing and the renderer decides.

The row stays ONE shared schema object for `record:chatter` AND
`record:discussion` (the #8744 pairing) — both names accept and refuse
identically. The objectui renderer is unchanged.

<!-- adr-0087: registered record-chatter-position-vocabulary, record-chatter-position-vocabulary-converged -->
