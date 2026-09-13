---
"@objectstack/lint": patch
"@objectstack/cli": patch
---

fix(lint): a hook write-set finding on a handler-authored hook reports `path: hooks[i].handler` — a key the author actually wrote — instead of the lowered `hooks[i].body.source` (#16546)

`hook-api-update-readonly-field` / `hook-api-update-readonly-when-field`
(`validate-readonly-hook-writes.ts`) and `hook-body-write-unknown-field` /
`hook-body-write-unprovisioned-anchor` / `hook-body-source-unparseable`
(`validate-hook-body-writes.ts`) all report their `path` against `hook.body`,
because that is the shape they parse. For a hook authored as an inline
`handler: async (ctx) => { … }` (39 of 39 hooks in the reference app),
`hooks[i].body` is not something the author wrote at all — `lowerCallables`
mints it from the handler before `os build` / `os lint` hand the stack to
these rules (#16095). The reported `path` therefore named a key that does not
exist in the author's own source file; grepping for `body.source` there finds
nothing.

**What changed.** `lowerCallables` now records, per `lowerCallables()` call,
which `hooks[*].handler` ref strings got their `body` minted this way (as
opposed to a `body` the author wrote directly). The CLI's four lowering doors
(`os build`, `os lint`, `os validate`, `os init`/`dev`'s scaffold validation)
pass that set through `runAuthoringRules`'s `ctx.loweredHookRefs`, and the two
hook write-set rules use it to redirect a finding on a lowered hook to
`path: hooks[i].handler` — the key that replaced the function the author
wrote — with a message suffix ("judged on the metadata body lowered from the
inline handler") explaining why. A hook whose `body` the author wrote directly
is unaffected: `path` stays `hooks[i].body.source`, unchanged.

**No verdict changed.** Which hooks are flagged, at what severity, and why is
untouched — #13653 and #4271 are unmoved by a word. Only the location a
finding points at, and the wording explaining it, are different. `os build`
and `os lint` continue to report the identical `path` and message for the
same hook (#16095's "one implementation, both commands agree" — now including
this).

No `--json` field was added or removed: `path` and `message` keep their
existing shape (string), and this is a within-type value correction for the
one subclass whose old value could never be resolved against the author's
source in the first place.
