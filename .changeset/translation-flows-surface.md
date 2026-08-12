---
"@objectstack/spec": minor
---

feat(spec): give TranslationBundle a `flows` surface for screen-flow wizard copy (#7646)

A `type: 'screen'` flow is a wizard the user reads — a heading, a list of
labelled inputs — and the translation bundle had no group for any of it. Not a
drifted key: **no key**. The bundle's surfaces were objects, apps, dashboards,
pages, settings and metadata forms, so a translator had nowhere to put a screen
title or a screen field label, and the strict shapes (correctly) refused
whatever group they invented. HotCRM finished all four locales and retired its
i18n exemption ledger, and its `lead_conversion` wizard still rendered
"Conversion Details / Create Opportunity? / Opportunity Name" in English on a
zh-CN console.

**New group — `flows`**, alongside the existing ones on both doors (the
file-authored bundle and the `translation` metadata item, which share one
shape):

```
flows.< flow_name >.label
flows.< flow_name >.screens.< node_id >.title
flows.< flow_name >.screens.< node_id >.fields.< field_name >.label
flows.< flow_name >.screens.< node_id >.fields.< field_name >.placeholder
```

Minor rather than patch because the accepted authoring surface widens: a bundle
that was previously rejected for carrying `flows` now parses.

**The addressing is the runner's own, not a second naming scheme.** Each level's
key is an identifier some consumer already holds at render time — the flow's
machine name (`Flow.name`), the screen node's id (`FlowNode.id`, forwarded to
the client verbatim as `ScreenSpec.nodeId`, which is also what correlates a
resume back to its pause point), and the screen field's name
(`ScreenFieldConfig.name`, forwarded as `ScreenFieldSpec.name`). A surface keyed
by names nothing produces would parse clean and translate nothing.

**The key face is measured against the flow schema, not mirrored from the
report.** `label` and `placeholder` are declared because a screen field declares
them; `help` is not — `ScreenFieldConfigSchema` has nothing help-shaped at all,
so declaring it would be a slot that validates and never renders (the ADR-0078
shape #6080 kept out of the page-component face). It rides the unknown-key
`guidance` instead, next to `options`, which cannot be addressed by a
value-keyed map because `ScreenFieldConfig.options[].value` is unconstrained.

**Runner chrome stays out.** The wizard's Cancel/Submit buttons are the
console's own words in every app; they belong to its message catalog, not to a
per-app bundle that would ask every app to re-translate the platform.

This is the spec half of a contract-first split: the group is declared and
closed, and no shipped screen-flow runner reads it yet. The `flows` row in
`packages/spec/liveness/translation.json` is `planned` and carries an author
warning saying so.
