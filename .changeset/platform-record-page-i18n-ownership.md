---
"@objectstack/platform-objects": patch
---

The Setup record pages for User, Organization and Position now show a localized title, and their copy is under a gate for the first time.

`sys_user_detail`, `sys_organization_detail` and `sys_position_detail` reach the platform through plugin-auth and plugin-security, so they were in no `os i18n extract` config. Their page-level `label` therefore had no entry in any translation bundle, and the Setup record header rendered "User" / "Organization" / "Position" in every language. Those three keys are now translated in all four shipped locales (`en`, `zh-CN`, `ja-JP`, `es-ES`).

The ownership gap behind that is the part worth stating, because the instrument read as clean while it was open. `check:i18n-coverage` baselines this package at `0`, and that `0` meant "these pages are not in the population", not "checked, clean" — the same ambiguity, in the same baseline file, that once shipped four missing `zh-CN` Setup nav labels under a fully green build. Measured through the real extractor: the three pages offer exactly three keys between them, one page-level `label` each. All three author `regions: []` and put every component under `slots.*`, while the walk shared by the resolver and the extractor roots at `regions[].components[]` — so 45 further authored copy sites, every one an inline `{ en, 'zh-CN', … }` locale map, have no bundle face to be counted against.

`packages/cli/test/platform-page-i18n-parity.test.ts` now owns both halves from the other side: a `pages.*` bundle entry per shipped locale for every page the `@objectstack/platform-objects/pages` barrel exports, and a completeness check over every inline locale map on those documents — the half no extractor can reach. Both populations are read from the barrel and from the page documents rather than listed in the test, so a fourth contributed page joins the gate by existing, and a new section heading authored in English alone fails instead of shipping green.

No walk was widened and no baseline was moved. Whether the extractor should also see inline locale maps is a maintainer decision open on #14749; the inline map itself is the ruled authoring route, not a workaround.
