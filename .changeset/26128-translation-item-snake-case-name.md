---
'@objectstack/spec': patch
---

fix(spec): `TranslationItemSchema.name` no longer tells authors to name a translation item after its locale tag

Clause-②: no
Metadata-protocol: none

The `name` describe said a translation item was "conventionally the locale code (`zh-CN`)", but the metadata save door's item-name grammar refuses `zh-CN` (uppercase and a hyphen), so an author or agent following the describe got a 400 `INVALID_REQUEST` on the first save. The describe now says a translation item is named in snake_case like every metadata item (e.g. `zh_cn`), with the BCP-47 tag in `locale`. The save door and the runtime sync's read-side name fallback for rows stored before `locale` became required are unchanged; the sync's skip warning now points authors at `locale` only.
