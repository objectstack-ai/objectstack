---
"@objectstack/core": minor
"@objectstack/runtime": patch
---

fix(core): tell "service never registered" apart from "service failed to construct" on the async path (#13905)

`PluginLoader.getService` — reached through `Kernel.getServiceAsync` — answered two
different facts with the same bare `Error`. "Nothing ever registered this service" and
"the service is registered and could not be built" arrived at a caller as one
indistinguishable rejection, separated only by message text.

That was load-bearing one layer out. `RestServer.computeExecCtx`'s kernel branch absorbs a
failed `getServiceAsync('objectql')` and degrades to "no engine is wired", and it must keep
doing so — a kernel with no data plane is a supported configuration, declared by
`rest-api-plugin.ts` as `optionalDependencies: ['com.objectstack.engine.objectql']`. So a
multi-tenant host whose engine *failed to construct* reached the same resolver as "no
engine is wired", degrading silently where it should have refused loudly. The branch could
not be repaired from outside, because the fact it needed had been collapsed before it
arrived.

The asynchronous path now carries the distinction the **synchronous** context accessor in
`kernel.ts` has always drawn from the registry. `@objectstack/core` publishes exactly two
new symbols for it:

- `isServiceNotRegisteredError(err)` — true only when nothing was ever registered under
  that name;
- `SERVICE_NOT_REGISTERED_CODE` — the code the rejection carries.

The test is closed and its default is loud: exactly one rejection in `getService` means
"never registered" and only that one is branded, so every other way it can fail — a factory
that threw, a missing scope id, an unset loader context, a circular service dependency —
stays unbranded, and a consumer that absorbs only the branded rejection is loud about
everything else, including rejections added later.

⛔ Not message matching. Adding a second text classifier on a resolution path is the failure
mode this change removes: reading "not found" off the async path once reported every
missing service as `is async - use await` — the wrong fix, pointing at the wrong layer.

Nothing existing moves. The rejection keeps a byte-identical message and `name: 'Error'`;
the only observable change is the two added own-properties.
