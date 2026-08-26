---
"@objectstack/spec": minor
---

feat(spec): declare `mcp:connect-agent` in `ComponentPropsMap` — undeclared keys on the widget are refused (#12344)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

This was a third instance of the #8691/#8744 silent no-op class (#11575 closed
the previous two): a console-registered widget on `@objectstack/mcp`'s
plugin-shipped Setup page (`CONNECT_AGENT_PAGE`), reachable through the
component type union's open string arm, with a registered renderer but no
`ComponentPropsMap` row — so the #5068 component-props gate's dispatch skipped
it as unregistered, any authored key rode through every validator in silence,
and door 3 of the mcp canonical-envelope gate (#12269) had to carry a standing
exemption for the type (deleted here, with its two guard pins).

The new row is strict and **empty**, measured from the renderer's actual read
points at the objectui pin, not from the registration's declared-input list
(#8691/#8744 record where those diverge — here the two happen to agree): the
registration discards the schema node entirely (`() => <ConnectAgent />`) and
the component function takes no parameters — every value it renders comes from
`/discovery`, i18n and its own state — so the widget accepts **no
configuration at all**, and an authored key is now a publish-time refusal
naming the surface instead of a silent no-op.

**What stays accepted:** the empty bag (`{}`, or `properties` omitted) — the
shape the plugin-shipped page (`connect_agent`) authors today,
byte-identically. Node-level keys (`visibleWhen`, `id`, `style`, …) are
unaffected: they live on the component node, and the refusal's guidance says
so.

## FROM → TO

```ts
// before — parsed green everywhere; the widget reads /discovery on its own
{
  type: 'mcp:connect-agent',
  properties: { serverUrl: 'https://example.test/mcp' },   // silent no-op: the widget reads nothing
}

// after — any key is a publish-time refusal naming the zero-prop surface;
// write the measured shape
{
  type: 'mcp:connect-agent',
  properties: {},
}
```

There is deliberately no automatic rewrite: a key authored on the widget
configures nothing and is removed, not renamed — behaviour that seems to need
one is a renderer capability request against objectui, not a metadata key.
`os migrate meta` surfaces the change as a structured TODO (semantic entry
`ui-mcp-connect-agent-unknown-keys-refused`, protocol major 18 — this refusal
is not part of the v17.0.0 cut).

<!-- adr-0087: registered ui-mcp-connect-agent-unknown-keys-refused -->
