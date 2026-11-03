---
'@objectstack/runtime': patch
---

feat(runtime): the flow and permission-set "New similar" answers name their notice by a stable `noticeCode`

Clause-②: no
Metadata-protocol: none

Both clone doors answered with an English `notice` and nothing that named it, so a console could only print the sentence verbatim, and a zh-CN screen showed English. Each answer now also carries `noticeCode` beside the unchanged `notice`, so a console can map a code it knows to its own translated sentence and fall back to `notice` for a code it does not know.

- **Flow clone** (`POST /api/v1/automation/:name/clone`): `data.noticeCode` is `FLOW_CLONE_DISABLED_COPY` (exported as `FLOW_CLONE_NOTICE_CODE` beside `FLOW_CLONE_NOTICE`), the key `CloneFlowResponseSchema` already declares.
- **Permission-set clone** (`POST /api/v1/security/permission-sets/:name/clone`): one code per notice variant, `PERMISSION_SET_CLONE_ENVIRONMENT_WIDE`, `PERMISSION_SET_CLONE_IN_PACKAGE` or `PERMISSION_SET_CLONE_IN_CREATED_PACKAGE`. The one value the sentence carries, the package, is already on the answer as `data.package`, so no parameter key is needed. Code and sentence are chosen from the same landing kind (`PERMISSION_SET_CLONE_NOTICE_CODES`, `permissionSetCloneNoticeCode`), so they cannot drift.
- **`notice` is unchanged**, byte for byte, and stays the English fallback.
