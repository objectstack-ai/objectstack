---
"@objectstack/spec": minor
---

feat(spec): declare `record:alert` / `record:quick_actions` / `record:history` / `record:discussion` in `ComponentPropsMap` — undeclared keys on the four are refused (#8744)

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

These were the four `record:*` types #8691's rail fix left in the rail's own
pre-fix position: a registered objectui renderer, a `PageComponentType` entry
and a console palette slot (bar `record:discussion`, which was authorable only
through the type union's open string arm), and no `ComponentPropsMap` row — so
the #5068 component-props gate's dispatch skipped them as unregistered and
every authored key rode through. A typo'd `severty` on the platform's own
banner surface parsed, typechecked, validated, built and shipped as a silent
no-op while sibling components in the same file drew loud diagnostics.

The new rows are strict and declare exactly what the renderers read, measured
from their read points at the objectui pin — not from the registrations'
declared-input lists, which are wrong in both directions here:

- `record:alert` — `severity?`, `title?` / `body?` (string **or inline locale
  map** — this renderer resolves both through `pickLocalized`, the opposite
  verdict from the rail's literal-string `title`, measured the same way),
  `visible?` (boolean | CEL string | `{ dialect, source }` envelope), `icon?`
  (read here, unlike the rail's), `action?` `{ actionName, label?, variant? }`,
  `dismissible?`, `dismissKey?`. `visibleWhen` / `visibility` rename to
  `visible` as aliases — this is the one record component whose props-level
  predicate is real, so the wrong-layer visibility guidance does not apply.
- `record:quick_actions` — `actionNames?`, `requiredPermissions?`, `location?`
  (the spec's own `ActionLocationSchema`, retirement prescriptions included),
  `align?`, `inline?`, `variant?` / `size?` (the Button primitive's delivered
  vocabulary). `actions` is refused with a prescription (as a name list it is
  `actionNames`; as inline defs it is the host synthesizer's runtime channel).
  `aria` is refused rather than declared: the renderer reads `aria.label`, a
  spelling the shared `AriaPropsSchema` refuses, and reads nothing else of the
  bag — declaring either spelling would be declared-but-unenforced surface
  (the renderer-side fix is objectui's, filed).
- `record:history` — `limit?`, `emptyText?` / `unknownUserText?` (literal
  strings — the timeline renders them raw; a locale map would paint
  `[object Object]`). `entries` / `loading` are refused as the host's data
  channel: omit them and the block self-fetches the record's `sys_activity`
  history.
- `record:discussion` — `record:chatter`'s own row, deliberately the same
  schema object (one renderer registered under two names must keep one accept
  face), plus a `PageComponentType` entry so the name is no longer a
  string-arm stowaway.

**What stays accepted:** every declared key byte-identically — the platform
`sys_user` page's banner and self-service action bars and the showcase task
page pass with zero findings. No row carries a schema default (renderer
fallbacks stay the renderer's facts). The one parse-time normalization is
`ExpressionInputSchema`'s own: a bare-string `visible` becomes the canonical
`{ dialect: 'cel', source }` envelope.

## FROM → TO

```ts
// before — parsed green everywhere; the banner styled itself `info` anyway
{
  type: 'record:alert',
  properties: {
    severty: 'warning',        // silent no-op typo
    title: 'Awaiting review',
  },
}

// after — the typo is a publish-time refusal naming the rename; write the
// measured shape
{
  type: 'record:alert',
  properties: {
    severity: 'warning',
    title: 'Awaiting review',
    visible: "record.status == 'in_review'",
  },
}
```

There is deliberately no automatic rewrite: an undeclared key is either a
spelling of a declared one (the rejection names the rename) or names a
capability the renderer does not deliver, and blessing either would be
declared-but-unenforced surface (ADR-0078). `os migrate meta` surfaces the
change as a structured TODO (semantic entry
`ui-record-blocks-unknown-keys-refused`, protocol major 18 — this refusal is
not part of the v17.0.0 cut).

<!-- adr-0087: registered ui-record-blocks-unknown-keys-refused -->
