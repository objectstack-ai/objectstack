---
"@objectstack/metadata": patch
"@objectstack/runtime": patch
---

fix(metadata,runtime): retire the `policies` dead pointer in both artifact registrars, and pin the map that carried it (#12894)

Zero behaviour change, by construction. Both readers of an artifact boot carried
a `policies` -> `policy` entry — the artifact door's `ARTIFACT_FIELD_TO_TYPE`
(`packages/metadata/src/plugin.ts`) and `AppPlugin`'s ADR-0057 `SECURITY_FIELDS`
list (`packages/runtime/src/app-plugin.ts`) — and **neither could ever match**.
`ObjectStackDefinitionSchema` is a `strictObject` that declares no top-level
`policies` key, so a definition carrying a `policies` array is refused outright
by the door's strict parse and reaches neither registry. The word is real but
lives one level down: on a permission set `policies` is an alias for
`rowLevelSecurity` (`PERMISSION_SET_KEY_ALIASES`) — a key on an **item**, never a
collection. Both entries are removed, each leaving in place the note the map
already writes for a retirement: what it pointed at, and why it could not match.

That was the third entry retired from `ARTIFACT_FIELD_TO_TYPE` for exactly this
reason (`themes`, then `roles` -> `positions`, which "matched nothing and
silently dropped compiled positions"). So the deletion ships with the thing the
two predecessors did not have — a check that fails when the pattern recurs:

- `check:stack-collection-maps` now reconciles **eight** hand-maintained
  enumerations against the schema, not seven. `SECURITY_FIELDS` is the new
  eighth, and how it was missing is the finding rather than a footnote: it is
  the only one of the eight that pairs its keys as `[collection, kind]` tuples,
  which neither existing extractor could read, so the site was skipped rather
  than reported. Re-adding `policies` — or any other key the schema does not
  declare — to **either** registrar now fails the gate with the site named.
- A new `tupleFirstItems` extractor reads that shape, with a self-test case
  (13 assertions, up from 12) covering the comment/nesting cases the flat
  string-array extractor already pins.

The mirror-image half of the same measurement is **carried, not shipped**:
`capabilities` is a declared top-level collection that `SECURITY_FIELDS`
registers and the door's map does not, making `AppPlugin` its sole registrar on
an artifact boot. Adding it to the door changes what an artifact boot registers,
so it is measured and handed to the route-ownership decision (#12892) instead of
being smuggled in here. The new waiver row records the asymmetry in place.
