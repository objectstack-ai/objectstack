---
'@objectstack/plugin-auth': patch
---

fix(plugin-auth): an IPv6 CIDR in the allowed IP ranges admits the IPv6 clients inside it, at the sign-in gate and at the settings save check

Clause-②: no
Metadata-protocol: none

`auth.allowed_ip_ranges` (ADR-0069 D5) promises CIDR ranges, but its matcher read only IPv4 CIDR and exact addresses: an IPv6 entry such as `2001:db8::/32` was compared as text, so it never matched a real client. The sign-in gate then refused every IPv6 client the list named, and the settings save check refused the save for an administrator connected over IPv6 from inside it. `ipMatchesRange` now reads an IPv6 CIDR as the first `n` of 128 bits, and both doors use it, so they keep judging the same address the same way.

- An exact IPv6 entry matches the address it denotes however it is spelled (`2001:DB8:0:0::1` matches `2001:db8::1`).
- An IPv4-mapped address, dotted (`::ffff:203.0.113.5`) or hex (`::ffff:cb00:7105`), is still judged as the IPv4 address it maps. A zone identifier on an address (`fe80::1%eth0`) is dropped before matching.
- Families never cross: an IPv4 range never admits a pure IPv6 address, and an IPv6 range never admits an IPv4 one.
- An IPv6 prefix must be a whole number from 0 to 128. An entry with any other prefix matches only its base address, as it did before. IPv4 entries are read exactly as before.
