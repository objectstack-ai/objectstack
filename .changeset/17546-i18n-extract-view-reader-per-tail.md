---
'@objectstack/cli': patch
---

`pushViewEntries`' docblock names the reader of each `_views.<view>` tail separately, instead of one browser-side symbol for all three

The docblock above `pushViewEntries` (`packages/cli/src/utils/i18n-extract.ts`)
attributed every tail it emits to a single client-side reader, verbatim: *"the
convention the runtime resolver reads (`viewLabel` / `viewDescription` /
`viewEmptyState` in @object-ui/i18n)"*. Measured on the tree this changeset lands
on, the three tails have three different readers and the sentence was wrong about
two of them:

- **`label` is read on BOTH sides.** `resolveViewLabel`
  (`packages/spec/src/system/i18n-resolver.ts:403`) via `translateView` (`:907`),
  registered as `view:` in `METADATA_DOCUMENT_TRANSLATORS` (`:991`) from which
  `TRANSLATABLE_METADATA_TYPES` is derived (`:1008`) and read at the REST
  metadata boundary (`packages/rest/src/rest-server.ts:363`); and
  `useObjectLabel().viewLabel` client-side.
- **`description` is read SERVER-SIDE ONLY**, by `resolveViewDescription`
  (`:424`, called at `:908`). objectui#7219 removed the
  `useObjectLabel().viewDescription()` member. So the old sentence pointed a
  reader at a symbol that no longer exists, for a key that is still resolved and
  whose resolved value still reaches the screen as the `description` on the
  served view document.
- **`emptyState` is read CLIENT-SIDE ONLY.** `emptyState` has zero occurrences in
  `i18n-resolver.ts` — against 90 occurrences of `description` in the same file
  on the same instrument — and `resolveViewEmptyState` has zero occurrences
  tree-wide, with `resolveViewLabel` present as the control.

**Why the inversion is worth a block rather than a word swap.** A reader who
checked the old prose for `description`, found no such client-side helper, and
concluded the key was inert would be exactly wrong — and that conclusion was
drawn once already. The block now states which side reads each tail, so the
answer does not have to be reconstructed from two other packages.

The second clause was re-checked rather than carried over, and it is true: the
shipped platform bundle does carry `sys_user._views.all_users.label`
(`packages/platform-objects/src/apps/translations/en.objects.generated.ts`).
Across all nine shipped `en.objects.generated.ts` bundles, `_views` blocks carry
`label` leaves and no `description` leaf, so naming `.label` there is exact.

`viewLabel` and `viewEmptyState` are **not** retired — objectui kept the
`viewSuffixes` helper all three shared and dropped only the `'description'` tail
passed to it — so the block says that too, to stop the next reader
over-applying objectui#7219 and deleting two current citations.

No behaviour changes: the emitted key set, the walk and every exported signature
are byte-identical. This is a `patch` and not `skip-changeset` because
`@objectstack/cli` builds with plain `tsc`, so the JSDoc is emitted into
`dist/utils/i18n-extract.js` — inside the package's `files[]` — and the false
sentence is text an upgrading agent can grep in the published tarball.
