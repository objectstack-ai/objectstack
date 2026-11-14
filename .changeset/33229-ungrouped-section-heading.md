---
'@object-ui/i18n': patch
'@object-ui/plugin-form': patch
---

fix(console): the fields no declared field group claims render under their own "Other" heading after the declared groups, on the record page, the record drawer and the form arms (#33229)

Clause-②: yes (widening) — `@object-ui/i18n` adds the pack key `common.ungroupedSection` in every shipped locale ("Other" / 「其他」), and `@object-ui/plugin-form`'s `deriveFieldGroupSections` takes an optional third argument, the heading of its trailing bucket. Nothing is removed or renamed; a caller that passes no heading gets the sections it got before.
Metadata-protocol: none

`deriveFieldGroupLayout` (`@objectstack/spec/data`, ADR-0085 §5) ends an object's grouped layout with a keyless bucket holding every visible field no declared group claims. It exists only after at least one declared group. The Console drew it with no heading, so its fields read as members of the group above it, and when that group was collapsed they looked like its hidden contents.

- **Record page and record drawer** (`RecordDetailView`, the same view embedded in the drawer and the split pane): the bucket's primary section is a titled card headed with the translated `common.ungroupedSection`; long-form fields still drop into "More details" after it.
- **Forms** (`ObjectForm`, `ModalForm`, `DrawerForm`, on the no-sections field-group fallback): the bucket gets a divider row headed the same way, so the one row rule draws it as its own section.
- **Unchanged:** an object that declares no field groups (no grouping applies, the layout is flat, no heading is added); a page or form view that authors its own sections; the spec, which keeps the bucket keyless. The heading is a presentation default the Console owns, not an authorable key.
