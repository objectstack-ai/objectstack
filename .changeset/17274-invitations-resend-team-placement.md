---
"@objectstack/client": minor
---

fix(client): `organizations.invitations.resend` forwards `teamId`, so resending a team invitation keeps its team (#17274)

`resend` has declared `teamId?: string | null` since the `organizations.*` family's first commit and has never forwarded it. The re-invite it issues carried `email`, `role` and `organizationId` only, so a caller resending a TEAM invitation passed the team, the compiler accepted it, the request succeeded — and the invitation landed with no team. Nothing refused, nothing warned, and the success path carried no trace of the loss. The published type is the contract a caller reads, and it promised a placement the call could not make.

**Which of the two repairs this is, and what decided it.** The card left the direction open between forwarding the member and deleting it, and required the endpoint to be DRIVEN rather than read off the vendor's types. Driven — a real `AuthManager` (better-auth 1.7.3, organization plugin, `teams: { enabled: true }`, the posture `auth-manager.ts` hard-wires) over a real `SqliteWasmDriver`, with the SDK's own `fetch` handing each `Request` to `AuthManager.handleRequest`:

| body sent to `POST /organization/invite-member` | answer |
|:--|:--|
| `{ …, teamId: '<a real team>' }` | `200`, and the invitation's `teamId` is that team |
| `{ …, teamId: 'team_does_not_exist' }` | `400` `Team not found` (`TEAM_NOT_FOUND`) |
| `{ …, teamId: null }` | `400` `[body.teamId] Invalid input` (`VALIDATION_ERROR`) |
| `{ … }` — no `teamId` member | `200`, and the invitation's `teamId` is `null` |

Row 1 settles it: the endpoint accepts a team on this call, the placement is stored on the invitation row and read back by `invitations.list`. Deleting the member would therefore have removed a capability the wire really has, so it is forwarded.

**It is not forwarded verbatim, and rows 3 and 4 are why.** `null` is this SDK's own spelling of "no team" — `invitations.list` answers `teamId: string | null`, and handing that object straight back to `resend` is the ordinary way to resend. The vendor's spelling of the same fact is ABSENCE. A bare spread would put `teamId: null` on the wire and convert today's silent drop into a `400` for every round-tripping caller: a second defect wearing the fix's clothes. So `invite` lifts `teamId` out of the spread and sends it only when it is a string; `null` and an omitted member both send no `teamId` at all. ⛔ Nothing else is normalised — an unknown id keeps reaching the vendor, because `TEAM_NOT_FOUND` is the loud refusal that replaces the silent drop.

**`organizations.invite` gains the same `teamId?: string | null` member.** It is the only route `resend` has to the wire, and declaring the member is what lets the placement be typed rather than smuggled. Purely additive on a published request type: every existing call compiles and sends byte-identical requests, which the sibling byte pins on `invite` assert unchanged.

`resend` also stops spelling its own `role ?? 'member'` and takes `invite`'s default instead — one family, one substitution, no second copy to drift. Behaviour-neutral: an omitted or explicitly-`undefined` `role` still reaches the wire as `'member'`, in the same position, and a caller-named role still survives.

Pinned in `packages/client/src/organization-invitation-resend-team-placement.test.ts`: the placement over the real vendor, its read-back through `list()`, the `TEAM_NOT_FOUND` refusal, the `null` round trip that fails on the verbatim forward, and full-string equality on the request bytes for both methods.
