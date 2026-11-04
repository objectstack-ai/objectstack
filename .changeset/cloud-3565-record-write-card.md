---
'@object-ui/plugin-chatbot': patch
---

feat(plugin-chatbot): the record-write card — ONE record the chat proposes and the user confirms, with 确认 / 打开完整表单 / 取消 (cloud#3565)

Clause-②: no
Metadata-protocol: none

The cloud chat's `create_record` / `update_record` tools queue a HITL pending action in the user's name and answer the approval envelope plus the record: `{ status:'pending_approval', pendingActionId, recordWrite:{ operation, objectName, objectLabel, recordId?, label?, reason?, fields:[{ name, label, type, value, current? }], dropped } }`. The chat now draws that as a card instead of the generic Approve / Deny strip and the raw payload:

- **New export** `detectRecordWrite(result)` (with the `RecordWrite` and `RecordWriteField` types), lifted onto `ChatbotEnhancedToolInvocation.recordWrite` by the live mapper beside `pendingActionId`. It reads the bare object, the persisted `{ type:'text', value }` wrapper and a JSON string; an envelope without the pending id or without a field to confirm is not a card.
- **The card** (`data-testid="record-write"`): the create or update title with the object's label, the record's label and reason, every field as a labelled row — an update shows the stored value struck through, then →, then the proposed one — the fields the server left out and why, and three buttons. 确认 calls `onToolApprove(toolCallId, true)` (the pending action's dispatcher writes as the user); 取消 calls it with `false` and `recordWriteCancelReason`; 打开完整表单 calls it with `false` and `recordWriteOpenFormReason` FIRST, then the new `onOpenRecordForm(write)` prop, so a record saved in the form is never written a second time from the card (disabled where the host passes no handler). After a decision the card says written (with the record's link through `onOpenRecord`, read from the dispatcher's `{ status:'written', objectName, recordId, label }` result), cancelled, or the server's refusal.
- **New props**: `onOpenRecordForm`, `recordWriteCreateTitle(objectLabel)`, `recordWriteUpdateTitle(objectLabel)`, `recordWriteConfirmLabel`, `recordWriteOpenFormLabel`, `recordWriteCancelLabel`, `recordWriteCancelReason`, `recordWriteOpenFormReason`, `recordWriteDroppedLabel`, `recordWriteSubmittingLabel`, `recordWriteWrittenLabel`, `recordWriteCancelledLabel`, all with English defaults.
- **「清理示例数据」** rides the same seam: `detectSampleDataCleanup(result)` (with the `SampleDataCleanup` type) lifts `{ status:'pending_approval', pendingActionId, sampleDataCleanup:{ tables:[{ objectName, label, count }], total, absent } }` onto `sampleDataCleanup`, and the chat draws the tables and counts (`data-testid="sample-data-cleanup"`, title from the new `sampleDataCleanupTitleLabel` prop) above the generic Approve / Deny strip, with the raw payload hidden.
- **`ToolDecisionState`** (widened, additive): every state may carry `decision: 'approved' | 'rejected'`, and an approved `success` may carry `result`, the dispatcher's answer. `useHitlInChat` sets both; the generic strip keeps reading `message` alone.
