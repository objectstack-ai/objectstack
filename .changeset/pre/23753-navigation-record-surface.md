---
'@objectstack/skills': patch
---

docs(skills): the `objectstack-ui` navigation rule states the derived record surface per flow — viewing routes to a page, creating or editing opens a modal bounded on desktop and full-screen on mobile, a light record uses a drawer (#23753)

Clause-②: no

`skills/objectstack-ui/rules/navigation.md`'s Surface bullet said a field-heavy object opens create/edit/detail as a full page and that mobile always pages. The platform's derivation (`deriveRecordFlowSurface` in `@objectstack/spec`) routes only the `view` flow to a page; the create, edit and child task flows never route — a field-heavy record, or any record on mobile, opens them in a modal that is bounded on desktop and full-screen on mobile, and a light record on desktop opens every flow in a drawer. The bullet now states that mapping and names the override only where the spec declares it: `navigation.mode` on the list view (`navigation` is not an object key). Text only; nothing an author writes changes.
