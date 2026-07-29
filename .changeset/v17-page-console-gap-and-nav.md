---
---

Docs-only: close two gaps in the v17 release page and make the Releases section
reachable from the sidebar again. Releases nothing.

**The Console section was missing 25 objectui commits.** The v17 frontend window
is `cf2d56e32a11` (what 16.1.0 pinned) → `4a4829d0ef39` = 128 commits, but the
pending `console-*.md` changesets only covered 103 of them: the range
`2cb8d78e24ad...c6cfdf1288b6` landed with no changeset, which is exactly the
"a SHA bump leaves no trace" failure `scripts/bump-objectui.sh` exists to
prevent. Two of the missing commits are breaking, and both are the frontend half
of a backend change the page already documented — so the page described one side
of each and omitted the other:

- `useClientNotifications` loses its dead device/preference delegates
  (objectui#2862), the companion to the SDK removal in #3612
- `@object-ui/types` drops the Capabilities re-exports (objectui#2860), the
  companion to the retired capabilities-descriptor cluster

Both now appear beside their backend halves and in the upgrade checklist, along
with the other eight substantive commits (effective-operation-set gating on
detail/form, approver record lookups, `{current_user_id}` in widget filters, org
switcher as write context, system-settings i18n, image click-to-zoom, import
email validation, flow-node repeater render fix) and the three major build-dep
bumps. `.changeset/console-c6cfdf1288b6-backfill.md` records the range itself so
the history no longer has a hole.

**`releases` returns to the root sidebar.** #3423 took References and Releases
out of the tree as a decluttering pass, on the stated basis that "URLs still
resolve and the docs home page links both". That trade holds for References (22
generated pages) but reads poorly for Releases during a release window, when
finding the upgrade notes is the reason someone opened the docs. References stays
out.

**First v17 docs sweep** (`docs/v17-docs-sweep.md` — playbook + append-only run
log, designed for re-runs while the RC train keeps accumulating changesets).
Run 1 fixed the drift v17 left in hand-written prose: `services-checklist`
(17→16 services, graphql rows, the dissolved `ObjectStackProtocol`),
authorization/permissions pages still describing `/graphql` in the
anonymous-deny matrix and owner/`group` sharing shapes as "declared but not
enforced" (they no longer parse), `http-protocol` claiming `enable.trash`
exists, "REST/GraphQL" in objectql diagrams/prose, and the `objectstack-api`
skill description (mirrors regenerated via `gen:skill-docs`).

**`check-release-notes` now checks what it claims.** Its success line said every
release page is "navigable" while it only ever read the section's own
`meta.json` — it could not see that the section had been unlisted from the root
nav, so it stayed green for the entire period the whole section was absent from
the sidebar. It now also requires the section to be reachable via the root nav
**or** a `/docs/releases` link on the docs home page: either satisfies it, so
#3423's trade remains available, but losing both now fails the build.
