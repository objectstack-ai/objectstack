---
'@objectstack/objectql': patch
'@objectstack/metadata-protocol': patch
---

fix(objectql): the duplicate-record refusal reaches the writer's locale on the action door and on bulk rows

Clause-②: yes (widening). The /data 409 and the row errors gain a `userMessage` key, with the same text as the end-user sentence. `message` keeps its diagnostic text.
Metadata-protocol: none

The engine's duplicate-record refusal already composed its end-user sentence in the writer's locale, and `/api/v1/data` answered it as the 409 body's `error`. Other doors read the user-facing sentence from `userMessage` and keep `message` as the diagnostic. The refusal did not declare that key, so an action button or a bulk edit showed the English diagnostic, for example `Duplicate record refused on '周成本': …`, where the form save showed `已存在「工厂」、「牌号」、「成本周次」均相同的记录`.

- `DuplicateRecordError` now declares the same sentence as `userMessage`. The action door (declarative and sandboxed script actions), the Hono handler-throw seam, MCP tool errors and a flow's inner refusal forward it unchanged. `message` is still the diagnostic sentence.
- Row errors from `updateMany` and `batch` (`create`, `update`, `upsert`) carry a declared `userMessage`, with the same bound the `/data` door applies. A row whose producer marked nothing carries no `userMessage`, as before.
- The flat `/data` 409 (and the whole-request `createMany` 409) gains `userMessage` beside `error`, with the same text. `error`, `code`, `field` and `developerMessage` are unchanged.

The sentence names fields by label and quotes no record value.
