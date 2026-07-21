---
---

Add an end-to-end regression test that boots a real hono server (ObjectQL + messaging + dispatcher) and drives the in-app notifications mark-read flow over HTTP, asserting `sys_notification_receipt` rows flip to `read` and the unread count drops (#3362). Test-only (plus a test-scoped devDependency); no runtime code changes, so this releases nothing.
