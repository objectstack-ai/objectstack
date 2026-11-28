---
'@objectstack/runtime': patch
---

fix(runtime): a script action whose write a validation refused answers with the localized message alone, not "ValidationError: …"

Clause-②: no
Metadata-protocol: none

- When a field validation refused a write a script action made, the failure toast showed the error's class name in front of the message, for example `ValidationError: 时长（分钟）的小数位数不能超过 0 位(当前 1 位)`. A form save of the same refusal shows the message alone. Now the action's `error.message` is the message alone too.
- This covers any refusal that carries a `code` or `fields` under an error class whose name ends in `Error`. The class name stays in the server log line, and `error.code` (`VALIDATION_FAILED`) and `error.details.fields` are unchanged.
- A crash (`TypeError: …`, `ReferenceError: …`) keeps its name and still answers 500. An error class thrown without a code keeps its name, as before.
