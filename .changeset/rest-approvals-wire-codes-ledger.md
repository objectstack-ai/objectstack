---
'@objectstack/spec': patch
---

Register the nine `@objectstack/rest` wire codes the #8885 population sweep measured outside the closed ADR-0112 vocabulary (`StandardErrorCode ∪ ERROR_CODE_LEDGER`): `THROTTLED` (429, the approvals remind cool-down rejection the spec contract documents) and the eight template-generated `APPROVAL_<ACTION>_FAILED` terminal 500 codes (`APPROVE`, `REJECT`, `REVISE`, `RESUBMIT`, `REASSIGN`, `REMIND`, `REQUEST_INFO`, `COMMENT`) whose literal-spelled siblings were already registered. No wire behavior changes — these values were already emitted; `ApiErrorSchema` now accepts what the wire actually carries.
