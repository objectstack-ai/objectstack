---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: an SSO provider's domain list takes bare host names only, and every rule that reads it reads each entry the same way

Clause-②: yes (narrowing) — narrowed: `POST /sso/register`, `POST /sso/update-provider` and the bridges that re-dispatch to them (`POST /admin/sso/register`, `POST /admin/sso/register-saml`, the edit bridge) now answer `400 VALIDATION_FAILED` on `domain` (`fields[0].code: 'invalid_value'`, the message naming the entry) for a `domain` value holding an entry that is not a bare host name (a URL, a port, a path, a user part, an escape, a dot run), where they stored it; and SCIM's adoption of an existing SSO account no longer reads an entry or an address that only folds into a host (full-width letters, for one) as a domain. Widened: SCIM adoption now reads an entry and an address in their one spelling, so an entry with a root dot (`acme.com.`) and the Unicode and punycode forms of an internationalised name (`bücher.de`, `xn--bcher-kva.de`) name the same domain, as the account rule already read them. New exports from the module `sso-account-at-proven-domain.ts`: `ssoDomainEntryHost`, `ssoDomainEntryHosts`, `ssoDomainEntryNotBare`.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the SSO provider domain list; `content/docs/permissions/sso.mdx` gains the rule and how to correct a stored entry in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: `sys_sso_provider.domain` keeps its type and length. The refusal is a runtime validation at the provider register and edit doors; stored rows are not rewritten, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for an administrator who registers or edits an SSO provider with a domain entry written as a URL or with a port or path (`https://acme.com`, `acme.com:443`): it is refused with `400 VALIDATION_FAILED` naming the entry, and nothing is saved. Such an entry was stored before and then proved nothing at sign-in under SSO domain verification.

Unchanged: providers already stored (not re-checked or rewritten until a request writes their domain); an edit that writes no domain; the one-provider-per-domain claim rule, which still reads a stored entry of another provider as before.

What to do: write each domain as a bare host name, separated by commas (`https://acme.com` becomes `acme.com`). For a provider already holding such an entry, edit its domain to the bare host names and verify the domain again.
