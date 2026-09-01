---
'@objectstack/cli': minor
---

feat(cli): `os lint` refuses a hook body that silently stopped being metadata (#13651)

An L2 hook handler is lowered to a metadata-only `body.source` and evaluated in
QuickJS with no module scope. When the handler reaches out of that scope,
`extractHookBody` refuses — and `lowerCallables` caught the refusal, recorded it,
and shipped the callable through the back-compat `.mjs` bundle instead. `os build`
exited 0. The hook kept working locally. What changed silently was the
**deployment shape**: the app had stopped being shippable as pure metadata.

The refusal was never the missing piece — `extractHookBody` had already computed
the exact free-identifier list. What was missing is that nothing said no to the
recorded array.

**The refusal now carries its classification — and what that publishes rides
on two CLI surfaces, not on new API exports.** Internally,
`HookBodyExtractionError` (with `HookBodyRefusalKind`) names which rule
refused — `free-identifiers` / `forbidden-token` / `unparseable` — and
`lowerCallables` records it beside the identifier list on each
`bodyExtractionWarnings` entry. Those types are module-internal: the package
`exports` map exposes only `.` and `./console`, and `src/index.ts` re-exports
none of them. What this release actually publishes is:

- **`os lint`'s exit contract** — the new `hook-body/not-lowerable` rule is an
  `error`, so `os lint` can now exit 1 where it previously exited 0.
- **`os build --json`** — each `bodyExtractionWarnings` entry now carries
  `kind` and `freeIdentifiers` fields beside the unchanged `origin`/`reason`.

**`os lint` is the first consumer, and it tells the classes apart.** They
used to share one catch, so they shared one fate:

- **accidental** (`free-identifiers`) — the handler *is* expressible as a
  metadata body; it merely names a module-scope const, helper or import. Now a
  lint **`error`**, so a gate can fail on it. `os lint` exits 1.
- **structural** (`forbidden-token`) — `fetch`/`require`/`process`/… are
  capabilities the sandbox does not have, so writing one *is* choosing a bundled
  closure and the bundle is the designed answer. Reported as a **`warning`**,
  never fatal.
- **instrument** (`unparseable`, or a failure of the extractor itself) — the
  tool could not judge the body at all. Reported as a **`warning`** under its
  own rule, with prose that names the instrument — never as if the author chose
  a bundle, because an instrument failure is not a verdict about the author.

An author who deliberately wants a bundled closure keeps two channels that
already existed and are still silent: give the hook an explicit `body`, or move
the function into the top-level `functions:` map and reference it by name.

**What did NOT change: what `os build` accepts.** The catch in `lowerCallables`
stays, both classes still fall back to bundling, and the build still exits 0 —
verified over a real spawned `os build`. Flipping that default is a separate
contract decision. The new rule runs the *same* `extractHookBody` the build
runs, so the lint verdict cannot drift from what the build would do to the same
handler.
