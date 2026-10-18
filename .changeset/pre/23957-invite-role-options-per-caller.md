---
'@objectstack/spec': minor
'@objectstack/platform-objects': patch
'@objectstack/plugin-auth': patch
---

fix(identity): the Invite User dialog offers only the roles the caller may grant, read from the same table the invitation role cap enforces

Clause-②: yes (widening)

**What was wrong.** A `delegated_admin` who opened Invite User was offered Owner, Admin and Delegated Admin. The server's invitation role cap refuses all three for that issuer. The `role` param inherited one static option list from the field, and nothing told the client which roles this caller may grant.

**What is new in `@objectstack/spec` (`identity`).** One table, `INVITATION_ROLE_GRANTORS`, says which issuer grades may invite as each membership role:

| role | issuers that may grant it |
|---|---|
| `owner` | `owner` |
| `admin`, `delegated_admin` | `owner`, `admin` |
| `member` | any issuer (`INVITATION_ROLE_ANY_ISSUER`) |

New exports beside it: `invitationRoleGrantors(role)` (a role the closed vocabulary does not list takes the `owner`, `admin` row), `invitationRoleGrantPredicate(role)` (the CEL gate, one `'<projected grade>' in current_user.positions` term per grade, `undefined` for an any-issuer row), `INVITATION_ROLE_OPTIONS` (the role picker's options, each carrying its gate as `visibleWhen`), and the types `InvitationRoleGrantors` and `InvitationRoleOption`.

**`@objectstack/plugin-auth`.** The invitation role cap now reads that table to decide which invitations it admits. It refuses exactly what it refused before, with the same refusal text. A pin compares it with the previous implementation on 1,517 request and issuer pairs.

**`@objectstack/platform-objects`.** The `role` param of the three `invite_user` actions (`sys_user`, `sys_member`, `sys_invitation`) declares `INVITATION_ROLE_OPTIONS` itself instead of inheriting the field's list. The option values and English labels are unchanged. A `delegated_admin` is now offered Member only, an admin Admin, Delegated Admin and Member, and an owner all four. The per-option gate is a UI courtesy; the server cap remains the authority. Because the options are declared on the param, their labels now translate under `_actions.invite_user.params.role.options.<value>`, and the bundles carry those keys in every locale.
