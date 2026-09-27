---
"@objectstack/spec": minor
"@objectstack/cli": minor
---

**Clause-②: yes (widening)** — a new member (`type: 'doc'`) on the published, strict navigation-item union, and a new exported schema (`DocNavItemSchema`), so the accept set an app author writes against grows. Nothing previously admitted is refused: the `docs/nav-target` build rule judges only `doc` items, which no stack could carry before. Contract-review tier.

A documentation entry on the app menu: the new `type: 'doc'` navigation item (`DocNavItemSchema`, ADR-0046) targets a `book` and/or a `doc`, and at least one is required.

```ts
{ id: 'nav_help', type: 'doc', label: 'Help Centre', book: 'crm_manual' }        // opens the book
{ id: 'nav_guide', type: 'doc', doc: 'crm_lead_guide' }                          // opens that page
{ id: 'nav_both', type: 'doc', book: 'crm_manual', doc: 'crm_lead_guide' }      // that page, in that book
```

- **`book` alone** opens the book at its first readable page with the book sidebar. Membership is derived by the book's group rules, so a doc added later that matches a rule appears under the entry with no navigation edit. The package id also names a book — the package's implicit book.
- **`doc` alone** opens that page; its book context is the doc's own book, else the package's implicit book. `doc` is a doc NAME (the source filename stem, lowercase snake_case): `crm_lead_guide.md` or `docs/crm_lead_guide` is refused.
- **Neither** is refused when the app is parsed, with a message naming both keys. The rule also reaches the published JSON Schema (`json-schema/ui/DocNavItem.json`) as an `anyOf` of `required`, so a validator reading the schema refuses the same shape.
- **Audience**: the entry has no gate of its own — it inherits the docs audience gate. A `book` entry shows the member only the pages they may read, and is not shown to a member who may read none; a `doc` entry the member may not read is not shown. `visible` / `requiredPermissions` can only narrow that further.
- **`os build` / `os validate` / `os lint`** refuse a `doc` entry whose `book` or `doc` names nothing in the package (new rule `docs/nav-target`, with a did-you-mean). This runs in the docs step because that is where docs from `src/docs/*.md` join the artifact. It checks app `navigation`, `areas[].navigation` and `manifest.navigationContributions`.
- Near-misses are answered: `docName` → `doc`, `bookName` → `book`, and `book` / `doc` written on another item type points at `type: 'doc'`.

The console renders the new entry in a later objectui release; until then a `doc` item parses and publishes, but the menu does not show it.
