---
"@objectstack/client": patch
---

fix(client): `organizations.getActiveMember(organizationId)` answers the organisation the caller NAMES, not whichever one the session has active (#16568)

The method built `GET /organization/get-active-member?organizationId=…`, and better-auth 1.7.2's handler for that path reads `session.session.activeOrganizationId` and never looks at `ctx.query`. The query string was dead on arrival: a client doing a permission check for organisation B while A was active got **A's** membership row back, with a 200 and no diagnostic — the wrong-but-plausible answer, silently. The SDK's own JSDoc promised "the calling user's membership row in the given organisation", so this was a declared capability the runtime did not deliver.

It now asks the question honestly, in two requests:

1. `GET /get-session` — the caller's own user id;
2. `GET /organization/list-members?organizationId=…&filterField=userId&filterValue=<the caller>&limit=1` — the row, unwrapped from the one-entry page.

`list-members` reads `ctx.query.organizationId`, and its rows carry the identical shape (`OrganizationMemberWithUserWire`, user projection included), so the signature and the declared return type are unchanged and no caller has to be edited.

## What an existing caller can observe change

Everything here is measured against a real `AuthManager` (better-auth 1.7.2, organization plugin) over a real `SqlDriver`:

- naming a non-active organisation now answers that organisation's row instead of the active one's — the defect;
- a caller who is not a member of the named organisation is refused `403 YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION` by the server. The old shape could not report this at all: it never asked about the named organisation, so it answered about the active one instead;
- a caller with no active organisation gets their row rather than a thrown `400 NO_ACTIVE_ORGANIZATION`. `setActive` has stopped being a precondition, which is the point of naming the organisation;
- an anonymous caller still gets `401 UNAUTHORIZED`, thrown by the same session middleware that guarded the old route;
- the method now makes two HTTP requests where it made one.

Callers that relied on passing an arbitrary id to read the ACTIVE organisation's row should pass the active organisation's id (`auth.me()` carries `session.activeOrganizationId`).

The auth route ledger's `GET /api/v1/auth/organization/get-active-member` row is rebooked from `sdk` to `server-only` in the same change: `sdk` means "expressed by the SDK", and no SDK method builds that URL any more. Ledger-internal, nothing published moves with it.
