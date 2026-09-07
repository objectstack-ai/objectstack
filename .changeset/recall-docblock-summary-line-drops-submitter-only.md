---
"@objectstack/plugin-approvals": patch
---

Documentation: `ApprovalService.recall`'s docblock summary line no longer claims the submitter is the only actor.

The block opened with "Withdraw a pending request (submitter only)" and then, three paragraphs down, stated the #3424 privileged override correctly — "The #3424 privileged override reaches a PENDING request only (#12775, maintainer ruling 2026-09-02)". Both cannot be true, and the code settles it in the paragraph's favour: `overrideAdmits` short-circuits the non-submitter guard on a `pending` request. A reader who finishes the block is not misled, but the summary line is the one an editor shows on hover and the one any single-line extraction takes.

The summary line now reads "Withdraw an undecided request." — status is the axis and the actor rules are left to the paragraphs that already state them correctly, the same structural move the `IApprovalService.recall` docstring makes on the spec side.

Prose only: no guard, no branch and no signature changed. It earns a changeset rather than `skip-changeset` because `@objectstack/plugin-approvals` publishes `dist/`, and this text ships inside the published `dist/index.d.ts` for `ApprovalService.recall`.
