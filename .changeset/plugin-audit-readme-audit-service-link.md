---
"@objectstack/plugin-audit": patch
---

Published README points at the `services.audit` reference again, in the form a published reader can follow (#9589)

PR #9531 dropped this README's "See Also" pointer to the runtime-services audit
page because the page was measured wrong — it documented `record()` /
`'set' | 'reset'` (the settings sink) as if that were the `audit` slot. PR #9587
rewrote the page around the real slot, so the reason for the omission has stopped
holding, and the link is restored.

It is restored because the page carries three things this README deliberately
does not, each verified against the page as it stands on `main` rather than
against the PR title that rewrote it:

- **the failure posture of the slot itself** — `recordAuthEvent` never throws; a
  failed ledger insert is reported at `error` level once per process and then
  drops to `debug`, the row is lost and nothing retries it, and the call silently
  no-ops when no data engine resolves or when `userId` is absent. This README
  documents the *record-view batcher's* two failure postures, which are a
  different code path; it says nothing about this one.
- **the event's field-by-field shape** — that `userId` must be a real `sys_user`
  id, that `sessionId` lands on `record_id` with `object_name` fixed to
  `sys_session`, that `organizationId` stamps the tenant columns and an unstamped
  row is one non-administrator members can never see, and that `context` is
  serialized into `metadata`. This README states the slot's interface and its
  closed `'login' | 'logout'` action union, and deliberately stops there.
- **the settings-sink disambiguation** — that `SettingsAuditSink.record()` is
  never registered as or resolved from this slot, and that
  `getService('audit').record({ ... })` therefore fails with a `TypeError`.

The restored line is **not** the line #9531 removed. That one read
`[Audit Logging Best Practices](/content/docs/kernel/runtime-services/audit-service.mdx)`
— a label describing a best-practices guide the page has never been, and a
repo-path-rooted URL that resolves for neither of this README's published
audiences. A README in the package's `files` array is rendered on npm and on
GitHub, where a root-relative href resolves against `npmjs.com` / `github.com`,
not against the docs site. The replacement uses the absolute
`https://docs.objectstack.ai/docs/...` form that `create-objectstack`'s published
READMEs already use, and its annotation states what the page adds — so the next
author weighing the same omission can check the justification instead of
reconstructing it.

The one pre-existing site-root-relative docs link in this same file
(`/docs/permissions/permission-sets#access-depth...`, added by the same PR) is
converted to the same absolute form. Its target page and heading anchor both
exist; only the spelling was unfollowable off the docs site.
