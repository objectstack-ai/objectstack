---
"@objectstack/spec": minor
---

`translatePage` now reads a region-level `page:header` by **page name only**. The id route
(`pages.<page>.components.<headerId>.*`) is no longer read for that component, even when it carries an `id`.

**Behaviour change, stated plainly:** a bundle that overrode a region-level header's title through
`pages.<page>.components.<headerId>.title` now falls back to `pages.<page>.title` (which itself falls back to
`pages.<page>.label`). The components key still parses — nothing is removed from `TranslationBundleSchema` — it is
simply no longer the address for this one component.

```
FROM  pages.<page>.components.<headerId>.title   # region-level page:header — no longer read
TO    pages.<page>.title                         # …and .subtitle for the subtitle
```

Fix in one line: move the string from the components entry up to the page's own `title` key, and delete the
components entry for that header id. `os i18n extract` has always offered exactly the `TO` key, so a bundle
generated or checked by the CLI already writes it.

**Blast radius, as measured on the card (inherited, not re-measured here):** HotCRM found **zero** such overrides —
all five of its region-level headers carry ids and none writes the components key.

**Why.** Both sides were deliberate and they disagreed. The extractor skips a region-level `page:header` on purpose
(its copy is offered under `pages.<page>.title` / `.subtitle`, and emitting it twice would put one string under two
keys); the resolver read the id route on purpose (the more specific route wins). Together they produced the exact
failure `walkAddressedPageComponents` was extracted to prevent — the resolver reading an id the extractor omits — so
the key an author reached for won silently while the key the tooling reported as translated lost. The maintainer
ruled (2026-09-06, decision batch #58, verbatim 「同意」) that the page-name route is canonical: one component, one
address. `title` and `subtitle` now follow the same rule, closing the asymmetry where `title` had two addresses and
`subtitle` — never in `PAGE_COMPONENT_COPY_KEYS` — had one.

Unchanged: a `page:header` **nested** inside a container is reached by the id route only, as it always has been; and
a region-level header's id still claims its bundle entry and still blocks a nested namesake, which is what the
extractor does too.

Not `major`: nothing an author can write is removed or renamed. `pages.<page>.components.<id>` remains a declared,
parsing, resolving address for every other component — including a nested `page:header` — so there is no key to
tombstone and no ADR-0087 conversion to register. Recorded here so the choice is checkable rather than assumed.
