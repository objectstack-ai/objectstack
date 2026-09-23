---
"@objectstack/platform-objects": patch
---

fix(platform-objects): `sys_user.role`'s help text names the platform-admin route that works on every tenancy posture, and keeps the unscoped grant `single`-only (#19875)

The `role` field's `description` is authored metadata: it ships in the published bundle, is extracted into the `en` i18n bundle, and is the help text an administrator reads on the field in Setup. It said:

> Legacy better-auth role scalar (admin, user, …). ObjectStack no longer writes it (ADR-0068 D2) — grant platform-admin standing with an unscoped `admin_full_access` assignment in `sys_user_permission_set`.

On a walled deployment (`OS_TENANCY_POSTURE` `group` or `isolated`) that remedy does nothing: since the walled legacy-anchor retirement, an unscoped `admin_full_access` row no longer confers platform-admin standing there. The only route there is the deployment's configured administrator list. The help text now reads:

> Legacy better-auth role scalar (admin, user, …). ObjectStack no longer writes it (ADR-0068 D2). To grant platform-admin standing, list the user's verified email in `OS_PLATFORM_OWNER_EMAIL`; under the `single` tenancy posture an unscoped `admin_full_access` assignment in `sys_user_permission_set` also confers it.

This describes both anchors as they work today. The configured, email-verified address confers standing on every posture. The unscoped grant row still confers it under `single`, and nowhere else. No behaviour changes: this is a text correction only.

- **`en.objects.generated.ts`** follows by regeneration (`pnpm i18n:extract`), not by hand.
- **The existing pin** on this description (`platform-objects.test.ts`) now also requires the text to name `OS_PLATFORM_OWNER_EMAIL` and to qualify the grant with `single`. Without that, restoring the unqualified sentence would pass every test.
