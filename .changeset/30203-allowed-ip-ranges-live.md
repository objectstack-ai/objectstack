---
'@objectstack/plugin-auth': patch
'@objectstack/service-settings': patch
---

fix(plugin-auth)!: clearing the allowed IP ranges applies at once, and a console save that leaves out the saving address is refused

Clause-②: no (narrowing) — a settings console save (`PUT /api/settings/auth`) of an `allowed_ip_ranges` list that leaves out the saving request's own address is refused, where it was stored before; nothing is widened.
Metadata-protocol: none
Skills-docs: none — `skills/**` teaches no `allowed_ip_ranges`; `content/docs/permissions/authentication.mdx` describes the setting and does not yet state the save refusal or the recovery, which ship here in the refusal text and this entry (the page is outside this change's surface and is named for a follow-up).

<!-- adr-0087: not-required (no-migration-prescription) no metadata an author writes changes and no stored row is rewritten: a console save of a setting value is refused when it would lock out the saving request -->

**BREAKING** for an administrator who saves, through the settings console, an allowed-IP list (ADR-0069 D5) that does not include the address they are connected from.

- **Clearing applies at once.** The console sends an emptied field as `null`, which resolves with source `default`, and the settings binding used to skip a default-sourced `allowed_ip_ranges`: the last stored list kept refusing sign-in (`403 IP_NOT_ALLOWED`) until a restart while the field showed empty. A cleared or restored-default value now hands the gate back to the deployment's own declaration in the same pass: no list when it declared none, the `allowedIpRanges` the plugin options or an `auth:configure` handler declared otherwise.
- **The save is refused.** A list that leaves out the saving request's address is refused with `400 SETTINGS_VALIDATION`, `invalid_value` at `allowed_ip_ranges`, the address in `constraint.clientAddress`, and a message in the caller's language that names it. The address is the one the gate judges at sign-in: the transport's peer address, or the forwarded one when the stack declares `server.trustProxy`. When the server cannot establish the address, every non-empty list is refused, because the gate would refuse that request too. Clearing the list is never refused, and an in-process write (boot, seed, migration) carries no request and is not judged.
- **Recovery when already locked out.** Start the server with `OS_AUTH_ALLOWED_IP_RANGES` set to an empty value. The settings env override wins over the stored list and opens the gate; remove it once the list is fixed.
- **`@objectstack/service-settings`.** `SettingsContext` gains an optional `transport` (`SettingsRequestTransport`: the request headers and the transport's peer address), which the settings routes set on a save so a write predicate can judge the change against the caller's own connection. It identifies and authorizes nothing and is never stored.
- **Who moves.** An administrator adds their own address or range to the list, or saves it from an address inside it.
