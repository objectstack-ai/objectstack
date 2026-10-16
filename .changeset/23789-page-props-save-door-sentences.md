---
'@objectstack/spec': patch
---

docs(spec): the step-18 upgrade text and the `exportOptions` TSDoc say a stored page's next save meets the component-props gate at the metadata save door

Clause-②: no

Text only; no accept set moves. Since the component-props gate (`validateComponentProps` / `validateComponentTypes`) runs on a `page` write at the metadata save door, three step-18 semantic entries that `os migrate meta` and the protocol upgrade guide print — `ui-page-action-row-operation-declared`, `ui-object-block-grouping-config-typed` and `element-text-variant-heading-subheading-retired` — and the `object-grid` `exportOptions` TSDoc in the `.d.ts` still said a page component's `properties` is not parsed on the save path. They now say what runs: a stored page still loads, because `properties` is not parsed on the metadata load path, and the next save of the page meets the component-props gate at the metadata save door (422 `INVALID_METADATA` on a finding), beside `os validate`, `os build` and `os lint`.
