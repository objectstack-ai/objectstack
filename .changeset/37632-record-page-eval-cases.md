---
'@objectstack/skills': patch
---

docs(skills): three `objectstack-ui` record-page eval cases grade what the record-page rule teaches

Clause-②: no
Metadata-protocol: none

Three cases of `skills/objectstack-ui/evals/record-page.json` failed an answer that follows `rules/record-page.md`. Case 4 (drop the Attachments tab) no longer requires `'sys_activity'`: with a declared `relatedLists`, unlisted approvals and the activity stream still follow, so `relatedLists: ['quote', 'opportunity_contact_role']` is the reference answer and the case requires `'opportunity_contact_role'` in its place. Case 1 (Tasks tab first) now asks in its prompt for only the open tasks (`status` is not `done`), which is what its required `relatedListFilter` grades; its reference answer lists `['task', 'event', 'sys_attachment']`. Case 3 (`placedActions: true` on `page:header`) forbids `actions: ['open` in place of `actions: ['`, so an answer that quotes the old id list in a comment is not failed. Each of the three has a new case hash, so `skill-evals --regrade` sets it apart from a round recorded before this change: compare it across rounds only after a re-run. No skill text changes.
