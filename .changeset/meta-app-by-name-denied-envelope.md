---
'@objectstack/rest': patch
---

`GET /api/v1/meta/app/<name>`: report a permission denial instead of absence

An app the session lacks the `requiredPermissions` for used to answer the same
404-equivalent as an app that does not exist, so the two were byte-identical on
the wire. A console has nothing to branch on and renders its only copy for an
absent app — "it may still be publishing" — over a permanent authorization
denial.

The by-name route now answers `403` with the ADR-0112 standard catalog code
`PERMISSION_DENIED`, in the declared envelope
(`{ success: false, error: { code, message } }`), when the app EXISTS and the
session lacks its `requiredPermissions`.

Deliberately unchanged, because the disclosure is licensed only for the case
above:

- a **nonexistent** app name keeps answering absence — converting it too would
  make every app name on the platform enumerable;
- an **unpublished** app keeps answering `404` (ADR-0045 §3 makes it externally
  unobservable, and a 403 confirms existence);
- an app withheld by an absent optional service (ADR-0057 D10) keeps answering
  `404` — nothing was denied to the caller;
- the **list** route `GET /meta/apps` stays filtered exactly as before, with no
  `authorized: false` flag, so the enumeration surface is not widened past what a
  direct by-name probe already implies.
