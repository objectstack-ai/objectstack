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

**The refusal now carries its classification.** `HookBodyExtractionError` (new
export, with `HookBodyRefusalKind`) names which rule refused —
`free-identifiers` / `forbidden-token` / `unparseable` — and `lowerCallables`
carries it plus the identifier list on each `bodyExtractionWarnings` entry
(also new in `os build --json`). That classification was computed at the throw
and flattened into a message string; it is now structure a consumer can act on.

**`os lint` is the first consumer, and it tells the two classes apart.** They
used to share one catch, so they shared one fate:

- **accidental** (`free-identifiers`) — the handler *is* expressible as a
  metadata body; it merely names a module-scope const, helper or import. Now a
  lint **`error`**, so a gate can fail on it. `os lint` exits 1.
- **structural** (`forbidden-token`) — `fetch`/`require`/`process`/… are
  capabilities the sandbox does not have, so writing one *is* choosing a bundled
  closure and the bundle is the designed answer. Reported as a **`warning`**,
  never fatal.

An author who deliberately wants a bundled closure keeps two channels that
already existed and are still silent: give the hook an explicit `body`, or move
the function into the top-level `functions:` map and reference it by name.

**What did NOT change: what `os build` accepts.** The catch in `lowerCallables`
stays, both classes still fall back to bundling, and the build still exits 0 —
verified over a real spawned `os build`. Flipping that default is a separate
contract decision. The new rule runs the *same* `extractHookBody` the build
runs, so the lint verdict cannot drift from what the build would do to the same
handler.
