---
'@objectstack/platform-objects': patch
---

fix(platform-objects): the import job's `error` field is labelled "Failure Reason", not "Fatal Error"

Clause-②: no
Metadata-protocol: none

Since a job whose every row failed ends `failed` with one sentence pointing at the job's results, the `error` column holds either the fatal error that aborted the job or that sentence. Headed "Fatal Error", the second case sent an administrator looking for a crash instead of the per-row reasons. The label now covers both outcomes, in the words the spec's import job progress describe uses ("Failure reason"): "Failure Reason", 失败原因 (zh-CN), 失敗理由 (ja-JP), Motivo del fallo (es-ES). Only the label moves: the field stays the same optional text area in the Outcome group.
