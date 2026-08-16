---
"@objectstack/spec": patch
---

fix(spec): correct stale `/console/…` route spellings to `/_console/…` in JSDoc comments on `FormViewSchema.submitBehavior` (view.zod.ts) and the `type: 'form'` action target doc (action.zod.ts) — the mount is `CONSOLE_PATH = '/_console'`, no bare `/console` route resolves. Comment-only; accept/reject behaviour is unchanged (#9078)
