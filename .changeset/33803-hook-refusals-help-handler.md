---
'@objectstack/spec': patch
'@objectstack/platform-objects': patch
---

fix(spec): the hook form's refusal catalogue help names the handler beside the JavaScript body

Clause-②: no — help text only
Metadata-protocol: none

The Studio hook form's `refusals` row ended its help with "JavaScript (L2) bodies only", while `HookSchema` answers a refusal catalogue on a sandboxed `js` body and on an in-process `handler` alike, and refuses it on an `expression` body. The help now reads "For a JavaScript (L2) body or a handler; refused on an expression body", and says the code is the one the hook throws rather than the body. The translated copies in the ten metadata-form bundles of `@objectstack/platform-objects` carry the same correction. No behaviour changes: what a hook may declare, and what is refused, is exactly as before.
