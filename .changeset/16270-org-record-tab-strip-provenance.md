---
'@objectstack/platform-objects': patch
---

Name where the organization record page's Members / Invitations / Teams tab strip is declared, at the three places that assert it (#16270)

#16270 measured that no object under `packages/platform-objects/src/identity/` declares
the `Field.relatedList` prominence key, and inferred from that a two-way disjunction:
either the metadata is short three `relatedList: 'primary'` declarations, or the three
documents that describe the page as opening on tab-0 **Members** have gone stale.

**Neither. The premise is false.** The tab strip is declared metadata —
`SysOrganizationDetailPage` in `packages/platform-objects/src/pages/sys-organization.page.ts`,
a `kind: 'slotted'` record page for `sys_organization`, `isDefault: true`, handed to the
runtime by plugin-auth's `pages: [SysOrganizationDetailPage, SysUserDetailPage]`. Its
`slots.tabs` override carries exactly three `record:related_list` tabs — Members,
Invitations, Teams, in that order — and objectui's synthesizer pushes that authored node
and never calls `buildDefaultTabs`, so the strip replaces the synthesized
Details + stacked `Related` one outright and Members really is at index 0. That file was
already in the tree at the commit the card measured.

`relatedList: 'primary'` is a different mechanism (prominence on a child's lookup field,
promoting one derived list to its own tab). The card looked for that key, correctly found
none, and read the zero as "declared by no metadata". While the `tabs` slot is present,
adding the key would not move this page at all.

**What changes here is prose only — no metadata, no behaviour.** The two source comments
that assert the tab order and the QA checklist item that grades it now name the page that
declares it, so the next reader does not repeat the measurement:

- `packages/platform-objects/src/identity/sys-member.object.ts` — the `invite_user`
  mirror's rationale
- `packages/platform-objects/src/identity/invite-entry-toolbar.test.ts` — the file header
  that states the whole pin's premise
- `docs/qa/platform-checklist/areas/identity-auth.json` —
  `identity-auth.org-membership-team-management`, a new `source` entry plus the revision
  and history bump its ledger requires. Steps, acceptance clauses, oracles and negatives
  are unchanged: a grader grades exactly what it graded before, and now knows that a
  Details + stacked `Related` strip means this page failed to load rather than that the
  clause was wrong.

This package ships its `src` comments in `dist` (measured: the new comment text appears
4 times under `packages/platform-objects/dist`, with an exported symbol as the positive
control and the test-file header absent at 0), which is why a comment-only diff here
takes a changeset rather than the publishes-nothing exemption.
