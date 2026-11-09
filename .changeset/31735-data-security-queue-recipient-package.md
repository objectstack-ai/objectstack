---
'@objectstack/skills': patch
---

docs(skills): objectstack-data `security.md` teaches that a package's sharing rule resolves its queue recipient from its own package

Clause-②: no
Metadata-protocol: none

`skills/objectstack-data/rules/security.md` now states the rule the sharing plugin enforces since ADR-0150 E4: a declared sharing rule's `sharedWith: { type: 'queue', value }` reads the name as its own package's queue, else the one holder in the package's declared `dependencies` closure plus `sys`, else (no package or environment item declares the name) an organization's `sys_queue` row. Three refusal codes are taught, each with an example: `outside-closure` (the only holder is a package the rule's package does not depend on, or an environment-authored item), `ambiguous-in-closure` (two dependencies hold the name) and `ambiguous-in-environment` (the holder the rule reaches, its own package or one dependency, and a non-dependency both hold it). A refused rule grants no one new and is warned as `RESOURCE_CONFLICT`; it loads, so nothing earlier tells the author. `evals/hooks-security-seeds-datasources.json` gains case 18, which requires the queue recipient plus a manifest `dependencies` entry on the queue's package and refuses redeclaring the queue in the rule's package.

The file sits at its token ceiling, so the new bullet (446 bytes) is paid for by these cuts in the same file (459 bytes; the file goes from 15069 to 15056 bytes):

- `(PermissionSetSchema.rowLevelSecurity)` after "permission set / profile" (41 B); the same sentence names `rowLevelSecurity` on a permission set.
- "(the tenant wall still applies)" in the RLS default-deny sentence (32 B); the Layer 0 bullet says the wall is AND-composed ahead of all business RLS.
- The sentence that a legacy SQL-style `=` / `IN (...)` predicate still compiles through a deprecated bridge (98 B). This is not a restatement: the file now teaches canonical CEL only.
- The four "(for `IN`)" notes in the `current_user.*` table (42 B); the predicate list above it spells `field in current_user.ARRAY`.
- The membership-key section intro, shortened to "Declare the set on the roster object, not one policy per record." (80 B); the section heading and the "Choose by" bullet's "a named record → a membership key" carry the rest.
- "(`isDefault` sets)" after the `everyone` baseline in the Positions section (19 B); the `isDefault: true` bullet defines that baseline.
- The admin-only recipe's `tenancy` comment "not a tenant object → Layer 0 contributes nothing" (55 B); the blockquote below it explains the key.
- The blockquote's "it is the half that holds however permissive the grants" (59 B); the `requiredPermissions` paragraph calls it an AND-gate, strictest-wins over field grants.
- "(`@objectstack/plugin-security`)" after `sys_user_permission_set` (33 B); a package pointer an author never writes.

The `(definePermissionSet)` example comment and the field-lock recipe docs link stay.
