---
'@objectstack/skills': patch
---

fix(skills): four objectstack-platform eval cases agree with their own `must_not_contain` assertions

Clause-②: no
Metadata-protocol: none

- **Before.** In `skills/objectstack-platform/evals/config-plugins-ops.json`, four cases refused a string their own `expected_output` spelled: eval 1 `tableName`, eval 2 `data:beforeInsert` and `onInstall`, eval 4 `@objectstack/adapter-`, eval 7 `role:` and `admin_full_access`. Graded against those assertions, the reference answer itself scored wrong, so the eval could not tell a good configuration, plugin or operations answer from a bad one.
- **Now.** Judged per case from the skill text. Eval 1 narrows its assertion to the key spelling `tableName:` (the skill's own warning, "never set `tableName`", names the bare word; the wrong form is the key beside `workflows:` / `approvals:`). Eval 2 says "a `data:*` kernel hook registers and never fires" and "no install / enable / disable hooks" instead of spelling the phantom hook and method. Eval 4 says "no `adapter-*` packages exist". Eval 7 names the refused alias as `role` (the key spelling `role:` stays refused) and says "no platform set" (the skill's term for a set such as the refused platform-admin one). No assertion is deleted, no case added or removed; the file shrinks by 13 tokens under its unchanged ceiling.
- No schema, key or behaviour changes.
