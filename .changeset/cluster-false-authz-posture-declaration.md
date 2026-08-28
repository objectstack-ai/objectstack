---
"@objectstack/runtime": patch
---

docs(runtime): `cluster: false` does not mean `service-cluster` contributes nothing — say so where it is read (#12679)

No behaviour change. This ships a **statement**, at the three places an
engineer or an operator forms their belief about what the `cluster` flag turns
off, plus the pin that keeps the statement true.

Since the authorization-cache substrate (#11968), `Runtime` registers
`AuthzClusterBridgePlugin` **unconditionally** — `cluster: false` included — so
that flag stopped meaning "this package contributes nothing" without anything
saying so. That is the declared-not-equal-actual shape: someone reading
`cluster: false` in a config reasonably concludes `@objectstack/service-cluster`
does not participate, and is wrong. #12679 weighed moving the posture statement
out to `core` and **ruled against it** (option A): the registration is correct
where it is, because an authorization grants cache running with no invalidation
bus at all is the *loudest* case the posture check has, and skipping the check
under `cluster: false` would silence the platform precisely in the configuration
most worth announcing. The cost of keeping it is a flag whose name overstates
what it turns off, and the ruling pays that cost in text rather than in a
cross-package move.

- **`RuntimeConfig.cluster`'s docblock** now states what `false` actually skips
  (the two *cluster* plugins) and names the one plugin that survives it, why it
  survives, and that it stays inert on the shipped default — with
  `OS_AUTHZ_GRANTS_CACHE_TTL_MS` at `0` it attaches nothing, publishes nothing
  and logs nothing above `debug`. This text ships in the package's `.d.ts`, so
  it reaches an integrator in their editor at the moment they write the flag.
- **`content/docs/kernel/cluster.mdx` §8** carries the same statement
  author-facing, replacing "skip registration entirely" — which was accurate
  before #11968 and is not any more.
- **The `cluster: false` pin** asserts the bridge **by name, before any count**.
  It already named the bridge, but a `toHaveBeenCalledTimes(1)` ran first and
  aborted the test, so dropping the registration reported `expected 1, received
  0` — arithmetic about a security-relevant statement. It now fails with the
  plugin id and a message explaining the contract; the exact-set and count
  assertions are kept, moved after it.

Operators changing nothing see nothing change. The one observable difference
predates this changeset: under `cluster: false` the plugin *count* is 1 rather
than 0, which matters only if you assert on it.
