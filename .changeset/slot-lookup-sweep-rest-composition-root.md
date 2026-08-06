---
"@objectstack/rest": patch
---

fix(rest): sweep the REST composition root's slot lookups — 16 sites typed (#4251 B4)

Batch B4 of the #4251 sweep: every service-lookup erasure in the REST
composition root. `rest-api-plugin.ts` (15) and `external-datasource-routes.ts`
(1) now pass the slot's contract type instead of annotating the result `any`;
the ratchet baseline drops **159 → 143 sites, 34 → 32 files**, and both files
leave the grandfather list. No behaviour change.

**Every contract named here is evidenced by an `implements`.** `email`,
`sharing`, `sharingRules`, `reports`, `approvals` and `external-datasource` had
a written `packages/spec` contract all along, and the class each provider
registers into the slot declares `implements` on it (`EmailService implements
IEmailService`, `ExternalDatasourceService implements IExternalDatasourceService`,
…). So the compiler verifies the shape on the producer side on every build and
this file only has to name it — the #4404 discipline that replaced seven
unchecked local stand-ins with one checked claim. `auth`, `objectql`, `i18n`,
`analytics`, `security` and `metadata` come from the `ServiceSlotContracts`
ledger; `objectql` is `IObjectQLEngine`, not `IDataEngine`, because the consumer
reaches the full engine (the `transaction` probe behind the batch routes).

**The wrapper return annotations went with them.** Ten of these lookups sit
inside `async (environmentId?) => Promise<any | undefined>` providers, and
typing only the lookup would have re-erased the contract one line later — the
KNOWN RESIDUAL shape the rule documents and cannot see. Each provider now
returns its slot's contract.

**Three slots have no contract, and say so three different ways rather than one
`any`.** `env-registry` is typed as `RestEnvRegistry`, the shape `RestServer`'s
own constructor declares for that parameter, so the argument is checked rather
than waved through. `settings` gets a named local surface (`SettingsReadSurface`)
following B2's decision for this slot — `service-settings` is optional, so the
REST layer must not depend on it — carrying the one method the platform consumes
(`get`, through `resolveLocalizationContext`'s cascade) with the public
`ResolvedSettingValue` as its return type. `default-project` gets a narrow slice
declaring only the field this file reads. And the service-existence probe, whose
slot name is a runtime argument, is `unknown`: it asks whether something
occupies the slot and never touches its shape, which is exactly what `unknown`
says and `any` does not.

**No dead probe this batch — reported rather than implied.** Every earlier batch
in this line found one (#4361's `getMetaItem` on a service that never had it,
#4321's `registerInMemory`), so each probe the typed consumers make was checked
against its contract: `emailService.send`, `authService.getApi` /
`isAuthGateActive`, `svc.queryDataset`, `ql.transaction`, the six approval
verbs, the five security methods and the five federation methods all name real
members at real arities. The `external-datasource` route probes are now visibly
redundant-but-correct — the contract's methods are required, so `svc?.method` is
truthy whenever the service resolved, and the 503 path is reached only by the
service being absent, which is what it is for.

The new pin is a runtime test, deliberately. `packages/rest` excludes its test
files from `tsconfig.json` and declares no `typecheck` script, so no tsc program
compiles them and a type-level assertion there would evaluate never — the
phantom-check shape #5286 / #5449 paid for. What is checkable is the wiring, and
that is the risk this change actually carries: the providers are positional
arguments 6..19 of a twenty-argument constructor, all with the same
`(environmentId?) => Promise<unknown>` shape, so a provider resolving the wrong
slot is assignable everywhere and invisible to the compiler. The test drives
each provider and asserts it hands back the instance registered in ITS slot,
pins the exact set of slot names the boot resolves, and pins the degraded path
where every optional slot is empty.
