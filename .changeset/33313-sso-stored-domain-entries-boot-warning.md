---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): warn at boot about each stored SSO provider whose domain list holds an entry that names no domain

Clause-②: no
Metadata-protocol: none

Register and edit refuse a `domain` entry that is not a bare host name (a URL, a port, a path, a user part), and every rule that reads a provider's domain list (the SSO account rule and SCIM adoption) reads such an entry as naming no domain. A `sys_sso_provider` row saved before that refusal may still hold one, such as `https://acme.com`. It is not rewritten, and until now nothing said so: the provider looked configured while no address was at a domain it had proven.

At `kernel:ready` the plugin now reads every stored provider once, as the system, and logs one warning per provider holding such an entry, naming its `provider_id` and each entry the register refusal would refuse. The warning reads only: no row is written. A provider whose entries are all bare host names is not named, and a host with no data engine, no `sys_sso_provider` object or a failed read boots unchanged.

**Fix:** send the bare host names as `domain` to `POST /api/v1/auth/sso/update-provider` (`https://acme.com` becomes `acme.com`), then verify the domain again, since writing the list clears the verified flag.
