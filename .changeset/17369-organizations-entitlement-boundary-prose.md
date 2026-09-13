---
"@objectstack/verify": patch
---

Comment-only correction: the reason `bootStack`'s cross-tenant proofs stand in for `@objectstack/organizations` is now stated as the true one.

Those doc comments said the enterprise multi-organization runtime was **cloud-private / not installable in this workspace**. ADR-0132 falsified that: the runtime is open core, Apache-2.0, and published on npm. The effect they describe has not changed, so the text now gives the reason that is actually load-bearing — **ADR-0132's entitlement boundary forbids any framework package DECLARING `@objectstack/organizations`** (`packages/plugins/organizations/src/no-framework-dependents.pin.test.ts`, its mechanical half: "Apps declare it; packages do not"), because the commercial repository ships a licence-gated subclass under the same package name. So `packages/verify` cannot depend on the runtime and cannot resolve it, the `'posture-only'` stand-in stays exactly what it was, and the proof that the real plugin walls tenants still lives in cloud's `security-enterprise` multi-organization integration test.

⛔ **No behaviour, no dependency and no public surface moves.** `BootOptions.multiTenant` accepts and does the same things it did; the only shipped bytes that change are the doc comments carried into `dist/index.d.ts`. Apps that mount the runtime keep declaring it in their own `package.json`, which is and remains the supported wiring.
