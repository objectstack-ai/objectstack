---
'@objectstack/spec': patch
---

fix(spec): a hook's or action's refusal code and reason are read as literal at save only when the quoted value closes the value

Clause-②: no
Metadata-protocol: none

The save doors of `HookSchema` and `ActionSchema` read the refusal codes and reasons a body throws literally (`hookRefusalCodesThrownIn`, `hookRefusalReasonsThrownIn`) and refuse one that `refusals` does not declare. The four readers stopped at the closing quote, so a value built from a literal — `throw { code: 'OVER' + suffix }`, `e.code = 'OVER' + suffix`, `reason: 'too' + suffix`, `e.reason = 'too' + suffix`, or a member access such as `'OVER'.concat(suffix)` — was read as the literal `OVER` or `too` and refused at save, though the body would run correctly once the built value is declared. The published reading already left a computed value to the run-time refusal; the save now agrees with it.

A property value is literal now only when its closing quote is followed by `,` or `}`, after optional whitespace. An assigned value is literal only when its closing quote is followed by `;`, `,`, `}` or `)`, by the end of the source, or by a line end whose next line does not continue the expression (a next line opening with an operator, a member access, a bracket or a template continues it). Every literal code or reason the save refused before is still refused, in the same words: `throw { code: 'X' }`, `throw Object.assign(new Error(), { code: 'X' })`, `e.code = 'X';`, `e.code = 'X'` at a line end, and the same for a reason, a listed reason included. A value built from a literal is refused when the hook or action runs, naming the code or reason, as any other computed value is. No author action is needed.
