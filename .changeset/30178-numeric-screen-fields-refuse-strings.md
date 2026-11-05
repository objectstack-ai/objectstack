---
'@objectstack/service-automation': patch
'@object-ui/app-shell': patch
---

fix(automation)!: a `currency` or `percent` screen field refuses a non-number on resume, as a `number` field does, and the console renders `percent` as a numeric input (#30178)

Clause-②: yes (narrowing) — `POST …/runs/RUN/resume` refuses a string under a `type: 'currency'` or `type: 'percent'` screen field, a bag it accepted before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes: ScreenFieldConfigSchema keeps its shape, and the screen-field type stays an open widget hint. What narrows is the resume door's accept set for one value shape on two existing members, so there is nothing at rest for a migration to rewrite; the caller sends a JSON number. -->

**BREAKING** accept-set narrowing at the screen-flow resume door.

- **Before.** A `type: 'percent'` or `type: 'currency'` screen field took any string on resume: `"75"` under a `max` of 60, `"abc"` too. The bound compares numbers, so it never judged a string, and the run consumed its suspension on the value. The console rendered `percent` as a text input and posted a string, so a `percent` field's `min` / `max` held for no console user.
- **Now.** `number`, `currency` and `percent` are one value domain: a present value that is not a finite JSON number is refused with `invalid_type` inside `400 INVALID_SCREEN_INPUT`, the suspension is kept, and a corrected resume still lands. A numeric string is not read as the number it spells. The console renders `percent` as a numeric input carrying `min` / `max`, so it posts a number and the browser stops an over-limit value before any request.
- **Unchanged.** An absent value and a hidden field are not judged; `rating`, `slider`, `progress`, `text` and untyped fields still take a string; a JSON number on `currency` / `percent` is judged against the bound as before.

**FROM → TO.** A caller that posts `{ "discount": "60" }` to a `percent` or `currency` screen field posts `{ "discount": 60 }`.
