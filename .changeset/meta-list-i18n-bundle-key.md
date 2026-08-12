---
"@objectstack/metadata-protocol": patch
"@objectstack/metadata-core": patch
"@objectstack/objectql": patch
---

fix(metadata-protocol): keep every i18n bundle member through the `/meta` list merge (#7774)

#7730 taught the `SchemaRegistry` that an `email_template`'s identity is
`(name, locale)`, so `listItems('email_template')` returns every member of a
declared i18n bundle. `GET /meta/<type>` then merges that listing with two
higher layers, and both merges keyed by `(package, name)` with no
discriminator — so the bundle survived registration only to collapse one layer
later, and the list served a single locale.

**Both merges now key on the pair.** `metaItemKey` takes an optional third
component and `mergePackageAwareOverlay` buckets per slot rather than per name;
both derive the value from the shared discriminator table, and both are
byte-identical for a type that declares no discriminator — which is every type
except `email_template` today.

- **The MetadataService merge** is the path the issue named: with a `metadata`
  service installed and answering non-empty for the type, the second member's
  `Map.set` overwrote the first.
- **The `sys_metadata` overlay merge** was predicted to need no change, on the
  ground that overlay rows are unique on `type+name+organization_id+package_id`
  and carry no locale column. That is true of the rows and beside the point:
  the base of that merge is the registry's bundle, so bucketing by bare name
  dropped a locale as soon as a single overlay row existed for the type — and
  the row that survived was the overlay body, whichever member it customizes.
  An overlay (or a draft preview) now lands on its own locale member and the
  rest of the bundle is served untouched. Across the env-wide and org tiers,
  rows that customize different members are likewise two slots instead of one;
  org-over-env precedence is unchanged within a member.

**The discriminator table moved to `@objectstack/metadata-core`.**
`ITEM_KEY_DISCRIMINATORS` was declared in `@objectstack/objectql`'s
`registry.ts`, and `@objectstack/objectql` depends on
`@objectstack/metadata-protocol`, so the protocol package could not import it
without closing a dependency cycle. metadata-core is the package both already
depend on and depends on neither — the same criterion that sank the engine
write-verb dispatch predicates (#5619) and the audit-field governance table
(#4513) there. **No public surface changes:** `registry.ts` re-exports
`ITEM_KEY_DISCRIMINATORS` under its original name from its original module, so
every existing import keeps working; `@objectstack/metadata-core` gains it plus
`readDiscriminatorValue` / `itemDiscriminator` as additive exports. The
registry's storage-key *format* (`name@<locale>` composite keys and their
parser) deliberately did not move — it encodes the registry's own Map keys,
which no other package reads.

For an app this is Studio's metadata list and `GET /meta/email_template`
showing both the en-US and the zh-CN copy of a template instead of whichever
one the merge happened to keep.
