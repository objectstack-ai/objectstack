---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): the All metadata area marks a base's customizations, filters to them and counts them

Clause-②: no
Metadata-protocol: none

In Studio's All metadata area (ADR-0146 D3, "On top, one surface"), an installed base's lists now show its own items and the items of its paired `BASE.custom` package together. Every mark and number comes from the server's customization read, `GET /api/v1/packages/:id/customizations`. Nothing is computed from the documents: there is no diff and no `basedOn` verdict.

- **Marks.** An item the read lists as an override is marked "Customized (BASE)". For a type identified by name and member, such as an email template's locale, only that member is marked. Any other item of the pair is marked "Added". The base's other items carry no mark.
- **Filter.** Each list offers "Only customizations (n)" once the read has answered and the base has a customization.
- **Counts.** Each directory tile shows how many items of its type the read lists as overrides. The object tile also counts the extension members (fields, validation rules, indexes). The directory header shows the base's total, the served overrides plus the served extensions, which is the landing's "customized" figure.
- **Pending or failed read.** While the read is pending, or after it fails, the area draws no mark, no filter and no number, never a "0". A failure shows the server's sentence. A base with no pair is unchanged, and so is Setup, which makes no customization read.
- **Across packages.** In `/studio/~all/metadata`, an item of a `BASE.custom` package is labelled "Customization of BASE".
- **One mark component.** `CustomizationMark` (`views/studio-design/CustomizationMark.tsx`) draws these marks for the whole console, and the pillar rails will reuse it. `fetchPackageCustomizations` returns the read in full, and `fetchPackageCustomizationCounts` (the landing's reader) now uses it.
