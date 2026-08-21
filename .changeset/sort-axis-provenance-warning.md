---
"@objectstack/lint": minor
---

The SORT axis now asks the #8116 provenance question about a name the blanket
`SYSTEM_FIELDS` union told it not to flag — new rule `sort-field-unprovisioned`
(#10474), the twin of `searchable-field-unprovisioned` on the identical index
(#8404).

`validate-sortable-fields` consulted the union and stopped there, so a list view
ordering by a registry-injected anchor on an ADR-0015 `external` object was
skipped in silence. The #8999 consumer census recorded that gap with the reason
that such an object never reaches the union branch at all — skip (2) was believed
to catch it. **That reason was measured wrong.** `declaredFieldTarget` returns
`null` on exactly one condition (`fields` missing, unreadable, or naming
nothing) and nothing in it tests `external`, so the shipped shape — a federated
object that declares a mapped field map, as `examples/app-showcase`'s
`showcase_ext_customer` does — is indexed like any other object and lands
squarely in the skip. The census ledger entry now carries the correction rather
than the inherited reason.

Why the authoring gate is the only door available for it: both runtime doors on
this axis judge `formula` alone (`UNMATERIALIZED_SORT_TYPES`) — the REST ingress
`assertSortFieldsExist` (#6994) and the engine's `assertOrderByIsMaterializable`
(#7095). An injected anchor is a `datetime` or `lookup`, it *is* in `gate.known`
because the registry injected it into the served schema, and it is undotted, so
it clears every verdict and reaches the driver. Measured with a real `SqlDriver`
over better-sqlite3, the object declared exactly as the showcase declares it,
against a remote `customers` table carrying `[id, name, email, region,
lifetime_value]` and none of the seven injected anchors:

```
orderBy name       asc -> [c1,c2,c3]   desc -> [c3,c2,c1]   (a real column: reverses)
orderBy created_at asc -> [c1,c2,c3]   desc -> [c1,c2,c3]   asc === desc, 3 rows, no error
orderBy owner_id   asc -> [c1,c2,c3]   desc -> [c1,c2,c3]   asc === desc, 3 rows, no error
```

`asc` and `desc` byte-identical while the baseline reverses is what makes it a
dropped sort rather than a coincidence — the same signature this rule already
records for `formula`, reached by a second route, except that a formula sort is
refused at both doors and this one is not. A list view ordered by an anchor with
no storage answers `200` with the rows in the driver's arbitrary order, on the
view's first fetch and every fetch after it, which `limit`/`offset` then slice
into an arbitrary page.

`warning`, never `error` and never gating (#4330's cost asymmetry, the call every
sibling makes): the remote schema is invisible to this pass, so the remote table
may genuinely carry a `created_at` of its own. Declaring that column — the first
remedy the shared hint prescribes — silences the finding, because
`unprovisionedInjectedColumnsFor` excludes an author-declared column of the same
name (#7859's security direction). The runtime publish gate sorts on severity, so
this lands as an advisory and refuses no write.

Two deliberate narrowings, both pinned:

- **Undotted names only** — the one place this axis departs from the SEARCH twin.
  `resolveSearchFields` matches by exact string and drops a dotted entry like a
  typo, but a dotted SORT name is refused by the ingress gate as its own verdict
  (`400 INVALID_SORT`, loudly, on every fetch), so the silent degradation this
  finding reports cannot happen there. Answering would give the SORT axis its own
  dotted verdict, which is exactly the posture the rule shares with the FILTER
  and PROJECTION axes (#4256 / #7532 / #7589) and declines to break.
- **`checkSortDeclaration`'s new anchor-index parameter is optional**, with the
  same meaning `checkSearchableFieldList`'s carries: an out-of-repo caller that
  never built the index keeps its pre-#10474 answers. Every in-repo caller passes
  it.

Also re-ruled, with fresh eyes and on evidence rather than inheritance:
`validate-translation-references` still correctly asks nothing. It reads the
union at exactly one site (the `fields.<name>` orphan test), and the key it
decides about is derived from the *registered* metadata, into which the registry
injects the anchor on a federated object just as on a local one — so the key
resolves and the label renders. Warning there would flag a translation that
works. The blank-column consequence belongs to the surface that renders the
anchor (`validate-page-field-bindings`, #8340), not to the bundle that names it.
