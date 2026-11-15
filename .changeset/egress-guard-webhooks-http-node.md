---
'@objectstack/spec': patch
'@objectstack/core': patch
'@objectstack/service-messaging': patch
'@objectstack/service-automation': patch
'@objectstack/plugin-webhooks': patch
---

feat(spec, core, service-messaging, service-automation, plugin-webhooks)!: webhook deliveries and the flow `http` node reach only public addresses unless the operator allowlists the target, and never a link-local or cloud metadata address

Clause-②: no (narrowing) — webhook deliveries and flow `http` node requests aimed at a loopback, private, carrier-grade NAT, link-local, unique-local, multicast, broadcast or unspecified address are refused unless `OS_EGRESS_ALLOWED_TARGETS` lists the target; link-local and cloud metadata addresses are refused whatever it lists; a malformed or over-broad allowlist fails the boot.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed or renamed: a webhook row and a flow http node are authored and stored exactly as before, and nothing stored is rewritten. What moves is the deployment's outbound policy, decided by the operator's environment at boot, so no metadata migration exists to register. -->

**BREAKING** for deployments whose webhooks or flows send requests to internal addresses. Outbound requests a tenant can aim now reach only public addresses. The rule applies to the address the connection is actually made to: after DNS resolution, for a literal IP in the url, for IPv6 forms that carry an IPv4 address, and on every redirect hop.

**Who moves.** Operators whose webhooks or flows target internal addresses (a service on `localhost`, a host on a private network, an internal DNS name that resolves to one): set `OS_EGRESS_ALLOWED_TARGETS` to the exact host names, IP addresses or CIDR blocks those requests may reach, comma-separated, and restart. Link-local and cloud metadata addresses cannot be listed. Nothing else changes, and requests to public targets are unaffected.

**What a refusal looks like.** A webhook delivery whose target is refused dead-letters on its first attempt with an error starting `EGRESS_REFUSED`; it does not walk the retry schedule, since a retry cannot change the verdict. A flow `http` node whose target is refused fails with `http: EGRESS_REFUSED: …`, and a `durable: true` callout dead-letters in the outbox the same way as a webhook. The refusal text names the requested host and the rule; the server log adds the resolved address and its class for the operator.

**The boot.** One line says the guard is active and how many targets `OS_EGRESS_ALLOWED_TARGETS` lists. The webhook plugin then logs once how many stored `sys_webhook` rows target an address the guard will refuse. A malformed or over-broad allowlist (an entry with a scheme, port, path or wildcard, host bits set, a prefix under `/8` such as `0.0.0.0/0`, or a link-local or metadata address) fails the boot, naming every bad entry.

**For hosts.** `@objectstack/core/egress` exports the policy seam (`EgressPolicy`, decided per connected address, host name, organization and source), the open-core default (`createEnvEgressPolicy`) and the guarded fetch. The error-code ledger registers `EGRESS_REFUSED` and `EGRESS_ALLOWLIST_INVALID` under `@objectstack/core`. `MessagingServicePlugin`, `AutomationServicePlugin` and `WebhookOutboxPlugin` take an `egressPolicy` option for a stricter policy. The guard connects directly to the judged address, so an HTTP proxy configured through the environment is not used for these requests.
