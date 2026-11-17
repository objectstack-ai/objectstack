---
'@object-ui/components': patch
'@object-ui/plugin-form': patch
'@object-ui/i18n': patch
---

feat(plugin-form): a sectioned form shows its sections as a navigation strip; a click scrolls to the section, and a section with errors carries the count

Clause-②: yes (widening — one @object-ui/components export + new @object-ui/i18n locale keys; no FormSchema or spec key)
Metadata-protocol: none

The new export is `FormSectionNavContext` with its `FormSectionNavItem` / `FormSectionNavSink` types; the new locale keys are `form.sectionNav` and `form.sectionNavErrors`. Nothing that worked before is refused.

A create or edit dialog whose form is stacked in sections now shows one entry per visible section between the title and the scrolling body; a full-page sectioned form shows the same strip above its sections, sticky at the top of the page. A click scrolls to the section, unfolding it first when it is collapsed, and the entry of the section in view is highlighted while the form scrolls. When a submit is refused, each entry shows how many fields in its section need fixing, and the count drops as the fields are fixed.

The strip appears only with two or more visible sections. A section hidden by its `visibleWhen` is not listed. A tabbed form keeps its tab strip and gets no section strip. Nothing is configured: no form, section or field key turns it on or off.

For hosts: the `form` renderer reports the section headings it draws, with each section's error count, to a sink provided through `FormSectionNavContext`; each heading row now carries a stable `id` and a `data-form-section` attribute naming its section.
