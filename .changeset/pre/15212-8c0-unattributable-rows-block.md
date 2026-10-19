---
'@objectstack/cli': minor
'@objectstack/plugin-sharing': minor
---

feat(cli,plugin-sharing)!: in the 17 → 18 ownership ceremony, a row whose owner cannot be derived blocks certification, and a declared-rule mirror's grants are renamed only onto a rule plugin-sharing serves

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No spec key, option, error code or stored shape is added, removed or renamed, and nothing exported is removed: the ceremony's report gains one field (`TableOutcome.held`), its verdict counts change, and plugin-sharing gains one export. The only stored state that moves is the operator's own: a row whose owner cannot be derived is given its organization or deleted by hand, which `objectstack migrate meta` has nothing to rewrite for. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no Zod schema in packages/spec changes (not runtime-interface-only or type-surface-only in the spec sense); and nothing exported is retired (not runtime-export-retired). -->

**BREAKING** (narrowings), shipped as `minor` under the launch-window convention for breaking changes.

- **FROM** (`@objectstack/cli`): `os migrate organization-ownership --apply` on a database holding a row whose owner cannot be derived exited `0` with `blocking: 0`, counted the row in `advisory`, and verified the `sys_migration` marker. This covers a reported (fate 4) row, and a row whose anchor is missing under a wall (fate 3). **TO:** it exits `1`, counts the row in `blocking`, and leaves the marker unverified, so a v18 `os serve` / `os start` does not start on the database. **Fix:** give each row its organization (write its `organization_id`, or repair the anchor its reason names), or delete it by hand, then re-run `--apply` with the same plan file.
- **FROM** (`@objectstack/cli`): a database an earlier version of this command certified while it held such a row was certified again by the next `--apply`. **TO:** that run leaves its marker unverified, for the same rows. **Fix:** the same as above.
- **FROM** (`@objectstack/cli`): `os dev`'s in-place upgrade of a development database started the server again whenever every ceremony step finished. **TO:** it starts it only when the post-check also holds nothing (`blocking` 0); otherwise it prints each table that holds, with its count and remedy, and the command that resumes the run. **Fix:** resolve the rows it names, then run the printed command.
- **FROM** (`@objectstack/cli`): the `mirror-deletion` step renamed the grants of a declared-rule mirror onto its rule's name, and deleted the mirror, even when plugin-sharing does not serve that rule (a condition that does not translate, an unmappable recipient, a retired owner-based rule); the next boot's orphaned-grant sweep then revoked those grants. **TO:** while `sys_record_share` grants name such a mirror, the step blocks, naming the rule, its rows and the reason, and writes nothing. **Fix:** correct the rule's declaration in its package so it is served, or delete each mirror row and the grants that name it, then re-run `--apply`.

`@objectstack/cli` — **unattributable rows hold certification (ADR-0131 D10 fate 4).** The ceremony still never guesses an owner for such a row and never deletes it. The post-check now holds each one against the verdict:

- Each table that holds one carries `held: { rows, remedy }` in the apply report, and counts those rows in its `remaining`. The terminal output names each table, its row count and the remedy.
- `advisory` now counts only the rows of an advisory departure and the reported rows of a table whose `organization_id` is not the tenancy anchor (`sys_sso_provider`, the retired `sys_scim_provider`). A row there that is bound to no organization is legitimate, is reported, and does not block.
- So a verified marker means no organization-less row on any table that the tenancy anchor governs.
- The plan's summary line says that such rows will hold `--apply`'s certification until they are resolved.

`@objectstack/cli` — **the ceremony asks plugin-sharing which declared sharing rules it serves.** The port the `mirror-deletion` step reads (`DeclaredSharingRulesPort.rules()`, formerly `names()`) judges each declared rule through plugin-sharing's own translation. A mirror's grants are renamed only onto a rule that is served. A mirror of a refused rule that no grant names is still deleted.

`@objectstack/plugin-sharing` — **exports `translateDeclaredSharingRule`** with its `DeclaredSharingRule` and `DeclaredSharingRuleSkip` types. It is the one translation enforcement serves a declared rule through. It is pure, and it is unchanged.
