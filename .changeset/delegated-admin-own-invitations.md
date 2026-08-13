---
'@objectstack/plugin-security': patch
---

A `delegated_admin` can now read the invitations it issued (#8240)

`delegated_admin` is the one principal that may reach `/organization/invite-member`
without being an org admin (ADR-0105 D8), but #8095's narrowing of the
`sys_invitation` ledger admitted `org_owner` / `org_admin` only — and that role
normalizes to neither. It could create invitations it then could not list, with no
second path back, since better-auth's own `list-invitations` route is owner/admin
gated too.

`member_default` gains one row-scope policy, `sys_invitation_issuer`
(`inviter_id == current_user.id`, domained to the `delegated_admin` grade), a
sibling of the addressee carve-out that already sits beside it. Scope-bounded on
purpose: the issuing principal reviews **its own** issuance, not the ledger. Owner
and admin visibility is unchanged, and a plain member still reads nothing but the
invitation addressed to them.
