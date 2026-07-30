---
"@objectstack/runtime": patch
---

test(runtime): pin who actually serves `/data` and `/discovery`, blocking the #4073 default flip on evidence

#4073 plans to retire `registerStandardEndpoints` by flipping its default to
`false`, on the premise that everything it mounts is duplicate supply. Booted for
real — real `HonoServerPlugin`, real dispatcher, real `createRestApiPlugin`, real
listener, in `serve.ts`'s registration order — that premise holds for only one
half of the surface:

- **`/discovery` + `/.well-known/objectstack` — safe.** They cede by an explicit
  `kernel.hasPlugin(rest|dispatcher)` check (#4018), so the dispatcher's computed
  payload answers whether the flag is on or off. Order-independent.
- **`/data/:object` — not safe.** There is no cede, and the shadowing was
  asserted purely on "REST registers first and wins". With the flag OFF the path
  returns **404**, with REST mounted or not. The flag's raw surface is the only
  thing answering it in every composition this harness can boot.

So the flip is not the no-op the plan describes. This adds the harness that says
so, asserting the current matrix, so the next attempt has to confront it rather
than re-derive the assumption. No production code changes.
