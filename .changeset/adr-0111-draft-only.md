---
---

ADR-0111 (docs only, releases nothing): record sharing needs a management-authority
model ("who may manage a share") and an explicit verb boundary ("which verbs a
share level grants"). Design record for the #3902 fixes — the unauthorized
`/shares` and `/sharing/rules` surfaces, and `edit`-level share also opening delete.
