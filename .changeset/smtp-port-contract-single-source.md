---
"@objectstack/plugin-email": patch
"@objectstack/service-settings": patch
---

The SMTP port range `1-65535` is now declared once and the refusal is generated from it (#12993). It had been hand-written three times across two packages: the enforcement in `SmtpTransport`, the `(expected 1-65535)` literal in the very next line's message, and `min: 1, max: 65535` on the mail settings form's `smtp_port` field — which `@objectstack/service-settings` really does enforce (`declaredBounds` / `validatePatch`), so it is a second door rather than decoration. The first two were adjacent lines, the cheapest possible drift: changing the check without changing the sentence yields a refusal that misstates its own rule, and nothing fails.

`transports/smtp-port-contract.ts` now owns `SMTP_PORT_MIN` / `SMTP_PORT_MAX`, the predicate that applies them and the sentence that states them. The message text is **generated** rather than re-spelled, so the second spelling no longer exists to drift — the stronger of the two repairs the card named, since it deletes the drift instead of checking for it.

Nothing is accepted or refused that was not before. The move is pinned as behaviour-preserving against the previous inline expression, kept verbatim as the oracle, over a table that includes both edges, the non-finite values and the non-integers.

The settings manifest keeps its own numbers deliberately. `@objectstack/service-settings` does not depend on `@objectstack/plugin-email`, and the plugin depends on the service only as a test-only devDependency; making the manifest import the constant would add a runtime edge from a service to a plugin, invert the layering and pull `nodemailer` into the settings service's install closure. So the two are held equal by a cross-package assertion over that existing devDependency instead — the same mechanism that already holds the provider dropdown equal to `EMAIL_TRANSPORT_PROVIDERS` — and no new dependency edge is created in either direction.

This range is **not** the CLI's listen range and must never be merged with it: `os serve` floors at `0` because port 0 asks the OS to choose one to listen on, while an SMTP port is a destination and floors at `1`. Collapsing them onto one constant would silently make `0` a legal SMTP port, so the floor is pinned explicitly.
