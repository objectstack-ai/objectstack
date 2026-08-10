---
"@objectstack/plugin-security": major
---

<!-- adr-0087: not-required (no-migration-prescription) what this change removes is a VALUE in one platform-seeded sys_permission_set row, not an authorable key. No spec schema key is retired: object_permissions['*'] stays fully authorable, and admin_full_access / organization_admin / viewer_readonly still ship one. Nothing an app authored becomes invalid, nothing stored fails to parse, and the seeded row itself is rewritten by the boot seeder, so there is no stored shape for `objectstack migrate meta` to rewrite and nothing for the ledger to carry. The Migration section below prescribes a DEPLOYMENT action -- declare the object access you were relying on -- not a consumer code or metadata rewrite. -->

fix(plugin-security)!: `member_default` no longer grants a `*` wildcard — the platform baseline is explicit-allow (#5491)

**This is a deliberate, breaking narrowing of the default security posture.
Deployments that relied on the implicit wildcard lose that access. That is the
intended behaviour change, not a side effect — read the migration below before
upgrading.**

`member_default` is the additive `everyone` baseline: it resolves for **every**
authenticated member, in addition to whatever else they hold. It carried
`object_permissions["*"] = {allowCreate: true, allowRead: true, allowEdit: true,
allowDelete: false}`, and object permissions merge most-permissively — so that
entry was not a default, it was a **floor no application could get under**. An
app's explicit-allow object gate was erased on three of the four axes; only
delete stayed profile-driven, because the baseline never granted it.

HotCRM's 17.0 GA sweep measured the consequence across 5 profiles × 17 objects
(188 probes, each user with their own bearer token):

- **21 of 21 create-DENIAL probes returned `201`** — every profile created on
  every object once validation passed, including objects the profile explicitly
  denied;
- a `service_agent` profile that declares no edit anywhere edited its own
  `crm_account`;
- on `public_read` objects the wildcard yielded **`200` with ALL rows** for
  non-holders — real unauthorized reads, not the documented "200 with 0 rows"
  empty-set pattern;
- `security/explain` stated it outright for a profile carrying an all-false
  deny: *"create on 'crm_opportunity' is granted by [member_default]"*.

Because app-side authorization suites validate the app's *declarations*, CI
stayed green while the runtime posture was default-open — `declared ≠ enforced`
inside the security layer itself.

**The change.** The wildcard is removed on all three live axes. The platform
baseline narrows to explicit-allow: object access now comes from OWDs plus
profile / permission-set **declarations** only. Deny-precedence merge semantics
were considered and rejected — permission sets remain additive capability
containers (ADR-0090); the fix is to stop the platform shipping a grant nobody
asked for, not to invent a veto.

What `member_default` still declares, it still enforces, and nothing here is
newly granted: read on the better-auth identity tables (their writes stay
denied — that door is better-auth), self-service on `sys_user_preference` (now
an explicit entry rather than an implicit one; the effective access for a member
is byte-identical, and its `sys_user_preference_self` RLS carve-out already
declared exactly that intent), and every row-level policy it shipped before —
`owner_only_writes`, `owner_only_deletes` and the identity `_self` carve-outs
are untouched. The set stays anchor-safe, so its `everyone` binding is
unaffected. `admin_full_access`, `organization_admin` and `viewer_readonly` keep
their wildcards: those are granted deliberately to a principal, which is exactly
what the baseline was not.

## Migration

After upgrading, a member holding **no** application profile has no access to
application objects. Restore access by declaring it, in one of two places:

1. **Ship an app default profile.** Mark a permission set `isDefault: true` and
   the CLI wires it as the additive per-request baseline (ADR-0056 D7 /
   ADR-0090 D5). This is the recommended route and what the bundled showcase app
   already does — list the objects members legitimately touch, with the axes
   they need.
2. **Grant per position / per user.** Bind an ordinary permission set through
   `sys_position_permission_set` or `sys_user_permission_set`.

To find what a deployment was silently relying on, ask
`GET /api/v1/security/explain?object=<name>&operation=<op>` for a
representative member before upgrading: any answer attributing the grant to
`[member_default]` on an application object is access that will stop. An app
whose own profiles already declare everything its users do is unaffected.
