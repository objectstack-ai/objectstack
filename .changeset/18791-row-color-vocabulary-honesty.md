---
'@objectstack/spec': minor
---

fix(spec): `rowColor`'s own prescription stops handing authors the one spelling the renderer drops (#18791)

Clause-②: yes

`RowColorConfigSchema.colors` advertised `Map of field value to color (hex/token)`.
The only renderer — objectui `plugin-grid`'s `useRowColor` — hands a `bg-`-prefixed
literal through untouched, otherwise lower-cases and trims the value and resolves it
through its own closed vocabulary of colour NAMES, and returns `undefined` for
everything else. A hex is not a key, and Tailwind v4 has no runtime, so no class can
be fabricated from one.

The `view/row-color-without-colors` diagnostic checks PRESENCE only, so every link in
the chain was shipping code except the author's step: the gate fires, **the gate
itself hands the author a hex**, the hex parses, publishes, turns the gate green, and
colours nothing. A control whose own prescription switches it off. Measured, not
argued: #18787's reverse-verification leg B swapped four colour names for the four
hexes the `priority` field already declares — the app-local resolvability arm went red
naming all four while the presence arm stayed green.

Three things change, none of which moves an accept set:

- **The describe** now names the two spellings that actually reach a class, and names
  a hex only as the thing that does not. An author who comes to ask "can I paste the
  option colours in?" now finds the answer instead of an invitation.
- **The `fix` string** the presence diagnostic emits prescribes a resolvable colour
  name. `token` went with the hex: read as the renderer's colour names it was still
  standing beside hex as an equal alternative, and putting a bad option first is as
  harmful as offering only the bad option. The string is pinned by feeding the value
  it suggests back through `checkViewCompleteness`, so the prescription can only ever
  name something the new rule below accepts.
- **A new author-time warning, `view/row-color-unresolvable-value`**, reports values
  the resolver drops. This is the half presence-only structurally cannot see: a hex
  map CLEARS the `!config.colors` guard, which is exactly what silences the older
  rule.

The new rule judges the SHAPE a value has, and deliberately does not transcribe
objectui's 23-entry map. Two structural facts about the resolver are enough and
neither depends on what the map contains: the `bg-` branch tests the raw value, and
every key is a bare lower-case word matched after `toLowerCase()` and `trim()`. So a
value that is neither `bg-`-prefixed nor a bare alphabetic word once normalised cannot
be a key, whatever the map holds. That makes the rule **sound** — it never accuses a
value the renderer would have resolved, including `'RED'` and `' red '` — and
deliberately **incomplete**: an unknown colour name such as `chartreuse` is shaped
like a key and is passed, pinned as a NON-rule. A hand-copy of another repo's
vocabulary is a second opinion that drifts silently in both directions, and where the
vocabulary should be declared so the two sides cannot drift is a cross-repo question
this change deliberately does not answer.

Not breaking, and measured rather than assumed: the finding is `warning` severity,
like its sibling. `partitionFindings` routes everything that is not `error` to
advisories, so `os build` / `os validate` / `os lint` still exit 0, and the
registration-time twin in `@objectstack/objectql` is field-only and warns without ever
throwing. Nothing that builds today starts failing. Blast radius measured over this
repo, the five example apps and objectui at the pinned `.objectui-sha`
`53ded82bf7a494f54e344e19099dbf00854b8694`: **zero** authored `colors` maps carry an
unresolvable value — the one shipped map, `examples/app-showcase`'s task grid, spells
all four values as colour names and resolves clean.
