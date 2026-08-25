---
"@objectstack/spec": minor
---

feat(spec): declare `cloud-connection:panel` / `marketplace:installed-list` in `ComponentPropsMap` — undeclared keys on the two are refused (#11575)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

These were two more instances of the #8691/#8744 silent no-op class:
console-registered widgets on `@objectstack/cloud-connection`'s published
Setup pages, reachable through the component type union's open string arm,
with registered renderers but no `ComponentPropsMap` row — so the #5068
component-props gate's dispatch skipped them as unregistered and any authored
key rode through every validator in silence.

The new rows are strict and **empty**, measured from the renderers' actual
read points at the objectui pin, not from the registrations' declared-input
lists (#8691/#8744 record where those diverge — here the two happen to
agree): both registrations discard the schema node entirely
(`() => <CloudConnectionPanel />`, `() => <InstalledList />`) and neither
component function takes a prop, so the widgets accept **no configuration at
all**, and an authored key is now a publish-time refusal naming the surface
instead of a silent no-op.

**What stays accepted:** the empty bag (`{}`, or `properties` omitted) — the
shape both plugin-shipped pages (`cloud_connection_settings`,
`marketplace_installed`) author today, byte-identically. Node-level keys
(`visibleWhen`, `id`, `style`, …) are unaffected: they live on the component
node, and the refusal's guidance says so.

## FROM → TO

```ts
// before — parsed green everywhere; the panel polls on its own schedule anyway
{
  type: 'cloud-connection:panel',
  properties: { pollInterval: 5 },   // silent no-op: the widget reads nothing
}

// after — any key is a publish-time refusal naming the zero-prop surface;
// write the measured shape
{
  type: 'cloud-connection:panel',
  properties: {},
}
```

There is deliberately no automatic rewrite: a key authored on either widget
configures nothing and is removed, not renamed — behaviour that seems to need
one is a renderer capability request against objectui, not a metadata key.
`os migrate meta` surfaces the change as a structured TODO (semantic entry
`ui-cloud-connection-widgets-unknown-keys-refused`, protocol major 18 — this
refusal is not part of the v17.0.0 cut).

<!-- adr-0087: registered ui-cloud-connection-widgets-unknown-keys-refused -->
