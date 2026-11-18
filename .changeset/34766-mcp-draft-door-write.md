---
'@objectstack/metadata-protocol': patch
---

feat(metadata-protocol): the draft publish verdict is a public protocol method, and it reads the stored draft itself

Clause-②: yes (widening)
Metadata-protocol: none

`ObjectStackProtocolImplementation.draftPublishJudgement` is now public. It answers what publishing a stored draft would say, without publishing it: `refusals`, the issues the publish would refuse the draft on, and `advisories`, the findings a publish that passes still returns. Each issue keeps every member the publish's `422 INVALID_METADATA` carries: `rule`, `path`, `where`, `message`, `hint` (the next step) and `severity`. The draft read's `_diagnostics` folds the same verdict but drops the `hint`.

A caller that holds no stored row may omit `body`: the method then reads the stored draft at `type`, `name` and `packageId` (`null` for the draft bound to no package), and `member` for a bundled type, and judges the bytes as stored. An address that holds no draft is refused `404 NO_DRAFT`, as the strict draft read refuses it. It runs the same judgement the draft read and the publish gate run; nothing about either changes.
