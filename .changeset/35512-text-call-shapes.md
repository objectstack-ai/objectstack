---
'@objectstack/spec': minor
---

fix(spec): the save door refuses an undeclared text key asked for as `ctx.text?.('k')`, as it already did for `ctx.text('k')`

Clause-②: no (narrowing)
Metadata-protocol: narrowed

**BREAKING** for a hook that declares `texts` and whose code asks for a key `texts` does not declare through the optional call `ctx.text?.('k')`. Action `texts` is read the same way from the release that introduces it, so no released action is affected.

- FROM: `HookSchema` refused a key asked for literally and not declared in `texts` only for the plain call `ctx.text('k')`. `ctx.text?.('k')` and `await ctx.text?.('k')` with an undeclared key parsed green, and the runtime refused the key only when the hook ran.
- TO: the optional call is refused at save with the sentence the plain call already gets, at `body.source` for a `js` body or at `handler` for an in-process handler. Whitespace or a line break around `?.` is read too.
- Fix: declare the key under `texts.KEY` with the sentence the record keeps, or ask for one of the declared keys. A declared key is accepted in both shapes.

A key that arrives any other way (a variable, a computed name) is still judged when the code runs.

<!-- adr-0087: registered hook-action-text-key-optional-call-refused -->
