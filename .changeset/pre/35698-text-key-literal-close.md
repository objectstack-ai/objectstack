---
'@objectstack/spec': patch
---

fix(spec): a hook's or action's `ctx.text` key is read as literal at save only when its closing quote ends the argument

Clause-②: no
Metadata-protocol: none

The save doors of `HookSchema` and `ActionSchema` read the text keys a body asks for literally (`hookTextKeysAskedIn`) and refuse one that `texts` does not declare. The reading stopped at the closing quote, so a key built from a literal — `ctx.text('follow_up' + suffix)`, `ctx.text?.('follow_up' + suffix)`, `ctx.text('follow_up'.concat(suffix))` — was read as a literal ask for `follow_up` and refused at save, though the body would run correctly once the built key is declared. The published reading already left a computed value to the run-time refusal; the save now agrees with it.

A key is literal now only when its closing quote is followed by `,` or `)`, after optional whitespace. Every literal ask the save refused before is still refused, in the same words: `ctx.text('key')`, `ctx.text('key', params)`, `ctx.text?.('key', params)`, a backtick key with no hole, and a key whose quote is followed by a comment or a line break before the comma or close. A key built from a literal is refused when the hook or action runs, naming the key, as any other computed key is. No author action is needed.
