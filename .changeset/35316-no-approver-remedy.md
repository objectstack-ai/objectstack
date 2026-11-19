---
'@objectstack/plugin-approvals': patch
---

Clause-②: no
Metadata-protocol: none

fix(approvals): a request no one can approve tells its submitter and names the remedy

When an approval step resolves to no one who can decide it and no administrator other than the submitter can take it (an organization of one whose step sets `excludeSubmitter` is the common case), the request opened silently: no one was notified and the submitter saw only "Submitted". It now writes a note on its timeline, rendered in the reader's language, and tells the submitter under the `approval.comment` topic: "No one else can approve this request yet. An organization administrator must add a member who can approve it, then reassign the request to them." When the slate kept an unstaffed position, the note names it: "…must add a member who holds position 'legal'; that member can then decide it."

The submitter still cannot approve their own request, not even through the administrator override. When no one else is on the slate, the two refusals of that approval now end with the same remedy instead of "Another approver on the step decides it" / "An approver on the step decides it"; with another approver on the slate the text is unchanged. The `excludeSubmitter` note for that route no longer says a privileged override can decide it: it reads "…because this step sets excludeSubmitter, and no one else could take it."
