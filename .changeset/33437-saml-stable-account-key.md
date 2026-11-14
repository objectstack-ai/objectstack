---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

fix(auth)!: a SAML provider keys its accounts on a stable attribute (Entra ID's object id by default), so a sign-in from the app and one from the IdP's portal reach one account

Clause-②: yes (narrowing) — widened: the Register SAML Provider form and its bridge (`POST /api/v1/auth/admin/sso/register-saml`) take an optional `mapAccountKey`, the assertion attribute a provider keys its accounts on, stored as the provider's `mapping.extraFields.accountKey`; with none named, a Microsoft Entra ID provider (IdP Entity ID on `sts.windows.net` or `login.microsoftonline.com`) keys on `http://schemas.microsoft.com/identity/claims/objectidentifier` when the assertion carries it, so an IdP-initiated entry after an SP-initiated one (or the other way round) signs in to the same account where it was refused `account_not_linked`. Narrowed: on such a provider a new account's key is that value instead of the NameID, and an account made before this change keeps its NameID key, which a sign-in no longer looks up directly: a sign-in that resolves to the account's email and carries its NameID still signs in to it, but one whose email changed at the IdP no longer reaches it (a new user is made where the provider allows JIT, otherwise the sign-in is refused); and a SAML sign-in whose verified assertion does not carry the account-key value read from the posted one is refused `INVALID_REQUEST`. No first-party composition in this repository registers a SAML provider.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches SAML account keys or the SSO register form; `content/docs/permissions/sso.mdx` gains the rule in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: the new form parameter is an action parameter of a platform object stored inside the provider's existing SAML mapping, existing account rows are deliberately not rewritten (maintainer ruling: the stable key applies to new sign-ins only), and the moved answers are runtime sign-in outcomes, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment with a Microsoft Entra ID SAML provider that already has accounts: those accounts stay keyed on the NameID they were made with (they are not rewritten), and a sign-in now looks an account up by the object id, so it reaches one of them only through the account's email. Measured on the real stack for an account made from the sign-in page (keyed on the user principal name):

- the same entry again (same NameID, same email) still signs in to it;
- the other entry (the IdP's portal, another NameID) is refused `account_not_linked` by the linking rule, as before this change, so for such an account the two entries do not yet reach one account;
- after the person's email changed at the IdP (same NameID), the sign-in no longer reaches it: where the provider allows JIT a new user is made, keyed on the object id; otherwise the sign-in is refused `SELF_REGISTRATION_CLOSED`. Before this change that sign-in signed in to the old account.

A provider that is not Entra ID and names no account-key attribute is unchanged.

Unchanged: every OIDC provider; a SAML provider that is not Entra ID and names no attribute; linking across providers and to a password account (an existing account at the same address is still judged by the linking rule); and a sign-in whose assertion does not carry the key attribute, which is keyed on its NameID as before.

What to do: nothing for a new provider. For a provider whose IdP is not Entra ID and whose NameID differs between sign-in-page and portal entries, name a stable per-person attribute in `mapAccountKey` when registering it.
