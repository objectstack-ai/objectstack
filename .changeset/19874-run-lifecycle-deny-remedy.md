---
'@objectstack/runtime': patch
---

fix(runtime): the run-lifecycle refusal names only a remedy the deployment's tenancy posture honours (#19874)

`POST /api/v1/automation/:name/runs/:runId/cancel` and
`…/restore-suspension` admit only a caller with platform-operator standing
(the `PLATFORM_ADMIN` rung). When they refuse, the message says how to get that
standing. It used to say "the unscoped `admin_full_access` grant" on every
deployment. Under the walled postures (`group` / `isolated`) that grant no
longer confers platform-admin standing, so an operator who followed the advice
was still refused, with no sign of why.

The sentence now depends on the requested tenancy posture, read the same way
the platform-admin derivation reads it:

- **`group` / `isolated`**: standing comes only from the deployment's declared
  platform administrators, meaning an account whose verified email address is
  listed in `OS_PLATFORM_OWNER_EMAIL`.
- **`single`**: standing comes from an unscoped `admin_full_access` grant or
  from `OS_PLATFORM_OWNER_EMAIL`. Both work on that posture today.
- **A posture that cannot be read**: the message names only
  `OS_PLATFORM_OWNER_EMAIL`, which every posture honours.

Nothing else changes. The same callers are admitted and refused, and a refusal
is still `403 PERMISSION_DENIED`. The last sentence still points a refused
caller at `POST /automation/:name/runs/:runId/resume`.
