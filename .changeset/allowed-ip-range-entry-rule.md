---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth)!: an allowed IP range that names no range is refused at save and never matches at the gate

Clause-②: no (narrowing)
Metadata-protocol: none
Skills-docs: updated here — `content/docs/permissions/authentication.mdx` (the `allowed_ip_ranges` row, and the first two rules under "Saving, clearing and lockout recovery") and `docs/HARDENING.md` (the Network row); `skills/**` teaches no `allowed_ip_ranges`

<!-- adr-0087: not-required (no-migration-prescription) no metadata an author writes changes and no stored row is rewritten: a value of the `auth.allowed_ip_ranges` setting that is not text, or an entry of it or of the auth plugin's `allowedIpRanges` option that names no range, is refused where it is saved or declared, and matches no address at the sign-in gate -->

**BREAKING** for a deployment whose `auth.allowed_ip_ranges` (ADR-0069 D5), `OS_AUTH_ALLOWED_IP_RANGES` or declared `allowedIpRanges` holds an entry that is not an IP address or a CIDR range, or whose stored `auth.allowed_ip_ranges` value is not text.

The setting holds its entries as text, one per line or comma-separated; a value that is not text (a list, a number, an object) names no list. An entry is an IPv4 or IPv6 address, or an address, `/` and a prefix length written in decimal digits: one or two digits, from 0 to 32, for an IPv4 base (an IPv4-mapped one included), and one to three digits, from 0 to 128, for an IPv6 base. Every such entry keeps its meaning. Any other entry names no range, and one reading of that rule now serves every door that judges or saves the list:

- **The sign-in gate.** An entry that names no range matches no address, its own base address included, so a list holding one admits exactly what its other entries admit. `ipMatchesRange` answers `false` for it.
- **The settings save.** A value that is not a list of entries written as text is refused with `400 SETTINGS_VALIDATION`, `invalid_value` at `allowed_ip_ranges` and `constraint: { type: 'textarea' }`. A list holding an entry that names no range is refused the same way, the entries in `constraint.invalidEntries`, with a message in the caller's language that names them. Both are judged before the saving address, on every write: the console's `PUT /api/settings/auth` and writes made inside the server alike. Saving the value already in force again is not judged, as before.
- **The declared list.** An `allowedIpRanges` passed to `AuthPlugin` or `AuthManager`, or set by an `auth:configure` handler, that holds one, or that is not an array, is refused at construction with an error naming each such entry.
- **A list already stored, or pinned by `OS_AUTH_ALLOWED_IP_RANGES`.** It is applied, the entry matches no address, and the settings binding logs one `error` that names the entry and the fix. A stored value that is not text admits no address while it is in force, and the binding logs one `error` that says so and names the fix.
- **Who moves.** A deployment with such an entry corrects it to an address, or an address and a prefix length (`203.0.113.0/24`, `2001:db8::/32`), or removes it. A deployment whose stored value is not text saves the list again as text, or clears it. Locked out meanwhile, start the server with `OS_AUTH_ALLOWED_IP_RANGES` set to an empty value, sign in, clear the stored value (`PUT /api/settings/auth` with `allowed_ip_ranges: null`, the one write the override lets through), remove the variable and restart, then save the corrected list.
