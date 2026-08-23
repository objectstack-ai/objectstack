---
"@objectstack/spec": minor
---

feat(spec): retire the component-translation `submitLabel` copy key (#10926, ADR-0049)

<!-- adr-0087: registered translation-component-submit-label-removed -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

The `pages.<name>.components.<id>` copy face is measured, not mirrored: each
key exists because some component in `ComponentPropsMap` declares it.
`submitLabel`'s only declarer was `element:form`, and #9249 retired that
element whole — so the key had no declared component left to translate, and
the resolver overlay was its only reader. The maintainer ruled retire over
re-anchor (#10926): the live form surface (`object-form`) speaks `submitText`
(`I18nLabelSchema`), localizable at its own authoring site, so re-anchoring
would have widened the face for one word. The acknowledged cost is that the
bespoke-component route loses that one word.

**What is refused:** `submitLabel` in any `pages.<name>.components.<id>`
translation entry, and its `submit` alias spelling — both now land on a
`guidance` prescription in the strict unknown-key rejection (the face is
`.strict()`, so the strict-delete route applies: no `retiredKey()` tombstone,
the shape simply no longer declares the key).

**What stays:** the other five copy keys (`title`, `description`, `label`,
`placeholder`, `emptyText`), the bespoke-component route for them, and the
shared `PAGE_COMPONENT_COPY_KEYS` list (now five entries) that drives both
`translatePage`'s overlay and the CLI `i18n-extract` skeleton — one list, both
sides import it, so extractor and resolver narrow together.

The retirement kit:

- strict-delete at the schema (`packages/spec/src/system/translation.zod.ts`):
  key and `submit` alias dropped; `guidance` tombstones carry the prescription
- `PAGE_COMPONENT_COPY_KEYS` drops the slot
  (`packages/spec/src/system/i18n-resolver.ts`) — the resolver no longer
  overlays the key and the extractor no longer offers it
- ADR-0087 registration: D2 conversion
  `translation-component-submit-label-removed` (protocol 18), wired into the
  step-18 chain — `os migrate meta --from 17` strips the key from stored
  translation bundles and items (pure lossless delete; nothing read it since
  #9249)
- pin tests flipped, not deleted (`translation.test.ts` refusal pins assert
  the prescription; `i18n-resolver.test.ts` pins that an off-spec bundle entry
  carrying the retired key is ignored, not overlaid)
- generated baselines/docs follow the schema (json-schema manifest,
  spec-changes, upgrade guide, api-surface signatures, reference docs)

## FROM → TO

```ts
// before — a component-translation entry could carry a submit label
translations: [{
  'zh-CN': {
    pages: {
      sales_home_page: {
        components: { new_lead_form: { submitLabel: '创建' } },
      },
    },
  },
}]

// after — delete the key (nothing has read it since #9249); submit copy for
// the live form surface is authored on the component itself, where it is
// localizable inline
{
  type: 'object-form',
  properties: {
    objectName: 'lead',
    submitText: { en: 'Create', 'zh-CN': '创建' },
  },
}
```
