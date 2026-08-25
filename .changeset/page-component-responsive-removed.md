---
"@objectstack/spec": minor
---

feat(spec): retire `page.components[].responsive` and the `ResponsiveConfig` layout vocabulary; repair every shipped text that prescribed it (#11027, ADR-0049 D2)

<!-- adr-0087: registered page-component-responsive-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

`page.components[].responsive` was the LAST carrier of the per-breakpoint
LAYOUT block (`ResponsiveConfig`: grid columns / visibility / display order on
the Tailwind `xs…2xl` axis) — and the destination the
`dashboard.widgets[].responsive` tombstone (#4876) prescribed verbatim as the
live alternative ("which objectui `useResponsiveConfig` really does read").
Measured across objectstack + objectui with the tsc-probe methodology
(positive and negative controls; objectui `3b147a367`, objectstack
`8d21f7a76`): that claim was false. objectui's two complete, published
implementations of the contract — `useResponsiveConfig` (`@object-ui/mobile`)
and `ResponsiveProtocol` (`@object-ui/core`) — had ZERO callers, nothing in
either repo read `.responsive` off a page component, objectui's own
`BaseSchema` node interface never declared the key, and zero authored
instances exist. An author following the shipped prescription moved an inert
key to an inert key and was told it now works. Identical disposition to
`view.responsive` (#3896) and `dashboard.widgets[].responsive` (#4876) on
identical evidence.

**What is refused:** an authored `responsive` on a page component. The key is
a `retiredKey()` tombstone, so authoring it is a `tsc` error and a parse error
carrying the prescription.

**What leaves with it:** `ResponsiveConfigSchema` / `ResponsiveConfig`,
`BreakpointColumnMapSchema` / `BreakpointColumnMap`,
`BreakpointOrderMapSchema` / `BreakpointOrderMap`, and the `BreakpointName`
enum — no other authorable carrier existed, and an exported value schema with
no consumer reads as a capability (#3950; the `PerformanceConfigSchema`
precedent). Importing any of them is TS2305 from this release.

**What stays:** `responsiveStyles` (ADR-0065, `ResponsiveStylesSchema` /
`StyleMapSchema`) — the per-breakpoint channel objectui really compiles to
id-scoped CSS — is untouched and is what every repaired text now points at.

The redirect repair (the reason this ships as one change): four author-facing
surfaces shipped the false redirect and are corrected together — the #4876
tombstone prescription (`dashboard.zod.ts`), the generated widget reference
page, the protocol upgrade guide prose, and the protocol-17 migration
rationale that `os migrate meta --from 16` prints. The `dashboard.json`
liveness note and the #4876 conversion summary carried the same claim and are
corrected too; `responsive.zod.ts`'s `hidden → hiddenOn` alias curation, which
justified itself by `useResponsiveConfig`'s return shape, leaves with the
schema that hosted it.

The retirement kit:

- `retiredKey()` tombstone at the schema (`packages/spec/src/ui/page.zod.ts`),
  prescription pointing at `responsiveStyles` with the CSS translations for
  `columns` / `hiddenOn` / `order`
- ADR-0087 registration: retired-key entry `ui/PageComponent:responsive`, four
  retired-def entries (`ui/ResponsiveConfig`, `ui/BreakpointColumnMap`,
  `ui/BreakpointOrderMap`, `ui/BreakpointName`), and the D2 conversion
  `page-component-responsive-removed` (protocol 18), wired into the step-18
  chain — `os migrate meta --from 17` strips the key from authored pages at
  every component position, region, slot, or nested container (pure lossless
  delete; it never had an effect to lose)
- pin tests (`page.test.ts` — refusal pin asserts the prescription; a positive
  pin parses a component without the key and asserts `responsiveStyles`
  survives; `dashboard.test.ts`'s #4876 pins now assert the corrected
  prescription instead of the false redirect)
- `ResponsiveStylesSchema` guidance for `columns` / `hiddenOn` / `order` now
  names the retirement and the CSS that IS applied, instead of prescribing the
  dead sibling key
- generated baselines/docs follow the schema (authorable surface, JSON-schema
  manifest, api-surface, export-origins, spec-changes, upgrade guide,
  reference docs, skill references)
- objectui's two dead consumer implementations are the other half of this
  measurement and are queued under objectui#4773 (this package's texts no
  longer point authors at them)

## FROM → TO

```ts
// before — parsed green; no renderer ever applied any of it
{
  type: 'element:text',
  id: 'kpi_label',
  responsive: {
    columns: { xs: 12, lg: 4 },
    order: { xs: 2, lg: 1 },
    hiddenOn: ['xs'],
  },
}

// after — express per-breakpoint behaviour as scoped CSS (ADR-0065), which
// objectui compiles and applies (desktop-first buckets)
{
  type: 'element:text',
  id: 'kpi_label',
  responsiveStyles: {
    large: { gridColumn: 'span 4', order: '1' },
    small: { gridColumn: 'span 12', order: '2' },
    xsmall: { display: 'none' },
  },
}
```
