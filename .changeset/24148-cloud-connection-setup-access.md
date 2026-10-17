---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: `bind/start`, `bind/poll` and `unbind` require `setup.access`, and `GET /status` serves the connection's details only to a caller who holds it

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) a runtime authorization narrowing at four of CloudConnectionPlugin's same-origin routes, not a metadata change: no spec key, export, option, config field or stored shape is removed, renamed or re-shaped, so `objectstack migrate meta` has nothing to rewrite; a caller who holds Setup Access is served exactly as before, and one who does not is refused or served less -->

**BREAKING** (an accept-set narrowing), shipped as `patch`: no public surface widens.

The Console's Cloud Connection page sits on the Setup app, which requires the Setup Access permission (`setup.access`). The routes behind that page did not ask for it: the three that change this runtime's cloud connection checked only that the caller was signed in, and `GET /api/v1/cloud-connection/status` served the connection record the control plane reports to every caller. Both now follow the page's rule.

- **Refused now:** `POST /api/v1/cloud-connection/bind/start`, `POST /api/v1/cloud-connection/bind/poll` and `POST /api/v1/cloud-connection/unbind` answer a signed-in caller who does not hold `setup.access` with `403` and the standard `PERMISSION_DENIED` code, and the message names the capability. The refusal comes before any call to the control plane and before the stored credential is touched. What the caller holds is read through `resolveAuthzContext`, the platform's one authorization resolver, for the session these routes already read: a grant bound through a position, or scoped to the session's active organization, counts as it does everywhere else, and an API key sent beside the session lends its owner's grants to nobody.
- **Narrowed now:** `GET /api/v1/cloud-connection/status` still answers every caller `200`, so a probe can still tell that the plugin is mounted. A caller without `setup.access` (anonymous, signed in without it, or a session the ADR-0069 policy holds) is served `bound`, `runtimeId` and `provider` only. `environmentId` and `connection` are served to a caller who holds it.
- **Unchanged:** a caller who holds `setup.access` is served exactly as before, so the Console panel's connected view, its "Approved by" row included, keeps working for an administrator. An anonymous caller of the three connection-changing routes still gets `401`, and a held session still gets the ADR-0069 `403`. The other four session routes (`install`, `installation`, `installed`, `org-packages`) are not touched.
- **An unreadable permission store is not a denial.** When the grants cannot be read, the three connection-changing routes raise the platform's `SERVICE_UNAVAILABLE` outage (`503` through the host's error render) instead of answering a `403` that reads like a real refusal. `status` keeps answering, withholds the details, and logs the outage.

What changes for you. Whoever manages this runtime's cloud connection needs Setup Access, which the default platform-administrator and organization-administrator permission sets already carry. A script that reads `connection` or `environmentId` from `GET /status` has to call it as a signed-in user who holds Setup Access.
