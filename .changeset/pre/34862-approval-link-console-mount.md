---
'@objectstack/plugin-approvals': patch
---

fix(approvals): the approval e-mail's link and the action-link page's inbox link open the Console under its mount

Clause-②: yes (widening)
Metadata-protocol: none

The approval e-mail's "Open the approval" link was `BASE/system/approvals?request=ID`. `os serve` serves the Console at `/_console/` and nothing at `/system/*`, so the link answered `404 ENDPOINT_NOT_FOUND` and the request never opened. The "Open the Approvals Inbox" link on the action-link result page (`/api/v1/approvals/act`) had the same defect.

Both links now carry the Console's mount. The mount is read from the auth service's Console page composer (`getConsoleUrl`, which reads `AuthConfig.uiBasePath`, default `/_console`), the same composer the auth e-mails and the mention e-mail use.

- The e-mail link goes from `BASE/system/approvals?request=ID` to `BASE/_console/system/approvals?request=ID` on a default deployment. A deployment that sets `uiBasePath` to `/` keeps `BASE/system/approvals?request=ID`. Its base is still the approval links' own (`publicBaseUrl`, else `OS_AUTH_URL` / `OS_BASE_URL`). A kernel with no auth service has no mount to read, and the e-mail link stays as it was.
- The inbox link goes from the origin-relative `/system/approvals` to `BASE/_console/system/approvals`. It is now absolute under the approval links' base when one resolves, and relative (`/_console/system/approvals`) when none does. With no mount to read (no auth service, or `uiBasePath` set to `/`) it is `BASE/system/approvals`.

The widening: the exported `ApprovalServiceOptions` gains the optional `getConsoleUrl` that carries the composer; the in-app `actionUrl` is unchanged.
