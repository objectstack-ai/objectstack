---
'@objectstack/plugin-sharing': patch
---

fix(plugin-sharing)!: a sharing rule on an object without record sharing is refused at save, not saved to do nothing

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped. What moves is the save door's answer to a sys_sharing_rule row whose object no sharing gate consults; a rule already stored keeps its row and can still be switched off, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at the sharing-rule save doors (`@objectstack/plugin-sharing`): a rule whose object is not under record-sharing enforcement is refused with `422 SHARING_NOT_ENABLED` instead of saved.

- **Before.** An administrator could save a sharing rule on an object no sharing gate consults, such as `sys_session`, `sys_account` or `sys_api_key` (a system object with no `owner_id`), a public object without an owner, a `controlled_by_parent` detail or a bypass-listed object. The save answered `201`, the rule showed as active in Setup, and its reconcile then refused every grant (`SHARING_NOT_ENABLED`) and wrote no `sys_record_share`, so the rule's recipients saw nothing more than before. Nothing told the administrator.
- **Now.** Both save doors refuse that rule and save nothing: the `/data` door (Setup's New and edit forms, scripts, imports) through a `sys_sharing_rule` hook guard, and `POST /api/v1/sharing/rules` (`SharingRuleService.defineRule`). The answer is `422 SHARING_NOT_ENABLED`, the pair the per-record share routes and `POST /api/v1/sharing/rules/:idOrName/evaluate` already answer for the same verdict. Its sentence names the object and says how to make it one a rule applies to, for example "give the object a private or read-only sharing model (`sharingModel: 'private'` or `'read'`) and an `owner_id` field", or "author the rule on its master object instead". An update is refused when it moves a rule onto such an object.

The verdict is the reconcile's own: the save doors read the same ADR-0111 D7 inert-grant check (`SharingService.sharingRuleObjectRefusal`, over `inertGrantReason`) that the grant pre-flight throws on, so the two cannot disagree. A public object that has an owner column is still admitted, because the grant service there still grants an external member of the record's organization (#25549). System writes pass, as with the declared-name guard.

To fix a rejected save, author the rule on an object that uses record sharing, or turn record sharing on for the object as the sentence says. A rule already stored on such an object is not migrated or deleted: it keeps sharing nothing, and an edit that leaves it on its object (for example switching it off) still saves.
