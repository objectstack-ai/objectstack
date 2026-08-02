---
'@objectstack/spec': minor
---

The Studio authoring surface rejects unknown keys — plugin manifests, the flow builder, and the object designer.

All 27 shapes across `studio/` close. These are the configs a Studio extension author writes by hand, and a dropped key here is quiet in the way this campaign cares about: the plugin loads, the canvas renders, the designer opens — each contributing less than its author declared. A viewer that never appears in the switcher looks like a registration bug, not a spelling one.

**The plugin manifest gets the guidance that matters, because this file invites the mistake itself.** It says outright that the manifest is "the `package.json` equivalent" and that `contributes` is "analogous to VS Code's". That analogy is the point *and* the hazard: an author who knows VS Code reaches for its vocabulary, and every near-miss is a word that is correct over there. `displayName` → `name`, `publisher` → `author`, `contributions` → `contributes`, `activation` → `activationEvents`; and for the keys with no counterpart at all — `main`, `engines`, `categories`, `keywords`, `repository`, `icon`, `dependencies` — a sentence saying what to use instead.

`main` is the one worth calling out. An author declares an entry point, gets a plugin that loads and contributes nothing, and it looks exactly like a broken `activate()`. The rejection now says there is no entry-point key: contributions are declared in the manifest, runtime components are registered imperatively in `activate()`.

**The triage verdicts were provisional, and verifying them found one wrong.** All three files carried `(p)` from the original pass, and `plugin.zod.ts` was `mixed` — with an empty note, which is how an unexamined label survives. Reading it settles the question: all eight shapes are contribution points on a hand-written manifest. There is no wire half.

The method is worth keeping, because the original triage had none: **each file exports a `define*` factory that parses an author-written literal, and a `define*` factory is the authoring door.** That is the same lens the registered-type batches used, and it is cheaper than reasoning about who consumes the output. Recorded in the ledger for the next row that needs promoting out of `(p)`.

What this checkout could not settle, stated in the ledger rather than glossed: whether `objectui` also *constructs* these configs programmatically and parses them with extra internal keys. If it does, strictness turns that into a loud 422 at its build — detectable, with the rename suggested — rather than the silent narrowing it replaces.
