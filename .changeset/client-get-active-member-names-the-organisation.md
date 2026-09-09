---
"@objectstack/client": minor
---

fix(client): `organizations.getActiveMember(organizationId)` answers the organisation the caller NAMES, not whichever one the session has active (#16568)

**BREAKING** — the answer this published method gives moves for existing inputs. The signature, the declared return type and the export are byte-identical; what changes is the response an existing call observes, stated below as a before/after pair per input.

The method built `GET /organization/get-active-member?organizationId=…`, and better-auth 1.7.2's handler for that path reads `session.session.activeOrganizationId` and never looks at `ctx.query`. The query string was dead on arrival: a client doing a permission check for organisation B while A was active got **A's** membership row back, with a 200 and no diagnostic — the wrong-but-plausible answer, silently. The SDK's own JSDoc promised "the calling user's membership row in the given organisation", so this was a declared capability the runtime did not deliver.

It now asks the question honestly, in two requests:

1. `GET /get-session` — the caller's own user id;
2. `GET /organization/list-members?organizationId=…&filterField=userId&filterValue=<the caller>&limit=1` — the row, unwrapped from the one-entry page.

`list-members` reads `ctx.query.organizationId`, and its rows carry the identical shape (`OrganizationMemberWithUserWire`, user projection included), so the signature and the declared return type are unchanged and no caller's types move.

## What an existing call observes, before and after

Everything here is measured against a real `AuthManager` (better-auth 1.7.2, organization plugin) over a real `SqlDriver`. Each bullet is one input, with the response it drew before and the response it draws now.

- **An organisation id other than the session's active one.** Before: a 200 carrying the **active** organisation's membership row, whatever id was named. After: a 200 carrying the **named** organisation's row. An input that named the active organisation's own id drew that organisation's row before and draws the same row after — `auth.me()` is where that id is readable, on `session.activeOrganizationId`.
- **An organisation the caller is not a member of.** Before: the named organisation was never consulted, so the answer was about the **active** one — a 200 carrying the active organisation's row, or `400 MEMBER_NOT_FOUND` when the caller had no row there either. After: `403 YOU_ARE_NOT_A_MEMBER_OF_THIS_ORGANIZATION`, the server's own refusal, about the organisation that was actually named.
- **Any id, on a session with no active organisation.** Before: `400 NO_ACTIVE_ORGANIZATION`. After: a 200 carrying the caller's row in the named organisation. `setActive` has stopped being a precondition, which is the point of naming the organisation.
- **An empty `organizationId`.** Before: a 200 carrying the **active** organisation's row — better-auth resolves `ctx.query.organizationId || session.activeOrganizationId`, so an empty string fell through to session state and the wrong-but-plausible answer survived on that one input. After: the SDK refuses it before the wire, with a thrown `[ObjectStack] organizations.getActiveMember: organizationId is required`.

Two things do not move: an anonymous caller still draws `401 UNAUTHORIZED`, thrown by the same session middleware that guarded the old route; and the row's shape is the same on both sides. The method now makes two HTTP requests where it made one.

Graded `minor` rather than `patch`: the method's published behaviour moves for existing callers, which is the same clause-② judgement this PR declares, and the maintainer's ruling of 2026-09-04 (decision batch #35) holds that a change to a published package's public surface takes at least `minor` — a commit type may raise a bump, never lower it below what the act requires. The banner above carries the breaking-ness that the level cannot, per the ruling recorded on #16568 on 2026-09-08.

The auth route ledger's `GET /api/v1/auth/organization/get-active-member` row is rebooked from `sdk` to `server-only` in the same change: `sdk` means "expressed by the SDK", and no SDK method builds that URL any more. The `get-session` and `list-members` rows gain the method in their notes, since it now builds both. Ledger-internal, nothing published moves with it.

<!-- adr-0087: not-required (no-migration-prescription) SDK call-site change, no metadata conversion -->
