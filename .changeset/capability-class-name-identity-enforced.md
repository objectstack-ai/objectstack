---
"@objectstack/cloud-connection": patch
"@objectstack/service-automation": patch
---

fix(cloud-connection,service-automation): stop two plugin classes renaming themselves in the shipped build, and enforce the class-name identity limb against `Ctor.name` (#8645)

`Serve.providesCapability` (`packages/cli/src/commands/serve.ts`) decides whether a
host already supplied a capability's provider by comparing, by equality, both a
loaded plugin's `name` and its `constructor.name` against a declared identity
list. Every identity registry in that file therefore declares two spellings per
provider — the registered `plugin.name` id and the exported class name — and the
class-name spelling is a claim about the **built** artifact.

**Measured against the built packages, two of the 27 declared class-name
identities matched nothing at all:**

```
MISMATCH CAPABILITY_PROVIDERS.automation   declared=AutomationServicePlugin  runtime=_AutomationServicePlugin
MISMATCH Serve.MARKETPLACE_PROXY_IDENTITIES declared=MarketplaceProxyPlugin  runtime=_MarketplaceProxyPlugin
```

Both classes referenced themselves **by name inside their own body** —
`MarketplaceProxyPlugin.prototype.version` building the outbound proxy
User-Agent, and a `private static` backoff helper called from an instance method
in the automation plugin. esbuild rewrites such a class into
`var X = class _X { … _X … }` so the inner reference binds to the class binding
rather than the outer `var`, and the emitted class reports `_X` as its `.name`.

There was no user-visible impact, because every guard naming these plugins also
declares the registered id, which the instance carries as a plain field no
bundler touches. What was dead is the **redundancy**: a guard running on one
limb it does not know it is running on is one rename away from failing open —
and failing open here means silently mounting a second instance over a host's
own.

Both source idioms are replaced with module-scope declarations, so the shipped
classes keep their names. The marketplace proxy's self-reference was also
reading a field that was never there (`version` is an instance field, so
`prototype.version` was always `undefined`): its outbound `User-Agent` announced
the `?? '1.0.0'` fallback on every request and now announces the plugin's real
version, `1.1.0`.

The enforcement half lives in `packages/cli/test/serve-capability-identity.test.ts`:
every declared class-name identity, across `CAPABILITY_PROVIDERS` and the four
marketplace identity lists, is now compared to the runtime `Ctor.name` of the
export it names, and must satisfy `providesCapability` through the class-name
limb alone. The `*_IDENTITIES` statics are re-derived from `Serve` itself, so a
fifth list cannot be added without being enumerated. #8357's local
"modulo one leading underscore" accommodation is retired rather than left as a
third spelling of the same rule.
