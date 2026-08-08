---
"@objectstack/spec": patch
"@objectstack/metadata-protocol": patch
"@objectstack/runtime": patch
---

fix(spec,metadata-protocol,runtime): one place decides what an unset `NODE_ENV` advertises (#5936)

A deployment whose operator never exported `NODE_ENV` must not describe itself as
`development` on `/discovery`: `environment` is a machine-readable field, a client
reads it to answer "am I talking to production?", and it may skip production warnings
or loosen a destructive action's confirmation on the answer. #5673 ruled that in and
fixed it — but only for one of the two producers, because that dispatch put
`packages/spec` out of scope. The other one, `MetadataProtocol.getDiscovery()` (served
by `@objectstack/rest`), went on answering `development` for exactly that input.

The default now lives in the shared mapper, `resolveDiscoveryEnvironment`: an absent —
or blank — value resolves to `production`, and both producers pass the operator's value
through as they read it, neither carrying a default of its own. That is what makes it
one decision instead of two copies, and it means the next discovery producer inherits
the right answer without anyone remembering to copy a line. Patching only
metadata-protocol would have left a second copy of the default — precisely the drift the
shared table was created to prevent (#4828).

"Unset" includes a blank value: `NODE_ENV=` exports an empty string, the runtime's
`getEnv` has always folded that into its default, and had the mapper treated blank as
"anything else" the two producers would have drifted again on that one input.

**#4828's rule is untouched, and it points the other way on purpose.** A value that IS
set but is not a spelling this repo recognises (`qa`, `preview`) still degrades to
`development`, so nothing ever claims `production` on a guess. Absence is not a guess —
it is the host declining to say.

Behaviour change to expect: a host that exports no `NODE_ENV` and serves `/discovery`
through `@objectstack/rest` now advertises `environment: "production"` where it
previously advertised `"development"`. A deployment that genuinely is development should
say so — `NODE_ENV=development` — which is what the runtime dispatcher has already
required since #5673.

The mapping table above `NODE_ENV_TO_DISCOVERY_ENVIRONMENT` is corrected in the same
pass: its `unset / anything else -> development` row had been false for the runtime
caller since #5673 and is now two rows, one per rule.
