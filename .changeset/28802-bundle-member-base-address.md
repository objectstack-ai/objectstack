---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: an email template locale added in a `<base>.custom` pair is listed and sent on the base's address, and a dependent's added locale is served only under its own package (#28802)

Clause-②: yes (narrowing)
Metadata-protocol: semantic

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no write is refused: the reads of a base's address now decide an email template member by member (ADR-0146 D2, ruling A on #28390). A stored dependent row under a base template's name is not converted: it stays served under its own package, the address the read naming that package and the list scoped to it already serve. -->

**BREAKING** read-side narrowing on a base's address, with one widening beside it. An email template is one item per `(name, locale)` (`ITEM_KEY_DISCRIMINATORS`), and since #28746 a locale the base does not ship is admitted as an addition, from the base's `.custom` pair (no `overrides`) and from a dependent package. The reads decided at name grain.

- **Widened.** The pair's own added locale is served on the base's address: the env-wide `GET /meta/email_template`, the list scoped to the base, `getMetaItemsForExecution` (which the email template loader reads) and the by-name reads naming the base or no package, stamped with the pair's id. So `renderTemplate` / `sendTemplate` in that locale renders the customer's template. It was read by name but never listed, so a send rendered the base's `en-US`.
- **Narrowed.** A dependent package's added locale under a base template's name is no longer served by the by-name reads naming the base or no package (`404`): those reads fell to the registry's cross-package first match (ADR-0048 §3.3) and answered the dependent's body. It is still served by the read naming the dependent and the list scoped to it; the base's lists already left it out.
- **Unchanged.** The base's own locales and the pair's declared overrides of them; the list scoped to the pair; the write gate (#28746); every type whose identity is its name alone.
