# @objectstack/plugin-email

## 17.0.0

### Minor Changes

- 6df5135: feat(auth): change-email now notifies the PREVIOUS address — without gating on it (#8019)

  Self-service email change verified only the **new** address, so an attacker
  holding a live session (stolen cookie, unattended device, a session not yet
  revoked) could move the account identity end to end while the original owner's
  mailbox received **nothing** — and the account-recovery path moved with it.
  Password knowledge was never required, because the session already
  authenticated the request.

  `POST /change-email` now sends an `auth.email_change_notice` mail to the address
  the account is being moved away from, stating what was requested, the new
  address, and who to contact. The notice ships in all four supported locales
  (`en-US`, `zh-CN`, `ja-JP`, `es-ES`).

  **The change itself is unchanged.** It still completes on the new address's
  verification alone — no approval step, no second click, no new gate. That is
  enforced structurally rather than promised: the notice is sent from the
  after-hook, once better-auth has already produced its response, and every
  failure it can hit (no transport, unseeded template, dead mailbox) is swallowed.
  A notification that took the flow down with it would be the exact failure this
  change exists to avoid.

  better-auth's own `user.changeEmail.sendChangeEmailConfirmation` stays **off**.
  Measured against the installed 1.7.0-rc.2, that option is not a notifier: the
  endpoint returns immediately after invoking it and the new address is never
  mailed until the old one clicks, so enabling it would add the approval gate this
  change deliberately does not introduce.

  ⛔ The notice carries no undo/rollback link. Reverting a completed change is a
  separate flow and a separate decision.

- bcfebb0: fix(cli,plugin-email)!: `OS_EMAIL_PROVIDER=resend/postmark` without an API key now fails the boot instead of silently becoming the log transport (#5132)

  **BREAKING for one configuration: a delivery provider selected without the
  credential it needs.** `os serve` used to answer that by rewriting `provider` to
  `log`, printing a warning, and booting normally. The result was a server that
  accepted every send, recorded each one in `sys_email` as sent, and delivered
  nothing — the warning scrolled past in CI logs and the truth surfaced when a
  user reported never receiving a verification code. #5087 closed exactly this gap
  inside `@objectstack/plugin-email` (`makeTransport` throws rather than
  substituting a transport); the CLI's own capability assembly kept doing it one
  layer up, for `resend` / `postmark`.

  `resolveEmailCapabilityArg` now refuses every mail configuration it cannot
  deliver through, the way its neighbouring `smtp` arm already did:

  - `resend` / `postmark` with no `OS_EMAIL_API_KEY` (or `config.email.apiKey`);
  - a `provider` tag outside `log` / `smtp` / `resend` / `postmark` — including
    the retired `sendgrid` / `ses`, which get their SMTP migration in the message.

  **Who is affected:** deployments (typically CI or preview environments) that set
  `OS_EMAIL_PROVIDER=resend` or `=postmark` without a key and relied on the
  fallback to boot. Nothing else changes — a complete configuration is passed
  through untouched, and an unset `OS_EMAIL_PROVIDER` still defaults to `log`.

  **Migration — one line, either direction:**

  - the environment is _not_ meant to send mail → `OS_EMAIL_PROVIDER=log`
    (that explicit value is the supported way to say so, and why refusing the
    others is fair);
  - the environment _is_ meant to send mail → set `OS_EMAIL_API_KEY` (or
    `config.email.apiKey`).

  Both errors name the consequence and both fixes, per AGENTS.md's
  degradation-log-level rule.

  `@objectstack/plugin-email` gains the vocabulary the CLI reads instead of
  restating: `API_KEY_EMAIL_PROVIDERS`, `emailProviderRequiresApiKey()` and the
  `ApiKeyEmailProvider` type, alongside `EMAIL_TRANSPORT_PROVIDERS` /
  `isEmailTransportProvider` / `unsupportedProviderFix` from #5094. One vocabulary,
  two consumers, pinned by a contract test — a second literal list in the CLI is
  how the settings dropdown and the transports drifted apart in the first place.

- 9c4f174: feat(plugin-email): durable email delivery through `sys_job_queue`, opt-in (#5160)

  `IEmailService.send()` has always delivered **inline**: the SMTP session ran
  inside the caller's `await`, and `EmailService`'s retry loop lived in the same
  process — so a crash between the attempt and the retry dropped the message with
  no trace beyond a `sys_email` row stuck at `queued`. The pieces for a durable
  path all existed (`sys_job_queue`, the `DbQueueAdapter`, an `email.send.async`
  subscriber) but nothing in the repo ever published to that topic.

  **New: `queueDelivery`.** With it on, `send()` persists the `sys_email` row,
  publishes an `email.send.async` job **referencing that row**, and returns
  `{ status: 'queued' }` immediately. A worker delivers the row and finalizes it
  in place (`sent` + `message_id`, or `failed` + `error`); the queue retries with
  exponential backoff (1s → 5min cap) and dead-letters the job when the attempts
  run out, so a restart resumes delivery instead of losing it. The `'queued'`
  status was already in `EmailDeliveryStatus` — no spec change.

  Three ways to turn it on, all default-off:

  - `new EmailServicePlugin({ queueDelivery: true })`
  - `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) on `os serve`
  - Settings → Mail → **Durable queue delivery**, hot-applied without a restart

  **One retry budget, not two.** `retries` keeps its meaning — total attempts are
  `retries + 1` in both modes. Inline it drives the in-process loop; queued it
  becomes the queue's `maxAttempts` and the per-row loop is pinned to one attempt
  per delivery. Turning the toggle on changes _where_ a retry happens (durable,
  backed off) and never _how many_ happen, so the two layers cannot multiply.

  **Fixed in the same change: the `email.send.async` subscriber inserted a new
  `sys_email` row per delivery.** It called `send()` with the message, so a job
  the queue retried five times left five rows — four permanently `failed`, none
  carrying the real attempt count. It now delivers the referenced row via
  `deliverPersistedRow`, so one message is one row and `attempt_count`
  accumulates on it. Messages published in the old shape (a bare `SendEmailInput`)
  are still accepted and delivered inline for a migration window.

  Boundaries worth knowing before you switch it on:

  - **"Send test email" always sends inline**, in every mode — the button has to
    report the provider's own answer (`535 …`), and "queued" is exactly the
    non-answer #5087 removed from it.
  - **Messages with attachments or custom headers are delivered inline**, because
    `sys_email` has no columns for them and a queued copy would arrive stripped.
    Queueing them is tracked separately; this ships the loss-free behaviour.
  - **A declaration that cannot be honoured fails the boot.** `queueDelivery: true`
    from the constructor or `OS_EMAIL_QUEUE_ENABLED` with no durable queue
    registered (or with `persist: false`) throws on `kernel:ready`, naming the
    fix — the #5132 judgement, applied to durability. The **settings toggle** is
    the opposite trade: it logs at `error` and keeps sending inline, because one
    save must not stop the mail.
  - The kernel's built-in in-memory `queue` fallback does **not** count as a
    durable queue: it delivers synchronously with no retry or DLQ, so publishing
    to it would report `queued` for a message nothing could ever recover. Mount
    `@objectstack/service-queue` over an ObjectQL engine (the `queue` capability
    does this on `os serve`) to get the `sys_job_queue`-backed adapter.

  Leaving `queueDelivery` unset keeps today's behaviour byte for byte.

- d25f20b: fix(plugin-email): `sys_email` rows stranded at `queued` are swept at boot, and a failed drain says so at `error` (#5161)

  `status: 'queued'` had exactly one consumer: the `afterInsert` outbox drain that
  fires during the insert itself (plus, since #5160, the `email.send.async` job
  `send()` publishes). Nothing ever looked at such a row again. A process that
  died between the insert and the delivery — or a drain whose delivery threw —
  left the row at `queued` **forever**: a state named after a queue that had no
  reader, while the caller had already been told the message was accepted.

  **A once-per-boot sweep is now that reader.** At `kernel:ready`, after the
  registries are settled and the `email.send.async` subscriber is attached,
  `sweepStrandedOutbox` picks up `sys_email` rows still at `queued` and advances
  them:

  - **durable queue delivery on** → the row is published as an `{ rowId }` job to
    `email.send.async` through the same producer, options and
    `sys_email:<id>` idempotency key `send()` uses, so a row that still has a
    pending job collapses onto it instead of putting a second worker on it;
  - **inline delivery** → the row is delivered and finalized in place (`sent` /
    `failed`), which is what the drain hook would have done had the process lived.

  Only rows **older than five minutes** are eligible. A row inserted seconds ago
  is not stranded, it is someone's in-flight work — this process's `send()`, its
  deferred drain hook, or the same on another instance — and sweeping it would
  send that message twice. (Age, not "created before this boot": one instance's
  boot time says nothing about a sibling's row inserted a second ago.) Rows this
  process is delivering right now, and rows that already carry a `message_id`, are
  skipped. The batch is bounded at 500 rows per boot, oldest first, and says so
  when it truncates. One `info` line reports the counts; boot does **not** wait on
  the sweep, and a sweep that cannot run reports at `error` rather than relying on
  `kernel:ready` error propagation.

  **Drain-hook failures are now `error`, not `warn`.** A drain that throws means
  the mail was not sent while the insert reported success and the row still reads
  `queued` — the durability class the degradation-log-level rule pins at `error`.
  Both lines now name the consequence (this message was NOT sent, the row stays at
  `queued`) and the fix (the boot sweep picks it up on the next restart; turn on
  durable queue delivery to have failures retried and dead-lettered instead).
  `deliverPersistedRow` joins `DURABILITY_CRITICAL_CALLEES`, so a future `catch`
  that quietly downgrades it fails `pnpm check:durability-log-level`.

  New exports: `sweepStrandedOutbox`, `OUTBOX_OBJECT`, `OUTBOX_SWEEP_MIN_AGE_MS`,
  `OUTBOX_SWEEP_LIMIT`, `EmailService.enqueuePersistedRow`, and
  `EmailServicePlugin.outboxSweepSettled` (the sweep's promise, for callers that
  need determinism). The normal `send()` → deliver path is byte-for-byte
  unchanged.

- ce92674: feat(email): declared email templates reach the mail service (#4509)

  Authoring an `email_template` was a silent no-op. `EmailService.sendTemplate`
  resolves `(name, locale)` against **`sys_email_template` rows**, and the only
  writers of those rows were the built-in auth templates plus a code-constructed
  `EmailServicePluginOptions.templates` that no bootstrapper ever passed. Every
  door an author can actually use — a stack's `emailTemplates:`, an
  `*.email-template.ts` file, Studio's metadata-admin list, `PUT /meta` — parked
  items in a metadata store nothing read back. So an admin could "fix" the
  password-reset email in Studio, get a success toast, and watch users keep
  receiving the built-in copy: ADR-0078 false compliance on **authentication
  mail**. This is the shape #3461 had for webhooks, closed the same way (ADR-0049
  enforce-or-remove, route: enforce).

  **`bootstrapDeclaredEmailTemplates`** now materializes declared templates into
  `sys_email_template` at boot. Each item is validated through
  `EmailTemplateDefinitionSchema.parse()` — the spec schema finally has a real
  consumer, defaults and all — and projected with `mapTemplateToRow`, which is the
  **same** mapping the built-in seeder uses, extracted and shared so the two doors
  cannot drift apart. A malformed template warns and is skipped rather than
  crashing boot.

  **Runtime writes take effect immediately.** Unlike `webhook`, `email_template`
  is `allowRuntimeCreate: true`, so a boot-only bridge would have left a Studio
  save inert until the next restart — the same bug, half-fixed. The plugin also
  subscribes to `email_template` metadata changes and re-materializes the single
  changed item; withdrawing a template deactivates its rows (across locales)
  rather than deleting them.

  **Three breaks sat on this path, not one**, and closing any two of them would
  still have shipped a template that never sent:

  - `@objectstack/objectql` never registered a manifest's `emailTemplates:` into
    the metadata registry at all — the key was simply missing from the generic
    ingestion list, so the bridge's own source was empty.
  - The built-in seeder left `managed_by` at the column's `'admin'` default, which
    made platform templates masquerade as admin-authored. Since the bridge refuses
    to overwrite admin rows, a built-in would have permanently outranked the
    template an app declared. Built-ins now stamp `managed_by: 'platform'`.
  - Nothing materialized declared metadata into rows.

  **Seed-not-clobber** mirrors `sys_webhook` (#3489) and `sys_sharing_rule`
  (#2909): `sys_email_template` gains `managed_by` / `customized`. Declared
  templates re-seed every boot as `managed_by: 'package'`; a row an admin created
  (`admin`) or edited (`customized`, stamped by a `beforeUpdate` hook) is never
  overwritten, so reworded transactional mail survives redeploys. This is a
  separate axis from `is_system`, which keeps its existing meaning for built-ins.

  The `email_template` liveness ledger flips from 13 dead properties to fully
  live, with an ADR-0054 runtime proof bound on `subject`
  (`email-template-materialization`): it boots a real stack, authors a template
  that overrides a built-in auth template, and asserts the **authored** wording is
  what reaches the transport.

- 1b9a53b: plugin-email: large attachments (>256 KiB) now get durable queue delivery, with their content held out of the `sys_email` row

  A message whose attachments exceeded the in-row budget was pushed back onto inline delivery — whole, but with none of the durability queue delivery exists to provide, which meant the platform was weakest about exactly the mail that matters most (a signed contract, an exported report). Its content now goes to the `file-storage` capability, the row records a `storageKey` plus the audit metadata, and the queue worker fetches the content back to rebuild the message.

  - **Zero migration.** `attachments_json` declared `storageKey` from the start; this adds the producer and the reader. Attachments at or under `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` still go in the row exactly as before, and the boundary includes equality.
  - **The row stays an audit log, not a blob store.** `filename` / `contentType` / `size` / `hash` stay on the row permanently; the content is a delivery artifact and is deleted a grace window (24h) after the row reaches a terminal state, at which point `storageKey` is replaced by `contentReclaimedAt`. Reclamation is a delayed `email.attachment.reclaim` queue job that carries the storage keys, so a row deleted in the meantime reclaims its content instead of orphaning it.
  - **Nothing degrades silently.** No `file-storage` capability, or an upload that fails, keeps today's behaviour — inline delivery of the whole message — and says which of the two it was and how to fix it. On the way back, content that cannot be fetched (outage, missing object, no capability on the worker, truncated or substituted bytes) fails the row loudly; a message is never delivered without an attachment it declares.

- 8597a7d: fix(service-settings,plugin-email): the mail provider dropdown lists only providers that actually deliver (#5094)

  **Settings → Mail → Provider** offered `SMTP | SendGrid | Amazon SES | Postmark`.
  `@objectstack/plugin-email` has never carried a SendGrid or an SES transport —
  `makeTransport` knows `log` / `resend` / `postmark` / `smtp` and nothing else. So
  selecting either of the two validated, saved, showed a success toast, and then
  delivered no mail at all: the same declared-but-not-delivered gap #5087 closed
  for SMTP, one field to the left.

  The same field broke the invariant in the other direction at the same time:
  **`resend` has shipped a working transport all along and was not on the list**,
  so nobody could pick the one HTTP provider that worked.

  **The dropdown is now `SMTP | Resend | Postmark | None (log only — no real
delivery)` — exactly the set `makeTransport` can build.** No email capability was
  removed with SendGrid and SES. Both publish SMTP endpoints, and #5087 shipped a
  real `SmtpTransport`, so both are configured today as `smtp`:

  | provider   | host                                | port | credentials                                                                        |
  | :--------- | :---------------------------------- | :--- | :--------------------------------------------------------------------------------- |
  | SendGrid   | `smtp.sendgrid.net`                 | 587  | username `apikey`, password = your API key                                         |
  | Amazon SES | `email-smtp.<region>.amazonaws.com` | 587  | SES **SMTP credentials** (generated in the SES console — not your AWS access keys) |

  The provider field's own description says this, so the migration is in front of
  whoever goes looking for the option that disappeared.

  `log` is listed rather than hidden. It is the one option that does not deliver —
  but it does not pretend to: the label says so, `LogTransport` still records every
  message to `sys_email`, and "Send test email" answers `ok: false` for it. That
  gives an operator the deliberate, visible opt-out AGENTS.md asks a degradation to
  be, instead of expressing "no outbound mail" as a half-filled SMTP form. It is
  also what makes _offered_ and _deliverable_ the same set rather than merely
  overlapping — which is the property a test can hold.

  **Already saved `sendgrid` or `ses`? Nothing breaks and nothing goes quiet.** The
  stored value outlives the dropdown, so `applyMailSettings` now recognises it
  explicitly: the previous transport is kept (a settings row written by an older
  release must never fail a boot), and the server logs at `error` with both halves
  AGENTS.md requires — the consequence (_no mail is delivered through it_) and the
  fix (the SMTP settings above), not a bare "unknown provider". It is checked
  _before_ the API-key check, because "set an API key" is the wrong instruction for
  a provider that has nothing to hand a key to. "Send test email" refuses the same
  way and sends nothing. Switching the provider to `smtp` and saving recovers the
  transport without a restart.

  Two smaller corrections in the same field:

  - `api_key` is now shown and required for exactly `resend` and `postmark`
    (`provider === 'resend' || provider === 'postmark'`). It was `provider !==
'smtp'`, which only worked because every non-SMTP option happened to be an
    HTTP API; `required` is enforced server-side wherever the field is visible, so
    that expression would have refused to save "None (log only)" until an API key
    it never reads had been typed in.
  - The built-in `mail/test` fallback (the one that runs when no email plugin is
    mounted) rejects any `provider` outside the manifest's own option list instead
    of answering "the form is well-formed".

  **Held by a test, in both directions.** `EMAIL_TRANSPORT_PROVIDERS` is now a
  runtime array (the `EmailTransportProvider` union is derived from it), and
  `plugin-email`'s `mail-manifest-providers.contract.test.ts` asserts set equality
  between it and the manifest's option values, then builds a real transport for
  each. Adding an option without a transport fails; adding a transport without an
  option fails. `RETIRED_EMAIL_PROVIDERS` / `isEmailTransportProvider` /
  `unsupportedProviderFix` are exported alongside it for hosts that surface the
  same guidance.

- 41c3b48: feat(plugin-email): real SMTP delivery — `SmtpTransport`, settings hot-swap, and a `mail/test` that actually sends (#5087)

  The **Mail Delivery** settings page has always defaulted to SMTP and offered a
  full host / port / TLS / username / password form. Nothing behind it delivered:
  `applyMailSettings` treated `provider: 'smtp'` as a no-op ("transport
  unchanged"), `mail/test` answered `ok: true, "Configuration looks valid … Wire
@objectstack/plugin-mail for actual delivery"` — a success toast for a message
  nobody sent, naming a package that has never existed — and the code pointed
  operators at `@objectstack/plugin-mail-smtp`, which is not in this repo or on
  npm. A workspace that selected SMTP got a green form, a green test button, and
  mail that only ever reached the log and the `sys_email` table. For deployments
  in China this left **no** working channel at all: Resend and Postmark are
  overseas HTTPS SaaS with unreliable reach and deliverability to QQ / 163 /
  enterprise mailboxes, where SMTP is the normal path (Aliyun DirectMail, Tencent
  SES, corporate mail servers).

  **`SmtpTransport` now ships in `@objectstack/plugin-email`** (ADR-0012: SMTP in
  core, implemented with `nodemailer`). `nodemailer` is a real dependency but is
  imported **lazily on the first send**, so deployments that never select SMTP —
  and non-Node runtimes — never load `node:net` / `node:tls`.

  Three doors reach it, all sharing one options reader so they cannot drift:

  - **Settings → Mail** (`smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
    `smtp_password`) hot-swaps the live transport on save, no restart.
  - **`os serve`** via `OS_EMAIL_PROVIDER=smtp` plus the new `OS_EMAIL_SMTP_HOST` /
    `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` (or `config.email.options`).
  - **Constructor**: `new EmailServicePlugin({ provider: 'smtp', providerOptions:
{ host, port, secure, user, password } })`.

  TLS is one toggle with the wire behaviour derived from the port, as providers
  document it: on `465` implicit TLS (SMTPS); on any other port a **required**
  STARTTLS upgrade, so a server that refuses to upgrade fails the send instead of
  leaking credentials over a cleartext socket; `secure: false` connects in the
  clear and upgrades only when STARTTLS is offered.

  **Failure is loud everywhere, because a silent fallback is the bug this fixes.**
  On the construction path (CLI / plugin options) a `smtp` provider with no host
  **throws** and the boot fails — it no longer degrades into a LogTransport that
  reports every send as successful. On the settings hot-swap path a save can never
  kill a running server, so the previous transport is kept — but the failure is
  logged at `error` naming the consequence and the fix, and **`mail/test` now
  performs a real delivery** through the settings on screen and reports the SMTP
  server's own words (`535 … authentication failed`) instead of a green toast. The
  built-in fallback `mail/test` handler (used only when no email plugin is
  mounted) answers `ok: false` and says plainly that nothing was sent.

  Nothing to migrate: `log`, `resend` and `postmark` behave exactly as before, and
  a deployment that never selects `smtp` is unaffected.

- f104bab: feat(plugin-email,platform-objects): `sys_email` carries headers and small attachments, so those messages become durably deliverable (#5177)

  Durable email delivery works from the **row**, not from the in-memory message:
  `send()` publishes an `{ rowId }` job (#5160), the boot sweep re-reads rows
  (#5161), and both end at `rowToNormalized`. So anything a `sys_email` row could
  not carry, a row-based delivery would have dropped — and custom headers and
  attachments were exactly that. The honest workaround was to refuse: a message
  with either was pushed back onto inline delivery so that it would at least go
  out whole, which closed the durable path to precisely the mail most worth
  making durable (a signed receipt, a `List-Unsubscribe` header, an invoice PDF).

  `sys_email` now has two columns, and those messages are queueable.

  **`headers_json`** — the custom headers, as a JSON object. Written in both
  delivery modes (it is audit evidence as much as delivery input) and rebuilt on
  read. Headers are no longer a reason to fall back to inline delivery.

  **`attachments_json`** — attachments as a JSON array of
  `{ filename, contentType?, size, hash, cid?, contentForm, inline?, storageKey? }`,
  content base64 in `inline`. Written when the **combined raw size of one
  message's attachments is within `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` (256 KiB,
  exported from `@objectstack/plugin-email`)** — worst case ~350 KB of base64, so
  a row stays bounded. Both arms of the declared `content: string | Buffer`
  contract round-trip as the arm they were sent as: restoring a text attachment
  as a Buffer would silently drop `charset=utf-8` from its MIME part and let the
  recipient's client mis-decode a UTF-8 file, so `contentForm` records which one
  it was. `cid` travels too — an inline `<img src="cid:…">` is unusable without
  it.

  **Over the limit, nothing changes.** The message is delivered inline exactly as
  before, whole, and the row stores no attachment content; the reason is stated
  at `info` (a bound, not a degradation — the worst outcome is today's
  behaviour). Out-of-row storage for large attachments is #5172; `storageKey` is
  declared now so that lands as a new _producer_ rather than a data migration.

  Rows written before these columns exist read exactly as they did. A column that
  is present but does not describe what it claims — malformed JSON, a size or
  hash that disagrees with the content, a missing `contentForm` — is **rejected**,
  and the row lands at `failed` carrying the reason, rather than being delivered
  with a part quietly missing.

  The `sys_email` schema change is additive (two optional textarea columns); no
  migration is required and default inline delivery is unchanged.

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- 205e81b: fix(plugin-email)!: `EmailPersistence.insert` must return the row's own id — a substituted id is rejected instead of double-sending (#5523)

  **FROM** — `insert` could answer with an id of its own (a database-assigned
  primary key, an external delivery system's receipt id) and `EmailService.send()`
  adopted it: the substituted id was added to the service-managed set, used as the
  queued job's `rowId`, and returned to the caller.

  **TO** — `insert` must confirm the id it was handed. Returning a different id
  throws, naming the contract and the value returned, **before the message is
  delivered**.

  **Fix, one line:** return `{ id: row.id }` (or `row.id`) from `insert`. If your
  store assigns its own primary key, keep the service-minted id in the row's `id`
  column and record the store's key in a column of its own.

  Why the contract tightened rather than the service accommodating both: the id is
  minted by the service _before_ the insert and is already load-bearing by the time
  `insert` is called — out-of-row attachment content has been uploaded under
  `sys_email/attachments/<row.id>/…`, so the row id is the only key that finds
  those bytes again. Re-keying the row also broke delivery exactly-once: the
  `sys_email` `afterInsert` outbox drain hook decides whether a freshly-inserted
  row is the service's to deliver by asking `isServiceManaged()` about **the
  inserted row's own id**, and that hook runs _inside_ the insert — before `send()`
  had seen, let alone reserved, the substituted id. So the hook read the row as an
  application-inserted outbox entry and delivered it, while `send()` delivered it
  again down its own path: one message sent twice, two terminal updates racing on
  one row. The only thing that ever prevented it was the hook's `setTimeout(…, 0)`
  losing a race to `send()`'s inline delivery — and `transport.send` is real
  network I/O, so that race is normally lost.

  Scope of the check: it judges the confirmation's **value**, not its presence. An
  implementation that returns no id at all leaves nothing to disagree with (the
  drain hook reads the id off the inserted row, which is the minted one either
  way), so the mail still goes. An insert that _throws_ is unchanged — that stays
  an operational condition the service rides out with a warning and inline
  delivery; only a _successful_ insert that renames the row is fatal.

  Breaking for external `EmailPersistence` implementations that re-key the row —
  of which there are currently none: the in-repo implementation forwards the
  engine's own answer and ObjectQL honours the id it is handed. Filed at `patch`
  because the surface has no known external consumer and the declared TypeScript
  signature is unchanged; a maintainer who counts a narrowed public-interface
  contract as `minor`/`major` should relabel it.

- e906126: fix(plugin-email): a `sendTemplate` with no locale renders the documented en-US default, not an arbitrary row (#7731)

  With an i18n bundle in `sys_email_template` — `en-US` and `zh-CN` rows under one
  name — a `sendTemplate` call that named no `locale` rendered **zh-CN**, on two
  consecutive fresh boots. Three declarations say en-US is the answer there
  (`SendTemplateInput.locale`, `EmailTemplateDefinitionSchema.locale`, and
  `sys_email_template`'s own object doc); the code asked the driver instead.

  Two seams, both now answering from the contract:

  - The `sys_email_template` loader moved out of `EmailServicePlugin` into
    `createSysEmailTemplateLoader`. Its no-locale branch queries
    `(name, 'en-US')` by name rather than `{ name }` unordered with `limit: 1`,
    so no driver's row order can change the answer. Every query it issues carries
    an `orderBy`, so duplicate rows for one locale resolve the same way on every
    boot too.
  - `EmailService.sendTemplate`'s ladder asks for `DEFAULT_TEMPLATE_LOCALE` when
    the caller named no locale — the en-US fallback used to run only when a
    locale _had_ been named, so the no-locale path never reached it.

  A bundle with no en-US row at all (a single-locale tenant) keeps rendering:
  the lowest locale tag in the bundle is used, ordered rather than arbitrary.
  Explicit locales are unchanged — exact match, then en-US. Language-only prefix
  matching (`zh` → `zh-CN`) is still not performed; no contract declares it.

  `SendTemplateInput.locale` (spec, doc-comment only) now spells the whole ladder
  out, including that last rung — behaviour a caller can rely on has to be
  declared where the contract is, not only where it is implemented.

- 2ff87a2: Materialize a runtime `email_template` write without a restart (#7733)

  `PUT /api/v1/meta/email_template/:name` returned 200 and persisted the row, but
  the template never reached `sys_email_template` — so sending it fell back to the
  built-in default (or nothing) until the process restarted, at which point the
  boot sweep picked the persisted row up and it worked. Neither of the live path's
  own log lines ever fired.

  The bridge was armed against the wrong announcement. `bootDeclaredTemplates`
  subscribed via `metadataService.subscribe('email_template', …)`, whose only
  producer is `MetadataManager.register()` → `notifyWatchers()`. The REST save
  does not go through there: it calls `protocol.saveMetaItem`, which persists to
  `sys_metadata`, write-throughs to the ObjectQL SchemaRegistry (the
  `[Registry] Registered email_template` line the QA run saw) and announces on its
  own post-persistence seam. `notifyWatchers` has no caller outside
  `MetadataManager`, so the watcher could not fire for a runtime write — the boot
  log said "subscribed" and meant it, just to the other door.

  `EmailServicePlugin` now bridges both doors, sharing one materializer:

  - the existing metadata-service subscription — package ingest / artifact
    reload; and
  - the protocol's mutation seam — `PUT /meta`, the Studio save behind it,
    publish and delete. The awaited ADR-0094 `registerMutationProjector` is
    preferred, as plugin-security's permission projection prefers it, so the
    write itself carries the materialization (a `PUT` followed by a read of
    `sys_email_template` is consistent, with no race window) and a failure is
    reported on the save's own `projectionApplied` instead of only in a log.
    `onMetadataMutation` is the fallback for protocols predating the projector.

  Draft saves stay inert (the ADR-0005 staging buffer), and both seams landing the
  same write is harmless — the upsert is keyed on `(name, locale)`, so the row's
  `locale` column still holds the tag `sys_email_template`'s loader queries it by.

  A delete is no longer read as a withdrawal on its own. `DELETE /meta/:type/:name`
  discards a _customization overlay_, so on an artifact-backed template it resets
  to the packaged declaration; the bridge re-reads the effective item and
  re-materializes the revealed baseline, deactivating rows only when nothing
  declares the name any more. A failed read is not an answer and deactivates
  nothing — a transient DB error must never be what stops a live template being
  sent.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- 30f1b74: fix(plugins): a declared item reaches its schema intact — retire the `i?.content ?? i` unwrap from plugin read paths (#8378)

  Ten production reads over `SchemaRegistry.listItems` unwrapped every declared
  item as `i?.content ?? i`, presuming a `{ name, content }` storage envelope.
  That envelope has **no producer**. Re-measured at these seams rather than
  inherited from #7519's measurement of `MetadataFacade`:

  - `registerMetadataCollections` (objectql) registers each stack-collection
    element as-is — `registerItem(type, item, 'name')`, no boxing;
  - `loadMetaFromDb` registers `convertStoredItem(JSON.parse(record.metadata))` —
    the parsed body, never the `sys_metadata` row (whose body column is
    `metadata`, not `content`);
  - the facade's own interim boxing of non-object values, the one writer that ever
    produced the shape, was removed by #8349.

  **Removal is a fix, not a cleanup.** None of the types read through these seams
  — `permission`, `position`, `capability`, `object`, `sharingRule`, `webhook`,
  `emailTemplate` — declares a stored `content` key; every one of them rejects it
  as an unrecognized key. So wherever the key did appear the unwrap replaced a
  whole authoring document with one of its values, and `''` — falsy but
  non-nullish — passed `??` and then died at the reader's own `filter(Boolean)`,
  dropping the item with no warning, no count and no row.

  **On email templates the harm was sharpest, and it is the one users will
  notice.** `content` really is a spelling an author can write there:
  `EmailTemplateDefinitionSchema` lists it in its `strictObject` **aliases** table
  (`content: 'bodyHtml'`). That table is a _rejection_ facility, not a conversion —
  it feeds `strictUnknownKeyError`, which runs only on the `unrecognized_keys`
  path and only builds a message; nothing rewrites the key, and the ADR-0087
  conversion layer has no `email_template` entry either. The schema was therefore
  always ready with the author's fix, and the unwrap was the one thing standing
  between the author and it: the HTML string reached
  `EmailTemplateDefinitionSchema.parse()`, which answered `Invalid input: expected
object, received string`, and the boot warning's `name` field came back
  `undefined` — so an operator could not even tell **which** template had failed.

  A template authored with `content` now yields what it was always meant to:

  > Unrecognized key(s) on this email template: `content`. Did you mean
  > `content` → `bodyHtml`?

  …named against the template it came from, and counted as `skipped` rather than
  vanishing.

  No behaviour changes for spec-valid metadata: the reads hand back exactly the
  documents they always did.

- 531fb31: fix(plugin-email): `sendTemplate` renders format filters in the RESOLVED template row's locale (#7801)

  A `sendTemplate` call that named no `locale` resolved a concrete template row
  (#7731) but left `renderOpts.locale` **unset**, so the locale-sensitive format
  filters — `{{ ts | datetime }}`, `{{ amt | number:2 }}`, `currency`, `percent`,
  `date` — did not follow the row they were rendering into. The template row is
  now the **single locale authority**: mixed-locale output (a row's body text in
  one locale, its dates and numbers in another) is a defect, not a feature.

  What changes in practice:

  - A no-locale send that resolves a **zh-CN** row — an i18n bundle with no en-US
    row at all, the locale ladder's last rung — now formats its dates and numbers
    **zh-CN**. It previously rendered `3/5/26, 2:30 PM` inside zh-CN body text,
    because the filters fell through to `formatValue`'s own `?? 'en-US'` default.
  - A no-locale send that resolves the **en-US** row is unchanged; that case only
    ever looked correct because the row's locale and the filter default happened
    to coincide.
  - An explicit `input.locale` **still wins** over the resolved row, including
    when it has no row of its own and the ladder falls back to en-US: asking for
    `fr-FR` renders the en-US body with fr-FR dates, exactly as before.
  - Also fixed in passing: an `input.locale` with surrounding whitespace
    (`'  de-DE  '`) resolved the `de-DE` row and then threw
    `RangeError: Incorrect locale information provided` out of `Intl`, failing the
    whole send. The render now binds the same trimmed tag the row lookup used.

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- Updated dependencies [50616d9]
- Updated dependencies [430dcc2]
- Updated dependencies [690ccf2]
- Updated dependencies [6a67d7a]
- Updated dependencies [098f4bb]
- Updated dependencies [333a374]
- Updated dependencies [9fe9c1d]
- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [08b5a3d]
- Updated dependencies [e027b3e]
- Updated dependencies [e6ac4bd]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [d99aeb3]
- Updated dependencies [f6609e6]
- Updated dependencies [4727eb8]
- Updated dependencies [a70358a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [d4e0809]
- Updated dependencies [80334c7]
- Updated dependencies [f63cd09]
- Updated dependencies [97e7e3c]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [5823d59]
- Updated dependencies [3140f9c]
- Updated dependencies [9500ba4]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [8828b9e]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [a8940e4]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [f724f69]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [c44dd5e]
- Updated dependencies [06be54e]
- Updated dependencies [28ad90e]
- Updated dependencies [76d74ec]
- Updated dependencies [201b31f]
- Updated dependencies [e6b1b69]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [05154a1]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [587fc91]
- Updated dependencies [de70b42]
- Updated dependencies [9b6fe7c]
- Updated dependencies [fb3d99b]
- Updated dependencies [1986594]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [52200b4]
- Updated dependencies [cdfbee2]
- Updated dependencies [ad4af62]
- Updated dependencies [debe2f6]
- Updated dependencies [d44dbfa]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [ad047d2]
- Updated dependencies [8c711fb]
- Updated dependencies [f1cc3a3]
- Updated dependencies [09e4547]
- Updated dependencies [97b0798]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [2826d1e]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [5a84d41]
- Updated dependencies [84e7be9]
- Updated dependencies [91f4c78]
- Updated dependencies [ddc2527]
- Updated dependencies [820eff9]
- Updated dependencies [a6c3f38]
- Updated dependencies [5fa04fb]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [553a47f]
- Updated dependencies [43a7a8d]
- Updated dependencies [a98085f]
- Updated dependencies [20b1a9e]
- Updated dependencies [344a22a]
- Updated dependencies [4827e91]
- Updated dependencies [8d895ff]
- Updated dependencies [86f7a20]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [203a449]
- Updated dependencies [8f9689f]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [f6472d7]
- Updated dependencies [57a3bb3]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [9c82146]
- Updated dependencies [5f9a987]
- Updated dependencies [744b8f5]
- Updated dependencies [ac37fc6]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [2f3e793]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [78caf51]
- Updated dependencies [7d21581]
- Updated dependencies [37785ed]
- Updated dependencies [62a789b]
- Updated dependencies [2e284b2]
- Updated dependencies [d8e8d9c]
- Updated dependencies [789ad63]
- Updated dependencies [f2445c9]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [1b49eaf]
- Updated dependencies [ae31a19]
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [2e836de]
- Updated dependencies [e0f300b]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [db02d47]
- Updated dependencies [b5bdf48]
- Updated dependencies [23338c3]
- Updated dependencies [12a19a8]
- Updated dependencies [5b843fb]
- Updated dependencies [62b6a2f]
- Updated dependencies [7e5af5c]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [9d1d9c7]
- Updated dependencies [8140915]
- Updated dependencies [a019e52]
- Updated dependencies [e8f8f6c]
- Updated dependencies [41dcda3]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [b4487aa]
- Updated dependencies [1007379]
- Updated dependencies [65ca83a]
- Updated dependencies [0bfdf46]
- Updated dependencies [947d4f9]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e5bd2f6]
- Updated dependencies [e9b5265]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [67bf2e2]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [c6d1cb4]
- Updated dependencies [6513c17]
- Updated dependencies [36030ff]
- Updated dependencies [79228cd]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [2c1988c]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [c8124e5]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [376a061]
- Updated dependencies [c142ced]
- Updated dependencies [211abdb]
- Updated dependencies [b3363e9]
- Updated dependencies [eda599e]
- Updated dependencies [a1a4140]
- Updated dependencies [7c7e246]
- Updated dependencies [2ef1807]
- Updated dependencies [f35cdc5]
- Updated dependencies [d03fe25]
- Updated dependencies [217e2e6]
- Updated dependencies [2672f85]
- Updated dependencies [20bc357]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [86a71d1]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [9ea2bc5]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [d4df105]
- Updated dependencies [4615a18]
- Updated dependencies [f505689]
- Updated dependencies [d9fa683]
- Updated dependencies [606d577]
- Updated dependencies [4384921]
- Updated dependencies [e2798fa]
- Updated dependencies [3c628ce]
- Updated dependencies [c2d9098]
- Updated dependencies [0fd8556]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [e906126]
- Updated dependencies [ce92674]
- Updated dependencies [08363a0]
- Updated dependencies [444de5b]
- Updated dependencies [0f17114]
- Updated dependencies [a227ed7]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [9613396]
- Updated dependencies [3f7b4ff]
- Updated dependencies [74155c7]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [58a03d2]
- Updated dependencies [2bacd1a]
- Updated dependencies [e47b342]
- Updated dependencies [4c54037]
- Updated dependencies [dc530b4]
- Updated dependencies [9f601e8]
- Updated dependencies [6a9dec6]
- Updated dependencies [0f7157b]
- Updated dependencies [4dc1c7d]
- Updated dependencies [d9bef45]
- Updated dependencies [4dfd002]
- Updated dependencies [f549a0d]
- Updated dependencies [51c5227]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [77be690]
- Updated dependencies [4ed7ed4]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [e59786e]
- Updated dependencies [2fa4ca1]
- Updated dependencies [bcf1112]
- Updated dependencies [baeb4f0]
- Updated dependencies [29488cc]
- Updated dependencies [881a3cc]
- Updated dependencies [f5a2320]
- Updated dependencies [ad6317b]
- Updated dependencies [811c30c]
- Updated dependencies [a4a85c8]
- Updated dependencies [859cb83]
- Updated dependencies [07a4e26]
- Updated dependencies [9774b78]
- Updated dependencies [d5e9f6e]
- Updated dependencies [8a88885]
- Updated dependencies [deb538f]
- Updated dependencies [b49ccfd]
- Updated dependencies [5b89711]
- Updated dependencies [85d95e7]
- Updated dependencies [08cd163]
- Updated dependencies [0c8a22f]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [763931e]
- Updated dependencies [ec975f1]
- Updated dependencies [168f60f]
- Updated dependencies [b07d829]
- Updated dependencies [de9af8a]
- Updated dependencies [eb4204b]
- Updated dependencies [a80302a]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [474f131]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [e8d0c21]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [cafec0a]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [c4df271]
- Updated dependencies [c8d6f6e]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [7dc1067]
- Updated dependencies [4f13be2]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [61cc079]
- Updated dependencies [45dc446]
- Updated dependencies [0e96e46]
- Updated dependencies [c1d44f7]
- Updated dependencies [59b794f]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [fc3a36a]
- Updated dependencies [ab9fb5c]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f985b3f]
- Updated dependencies [795b6e1]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [175d789]
- Updated dependencies [f549a0d]
- Updated dependencies [524151c]
- Updated dependencies [427344c]
- Updated dependencies [8af76ae]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [b85cc54]
- Updated dependencies [a36db28]
- Updated dependencies [7a8476f]
- Updated dependencies [518ca7a]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9a4932a]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [9e2caf3]
- Updated dependencies [4856789]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [c3f4916]
- Updated dependencies [55dbbba]
- Updated dependencies [33e0385]
- Updated dependencies [dac6a08]
- Updated dependencies [72c3c86]
- Updated dependencies [2d8dba3]
- Updated dependencies [7f1a635]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [f9fc874]
- Updated dependencies [d62f8eb]
- Updated dependencies [d0a5ceb]
- Updated dependencies [a7586cd]
- Updated dependencies [4c5e80e]
- Updated dependencies [4b5702a]
- Updated dependencies [011b386]
- Updated dependencies [e18a162]
- Updated dependencies [e98fb14]
- Updated dependencies [394b7a1]
- Updated dependencies [ce92674]
- Updated dependencies [0f2fdcd]
- Updated dependencies [d6d1a50]
- Updated dependencies [cf2c9b7]
- Updated dependencies [8ffa8b9]
- Updated dependencies [d127ff0]
- Updated dependencies [674ac99]
- Updated dependencies [833b512]
- Updated dependencies [1b9a53b]
- Updated dependencies [36d90fc]
- Updated dependencies [7777e8f]
- Updated dependencies [9b86cf6]
- Updated dependencies [d063a96]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
- Updated dependencies [677b591]
- Updated dependencies [cf7c694]
- Updated dependencies [ddd0f06]
- Updated dependencies [d77d1b7]
- Updated dependencies [0f9faa2]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [5b79a34]
- Updated dependencies [502564d]
- Updated dependencies [603cab8]
- Updated dependencies [c757854]
- Updated dependencies [471839d]
- Updated dependencies [507b92a]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [df95346]
- Updated dependencies [3dede58]
- Updated dependencies [c6b6bb4]
- Updated dependencies [594508e]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [59c544d]
- Updated dependencies [0045682]
- Updated dependencies [7309c81]
- Updated dependencies [2f59da0]
- Updated dependencies [d56012f]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [9051802]
- Updated dependencies [20bc1ec]
- Updated dependencies [1c625ca]
- Updated dependencies [2f8328c]
- Updated dependencies [2a6c279]
- Updated dependencies [9319586]
- Updated dependencies [8c8f0df]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [90c2b15]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [08863dd]
- Updated dependencies [071d0dc]
- Updated dependencies [f293d45]
- Updated dependencies [56664f5]
- Updated dependencies [71f205d]
- Updated dependencies [f067930]
- Updated dependencies [414395b]
- Updated dependencies [42eeb7d]
- Updated dependencies [31cbe90]
- Updated dependencies [6b7129a]
- Updated dependencies [c5adfe1]
- Updated dependencies [97ace2a]
- Updated dependencies [26e1029]
- Updated dependencies [0a936ea]
- Updated dependencies [90bbf25]
- Updated dependencies [023c00b]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [01e124d]
- Updated dependencies [ef7b5ef]
- Updated dependencies [9514767]
- Updated dependencies [8f20201]
- Updated dependencies [155507e]
- Updated dependencies [643b7c7]
- Updated dependencies [7bba90b]
- Updated dependencies [8813b90]
- Updated dependencies [108ba8d]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [7ce02eb]
- Updated dependencies [b4ad984]
- Updated dependencies [e7a7506]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [7e05d8e]
- Updated dependencies [8f1851e]
- Updated dependencies [61ea810]
- Updated dependencies [2233a85]
- Updated dependencies [67452d1]
- Updated dependencies [089767f]
- Updated dependencies [a13827e]
- Updated dependencies [66d99ec]
- Updated dependencies [cb43296]
- Updated dependencies [b61afc1]
- Updated dependencies [79021fc]
- Updated dependencies [7733604]
- Updated dependencies [4921a95]
- Updated dependencies [40e420f]
- Updated dependencies [62dd69a]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [0fc6219]
- Updated dependencies [061406d]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [4cc4fb7]
- Updated dependencies [cc2de0e]
- Updated dependencies [97b6658]
- Updated dependencies [28d1eb7]
- Updated dependencies [06770c0]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [27358d5]
- Updated dependencies [1c3da1f]
- Updated dependencies [c1f344b]
- Updated dependencies [3eb1b2b]
- Updated dependencies [9c93465]
- Updated dependencies [a34fd2e]
- Updated dependencies [ebb209c]
- Updated dependencies [76bcb83]
- Updated dependencies [59b85c0]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [78f0be8]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [35f7fb4]
- Updated dependencies [0410522]
- Updated dependencies [63b33e6]
- Updated dependencies [f163028]
- Updated dependencies [814db6d]
- Updated dependencies [a5302c7]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [2a44c1d]
- Updated dependencies [7084313]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [62f8017]
- Updated dependencies [32ff033]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [5ac93d4]
- Updated dependencies [695cfbd]
- Updated dependencies [0e043d8]
- Updated dependencies [93f267f]
- Updated dependencies [7445149]
- Updated dependencies [ec796d5]
- Updated dependencies [071d0dc]
- Updated dependencies [0024abf]
- Updated dependencies [8dd98bf]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [dadd1ad]
- Updated dependencies [acbf364]
- Updated dependencies [3ca34c1]
- Updated dependencies [7adc841]
- Updated dependencies [239c3a3]
- Updated dependencies [b8b3c64]
- Updated dependencies [2f2e63c]
- Updated dependencies [4845f85]
- Updated dependencies [486d526]
- Updated dependencies [94a0bbc]
- Updated dependencies [bf1edef]
- Updated dependencies [d6bfb3d]
- Updated dependencies [8a9c079]
- Updated dependencies [7b005b4]
- Updated dependencies [cc3555e]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [89d7b35]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [ea936f3]
- Updated dependencies [0c0fbd9]
- Updated dependencies [667b83e]
- Updated dependencies [f3141d8]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [85ec26d]
- Updated dependencies [73e576f]
- Updated dependencies [f6476fc]
- Updated dependencies [69ac82c]
- Updated dependencies [4ac12ef]
- Updated dependencies [833ed84]
- Updated dependencies [a18abf3]
- Updated dependencies [c6a4eeb]
- Updated dependencies [1659072]
- Updated dependencies [f450ae7]
- Updated dependencies [abceb0d]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [c5a5996]
- Updated dependencies [0c302a7]
- Updated dependencies [b88f5e8]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [6633337]
- Updated dependencies [21676eb]
- Updated dependencies [3f296bf]
- Updated dependencies [e474853]
- Updated dependencies [e9cb9ab]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [569611f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [f00d8d4]
- Updated dependencies [5326b36]
- Updated dependencies [aa4b90d]
- Updated dependencies [ccd9397]
- Updated dependencies [503be86]
- Updated dependencies [54299ca]
- Updated dependencies [ae490ef]
- Updated dependencies [e124711]
- Updated dependencies [dc61def]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [251e888]
- Updated dependencies [07f1822]
- Updated dependencies [e336549]
- Updated dependencies [3bb9340]
- Updated dependencies [1e604c4]
- Updated dependencies [04fab5e]
- Updated dependencies [183b4c4]
- Updated dependencies [7f713b6]
- Updated dependencies [d40f43a]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [6f23667]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [20526f5]
- Updated dependencies [efedd28]
- Updated dependencies [5d21a48]
- Updated dependencies [5278e11]
- Updated dependencies [c5eef1d]
- Updated dependencies [e5e7ee0]
- Updated dependencies [23dba62]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [c960170]
- Updated dependencies [19365b7]
- Updated dependencies [ba98e26]
- Updated dependencies [b7ed26d]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [9d4dfc4]
- Updated dependencies [1059965]
- Updated dependencies [def5919]
- Updated dependencies [ee264b2]
- Updated dependencies [60b672e]
- Updated dependencies [f104bab]
- Updated dependencies [68dea0b]
- Updated dependencies [6b441a8]
- Updated dependencies [64f8cbe]
- Updated dependencies [6cb81c7]
- Updated dependencies [61282f9]
- Updated dependencies [ce0cfe9]
- Updated dependencies [04f1182]
- Updated dependencies [3a2dde7]
- Updated dependencies [8c20f75]
- Updated dependencies [be87153]
- Updated dependencies [dd0f681]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [078e28b]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [fc5f536]
- Updated dependencies [5647006]
- Updated dependencies [e654bfd]
- Updated dependencies [01a7337]
- Updated dependencies [b45c71e]
- Updated dependencies [d71ff32]
- Updated dependencies [f8cfbb4]
- Updated dependencies [6e6c872]
- Updated dependencies [2598216]
- Updated dependencies [11949fc]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb95d97]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [1363084]
- Updated dependencies [fa5758e]
- Updated dependencies [38f7e4f]
- Updated dependencies [eb7613c]
- Updated dependencies [c57f3cf]
- Updated dependencies [ecc9110]
- Updated dependencies [9aa5510]
- Updated dependencies [e4c2dc8]
- Updated dependencies [97faca3]
- Updated dependencies [57bab76]
- Updated dependencies [c89d18c]
- Updated dependencies [1bd2795]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [aac90a5]
- Updated dependencies [3da3da5]
- Updated dependencies [1e6ab15]
- Updated dependencies [b90086a]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [a0fdc56]
- Updated dependencies [b95577a]
- Updated dependencies [0dcbc11]
- Updated dependencies [d88f3e9]
- Updated dependencies [ad5fe25]
- Updated dependencies [c183a12]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [b9f930b]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [ea90179]
- Updated dependencies [1818998]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [8064b07]
- Updated dependencies [09ee21c]
- Updated dependencies [4a56dbd]
- Updated dependencies [289d04a]
- Updated dependencies [f549a0d]
- Updated dependencies [48fbacb]
- Updated dependencies [06df4fa]
- Updated dependencies [3fc2e48]
- Updated dependencies [c9b809f]
- Updated dependencies [e8f435c]
- Updated dependencies [32386f8]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
- Updated dependencies [41610f6]
- Updated dependencies [69f1dfd]
- Updated dependencies [bbe05de]
- Updated dependencies [355e951]
- Updated dependencies [a1dd1e4]
- Updated dependencies [dadb43f]
- Updated dependencies [3556b67]
  - @objectstack/spec@17.0.0
  - @objectstack/core@17.0.0
  - @objectstack/platform-objects@17.0.0
  - @objectstack/formula@17.0.0

## 17.0.0-rc.6

### Patch Changes

- 2465133: fix(plugins): sweep the service-lookup erasures out of the plugin composition roots, and fix the two alias-only HTTP reads it exposed (#4251 B5)

  Batch B5 of the #4251 sweep: the seven remaining `packages/plugins/*` composition
  roots. 35 lookup sites that had been erased to `any` now carry the slot's
  contract, so the compiler checks what each plugin actually calls on the service
  it resolved. The ratchet drops 143 sites / 32 files to 108 / 25.

  **Two real defects, both of the shape this sweep exists to find.** Approvals'
  actionable-link pages (ADR-0043) and sharing's public share-link REST routes each
  read the HTTP server under `http-server` _only_ — the deprecated alias. The
  ledger records `http.server` as canonical and as the only name present on every
  provider path: `runtime.ts`'s `config.server` path registers no alias at all. On
  that path both lookups threw, the surrounding `catch` swallowed it, and the
  routes silently never mounted — approval e-mail action links 404'd and the
  share-link surface was absent, with nothing in the log to say so. Both reads are
  now canonical-first with the alias as fallback, each name in its own `try`
  because `getService` throws on an empty slot (so `a() ?? b()` inside one `try`
  never reaches `b` — the same correction #4393 made in metadata and
  cloud-connection).

  Typing choices follow the batch method: pure data-plane consumers take the
  narrow contract (`IDataEngine` in reports), consumers that bind hook or
  middleware seams take the engine seen whole (`IObjectQLEngine` in approvals,
  sharing and pinyin-search), and slots with no contract get a **named** local
  surface rather than `any` — plugin-email's `MailSettingsSurface`, and the
  surfaces the consuming packages already declared (`ApprovalMessagingSurface`,
  `SharingSecurityProbe`, `ReportEmail`). A named surface that omits a member
  still makes the compiler name every call site; `any` says nothing.

  No behaviour change beyond the two alias reads. No contract changes.

- Updated dependencies [3d5c090]
- Updated dependencies [e5bd768]
- Updated dependencies [e027b3e]
- Updated dependencies [c2429b0]
- Updated dependencies [445a0c2]
- Updated dependencies [f6609e6]
- Updated dependencies [a70358a]
- Updated dependencies [97e7e3c]
- Updated dependencies [8828b9e]
- Updated dependencies [53068c1]
- Updated dependencies [ee58392]
- Updated dependencies [f16e54e]
- Updated dependencies [06be54e]
- Updated dependencies [259459d]
- Updated dependencies [3f7f14e]
- Updated dependencies [6968885]
- Updated dependencies [eaed61f]
- Updated dependencies [debe2f6]
- Updated dependencies [97b0798]
- Updated dependencies [5fa04fb]
- Updated dependencies [43a7a8d]
- Updated dependencies [73f69dc]
- Updated dependencies [04c56aa]
- Updated dependencies [b3efeb7]
- Updated dependencies [ddd075a]
- Updated dependencies [88154be]
- Updated dependencies [e8dc61e]
- Updated dependencies [2f3e793]
- Updated dependencies [d8e8d9c]
- Updated dependencies [94e749b]
- Updated dependencies [ea1d916]
- Updated dependencies [ae31a19]
- Updated dependencies [b230e5e]
- Updated dependencies [5d24f4b]
- Updated dependencies [29b94ed]
- Updated dependencies [07c68b0]
- Updated dependencies [f6cd635]
- Updated dependencies [e0f300b]
- Updated dependencies [62b6a2f]
- Updated dependencies [5b4780b]
- Updated dependencies [a933452]
- Updated dependencies [8140915]
- Updated dependencies [7b48cf9]
- Updated dependencies [b5404f4]
- Updated dependencies [f764691]
- Updated dependencies [e120a5a]
- Updated dependencies [e9b5265]
- Updated dependencies [e650d67]
- Updated dependencies [04476e7]
- Updated dependencies [79228cd]
- Updated dependencies [b3363e9]
- Updated dependencies [2ef1807]
- Updated dependencies [d03fe25]
- Updated dependencies [2672f85]
- Updated dependencies [11066f6]
- Updated dependencies [916af17]
- Updated dependencies [84c86fb]
- Updated dependencies [2a2a9fb]
- Updated dependencies [a2e157c]
- Updated dependencies [95c4227]
- Updated dependencies [2a61116]
- Updated dependencies [d4df105]
- Updated dependencies [e2798fa]
- Updated dependencies [0fd8556]
- Updated dependencies [74155c7]
- Updated dependencies [6908830]
- Updated dependencies [8b06bba]
- Updated dependencies [4c54037]
- Updated dependencies [0f7157b]
- Updated dependencies [d9bef45]
- Updated dependencies [f549a0d]
- Updated dependencies [82da264]
- Updated dependencies [f586f1a]
- Updated dependencies [9b9b70f]
- Updated dependencies [f5a9bc2]
- Updated dependencies [881a3cc]
- Updated dependencies [ad6317b]
- Updated dependencies [d5e9f6e]
- Updated dependencies [8a88885]
- Updated dependencies [5f7669e]
- Updated dependencies [becbe53]
- Updated dependencies [b127c8b]
- Updated dependencies [a80302a]
- Updated dependencies [474f131]
- Updated dependencies [050cd82]
- Updated dependencies [4d552af]
- Updated dependencies [44d677c]
- Updated dependencies [c32944d]
- Updated dependencies [1dd780f]
- Updated dependencies [cafec0a]
- Updated dependencies [c8d6f6e]
- Updated dependencies [92a67f2]
- Updated dependencies [9136327]
- Updated dependencies [bf0ae99]
- Updated dependencies [cb3b6cd]
- Updated dependencies [73b7234]
- Updated dependencies [d2b97c3]
- Updated dependencies [59b794f]
- Updated dependencies [fc3a36a]
- Updated dependencies [69787f0]
- Updated dependencies [5d022a1]
- Updated dependencies [042b9ee]
- Updated dependencies [f549a0d]
- Updated dependencies [a36db28]
- Updated dependencies [3f8817a]
- Updated dependencies [a2443e3]
- Updated dependencies [e1554b1]
- Updated dependencies [4856789]
- Updated dependencies [c3f4916]
- Updated dependencies [33e0385]
- Updated dependencies [2205363]
- Updated dependencies [09fe58d]
- Updated dependencies [d0a5ceb]
- Updated dependencies [e18a162]
- Updated dependencies [d6d1a50]
- Updated dependencies [d127ff0]
- Updated dependencies [9b86cf6]
- Updated dependencies [8825a06]
- Updated dependencies [5087ac6]
- Updated dependencies [6965160]
- Updated dependencies [2d1ddf0]
- Updated dependencies [354b00f]
- Updated dependencies [3de535b]
- Updated dependencies [fe2e15a]
- Updated dependencies [c6b6bb4]
- Updated dependencies [59c544d]
- Updated dependencies [2f59da0]
- Updated dependencies [8ad609c]
- Updated dependencies [bbee302]
- Updated dependencies [08863dd]
- Updated dependencies [56664f5]
- Updated dependencies [31cbe90]
- Updated dependencies [90bbf25]
- Updated dependencies [eb91eba]
- Updated dependencies [42da73d]
- Updated dependencies [643b7c7]
- Updated dependencies [d0d5205]
- Updated dependencies [1a15893]
- Updated dependencies [b70e534]
- Updated dependencies [2233a85]
- Updated dependencies [62dd69a]
- Updated dependencies [e15e679]
- Updated dependencies [2ab1257]
- Updated dependencies [4cc4fb7]
- Updated dependencies [28d1eb7]
- Updated dependencies [2c26040]
- Updated dependencies [f758cec]
- Updated dependencies [78f0be8]
- Updated dependencies [35f7fb4]
- Updated dependencies [a5302c7]
- Updated dependencies [7084313]
- Updated dependencies [0e043d8]
- Updated dependencies [dadd1ad]
- Updated dependencies [2f2e63c]
- Updated dependencies [486d526]
- Updated dependencies [89d7b35]
- Updated dependencies [85ec26d]
- Updated dependencies [f6476fc]
- Updated dependencies [4ac12ef]
- Updated dependencies [b88f5e8]
- Updated dependencies [42cc219]
- Updated dependencies [d42a92f]
- Updated dependencies [51d74ad]
- Updated dependencies [d7e0b42]
- Updated dependencies [3510e4a]
- Updated dependencies [aa4b90d]
- Updated dependencies [54299ca]
- Updated dependencies [dc61def]
- Updated dependencies [251e888]
- Updated dependencies [183b4c4]
- Updated dependencies [2fdb36e]
- Updated dependencies [e787608]
- Updated dependencies [20526f5]
- Updated dependencies [c5eef1d]
- Updated dependencies [e0f300b]
- Updated dependencies [761a0ba]
- Updated dependencies [61282f9]
- Updated dependencies [be87153]
- Updated dependencies [60f0dd8]
- Updated dependencies [a87c5cd]
- Updated dependencies [a47f338]
- Updated dependencies [2598216]
- Updated dependencies [2c7e62d]
- Updated dependencies [eb7613c]
- Updated dependencies [ecc9110]
- Updated dependencies [f7bd4e2]
- Updated dependencies [361bd5b]
- Updated dependencies [1818998]
- Updated dependencies [09ee21c]
- Updated dependencies [f549a0d]
- Updated dependencies [3fc2e48]
- Updated dependencies [e8f435c]
- Updated dependencies [41610f6]
  - @objectstack/spec@17.0.0-rc.6
  - @objectstack/platform-objects@17.0.0-rc.6
  - @objectstack/formula@17.0.0-rc.6
  - @objectstack/core@17.0.0-rc.6

## 17.0.0-rc.5

### Patch Changes

- Updated dependencies [e8f8f6c]
- Updated dependencies [7f713b6]
- Updated dependencies [c960170]
- Updated dependencies [def5919]
- Updated dependencies [ce0cfe9]
- Updated dependencies [1363084]
  - @objectstack/spec@17.0.0-rc.5
  - @objectstack/core@17.0.0-rc.5
  - @objectstack/formula@17.0.0-rc.5
  - @objectstack/platform-objects@17.0.0-rc.5

## 17.0.0-rc.4

### Minor Changes

- bcfebb0: fix(cli,plugin-email)!: `OS_EMAIL_PROVIDER=resend/postmark` without an API key now fails the boot instead of silently becoming the log transport (#5132)

  **BREAKING for one configuration: a delivery provider selected without the
  credential it needs.** `os serve` used to answer that by rewriting `provider` to
  `log`, printing a warning, and booting normally. The result was a server that
  accepted every send, recorded each one in `sys_email` as sent, and delivered
  nothing — the warning scrolled past in CI logs and the truth surfaced when a
  user reported never receiving a verification code. #5087 closed exactly this gap
  inside `@objectstack/plugin-email` (`makeTransport` throws rather than
  substituting a transport); the CLI's own capability assembly kept doing it one
  layer up, for `resend` / `postmark`.

  `resolveEmailCapabilityArg` now refuses every mail configuration it cannot
  deliver through, the way its neighbouring `smtp` arm already did:

  - `resend` / `postmark` with no `OS_EMAIL_API_KEY` (or `config.email.apiKey`);
  - a `provider` tag outside `log` / `smtp` / `resend` / `postmark` — including
    the retired `sendgrid` / `ses`, which get their SMTP migration in the message.

  **Who is affected:** deployments (typically CI or preview environments) that set
  `OS_EMAIL_PROVIDER=resend` or `=postmark` without a key and relied on the
  fallback to boot. Nothing else changes — a complete configuration is passed
  through untouched, and an unset `OS_EMAIL_PROVIDER` still defaults to `log`.

  **Migration — one line, either direction:**

  - the environment is _not_ meant to send mail → `OS_EMAIL_PROVIDER=log`
    (that explicit value is the supported way to say so, and why refusing the
    others is fair);
  - the environment _is_ meant to send mail → set `OS_EMAIL_API_KEY` (or
    `config.email.apiKey`).

  Both errors name the consequence and both fixes, per AGENTS.md's
  degradation-log-level rule.

  `@objectstack/plugin-email` gains the vocabulary the CLI reads instead of
  restating: `API_KEY_EMAIL_PROVIDERS`, `emailProviderRequiresApiKey()` and the
  `ApiKeyEmailProvider` type, alongside `EMAIL_TRANSPORT_PROVIDERS` /
  `isEmailTransportProvider` / `unsupportedProviderFix` from #5094. One vocabulary,
  two consumers, pinned by a contract test — a second literal list in the CLI is
  how the settings dropdown and the transports drifted apart in the first place.

- 9c4f174: feat(plugin-email): durable email delivery through `sys_job_queue`, opt-in (#5160)

  `IEmailService.send()` has always delivered **inline**: the SMTP session ran
  inside the caller's `await`, and `EmailService`'s retry loop lived in the same
  process — so a crash between the attempt and the retry dropped the message with
  no trace beyond a `sys_email` row stuck at `queued`. The pieces for a durable
  path all existed (`sys_job_queue`, the `DbQueueAdapter`, an `email.send.async`
  subscriber) but nothing in the repo ever published to that topic.

  **New: `queueDelivery`.** With it on, `send()` persists the `sys_email` row,
  publishes an `email.send.async` job **referencing that row**, and returns
  `{ status: 'queued' }` immediately. A worker delivers the row and finalizes it
  in place (`sent` + `message_id`, or `failed` + `error`); the queue retries with
  exponential backoff (1s → 5min cap) and dead-letters the job when the attempts
  run out, so a restart resumes delivery instead of losing it. The `'queued'`
  status was already in `EmailDeliveryStatus` — no spec change.

  Three ways to turn it on, all default-off:

  - `new EmailServicePlugin({ queueDelivery: true })`
  - `OS_EMAIL_QUEUE_ENABLED=true` (or `config.email.queueDelivery`) on `os serve`
  - Settings → Mail → **Durable queue delivery**, hot-applied without a restart

  **One retry budget, not two.** `retries` keeps its meaning — total attempts are
  `retries + 1` in both modes. Inline it drives the in-process loop; queued it
  becomes the queue's `maxAttempts` and the per-row loop is pinned to one attempt
  per delivery. Turning the toggle on changes _where_ a retry happens (durable,
  backed off) and never _how many_ happen, so the two layers cannot multiply.

  **Fixed in the same change: the `email.send.async` subscriber inserted a new
  `sys_email` row per delivery.** It called `send()` with the message, so a job
  the queue retried five times left five rows — four permanently `failed`, none
  carrying the real attempt count. It now delivers the referenced row via
  `deliverPersistedRow`, so one message is one row and `attempt_count`
  accumulates on it. Messages published in the old shape (a bare `SendEmailInput`)
  are still accepted and delivered inline for a migration window.

  Boundaries worth knowing before you switch it on:

  - **"Send test email" always sends inline**, in every mode — the button has to
    report the provider's own answer (`535 …`), and "queued" is exactly the
    non-answer #5087 removed from it.
  - **Messages with attachments or custom headers are delivered inline**, because
    `sys_email` has no columns for them and a queued copy would arrive stripped.
    Queueing them is tracked separately; this ships the loss-free behaviour.
  - **A declaration that cannot be honoured fails the boot.** `queueDelivery: true`
    from the constructor or `OS_EMAIL_QUEUE_ENABLED` with no durable queue
    registered (or with `persist: false`) throws on `kernel:ready`, naming the
    fix — the #5132 judgement, applied to durability. The **settings toggle** is
    the opposite trade: it logs at `error` and keeps sending inline, because one
    save must not stop the mail.
  - The kernel's built-in in-memory `queue` fallback does **not** count as a
    durable queue: it delivers synchronously with no retry or DLQ, so publishing
    to it would report `queued` for a message nothing could ever recover. Mount
    `@objectstack/service-queue` over an ObjectQL engine (the `queue` capability
    does this on `os serve`) to get the `sys_job_queue`-backed adapter.

  Leaving `queueDelivery` unset keeps today's behaviour byte for byte.

- d25f20b: fix(plugin-email): `sys_email` rows stranded at `queued` are swept at boot, and a failed drain says so at `error` (#5161)

  `status: 'queued'` had exactly one consumer: the `afterInsert` outbox drain that
  fires during the insert itself (plus, since #5160, the `email.send.async` job
  `send()` publishes). Nothing ever looked at such a row again. A process that
  died between the insert and the delivery — or a drain whose delivery threw —
  left the row at `queued` **forever**: a state named after a queue that had no
  reader, while the caller had already been told the message was accepted.

  **A once-per-boot sweep is now that reader.** At `kernel:ready`, after the
  registries are settled and the `email.send.async` subscriber is attached,
  `sweepStrandedOutbox` picks up `sys_email` rows still at `queued` and advances
  them:

  - **durable queue delivery on** → the row is published as an `{ rowId }` job to
    `email.send.async` through the same producer, options and
    `sys_email:<id>` idempotency key `send()` uses, so a row that still has a
    pending job collapses onto it instead of putting a second worker on it;
  - **inline delivery** → the row is delivered and finalized in place (`sent` /
    `failed`), which is what the drain hook would have done had the process lived.

  Only rows **older than five minutes** are eligible. A row inserted seconds ago
  is not stranded, it is someone's in-flight work — this process's `send()`, its
  deferred drain hook, or the same on another instance — and sweeping it would
  send that message twice. (Age, not "created before this boot": one instance's
  boot time says nothing about a sibling's row inserted a second ago.) Rows this
  process is delivering right now, and rows that already carry a `message_id`, are
  skipped. The batch is bounded at 500 rows per boot, oldest first, and says so
  when it truncates. One `info` line reports the counts; boot does **not** wait on
  the sweep, and a sweep that cannot run reports at `error` rather than relying on
  `kernel:ready` error propagation.

  **Drain-hook failures are now `error`, not `warn`.** A drain that throws means
  the mail was not sent while the insert reported success and the row still reads
  `queued` — the durability class the degradation-log-level rule pins at `error`.
  Both lines now name the consequence (this message was NOT sent, the row stays at
  `queued`) and the fix (the boot sweep picks it up on the next restart; turn on
  durable queue delivery to have failures retried and dead-lettered instead).
  `deliverPersistedRow` joins `DURABILITY_CRITICAL_CALLEES`, so a future `catch`
  that quietly downgrades it fails `pnpm check:durability-log-level`.

  New exports: `sweepStrandedOutbox`, `OUTBOX_OBJECT`, `OUTBOX_SWEEP_MIN_AGE_MS`,
  `OUTBOX_SWEEP_LIMIT`, `EmailService.enqueuePersistedRow`, and
  `EmailServicePlugin.outboxSweepSettled` (the sweep's promise, for callers that
  need determinism). The normal `send()` → deliver path is byte-for-byte
  unchanged.

- 1b9a53b: plugin-email: large attachments (>256 KiB) now get durable queue delivery, with their content held out of the `sys_email` row

  A message whose attachments exceeded the in-row budget was pushed back onto inline delivery — whole, but with none of the durability queue delivery exists to provide, which meant the platform was weakest about exactly the mail that matters most (a signed contract, an exported report). Its content now goes to the `file-storage` capability, the row records a `storageKey` plus the audit metadata, and the queue worker fetches the content back to rebuild the message.

  - **Zero migration.** `attachments_json` declared `storageKey` from the start; this adds the producer and the reader. Attachments at or under `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` still go in the row exactly as before, and the boundary includes equality.
  - **The row stays an audit log, not a blob store.** `filename` / `contentType` / `size` / `hash` stay on the row permanently; the content is a delivery artifact and is deleted a grace window (24h) after the row reaches a terminal state, at which point `storageKey` is replaced by `contentReclaimedAt`. Reclamation is a delayed `email.attachment.reclaim` queue job that carries the storage keys, so a row deleted in the meantime reclaims its content instead of orphaning it.
  - **Nothing degrades silently.** No `file-storage` capability, or an upload that fails, keeps today's behaviour — inline delivery of the whole message — and says which of the two it was and how to fix it. On the way back, content that cannot be fetched (outage, missing object, no capability on the worker, truncated or substituted bytes) fails the row loudly; a message is never delivered without an attachment it declares.

- 8597a7d: fix(service-settings,plugin-email): the mail provider dropdown lists only providers that actually deliver (#5094)

  **Settings → Mail → Provider** offered `SMTP | SendGrid | Amazon SES | Postmark`.
  `@objectstack/plugin-email` has never carried a SendGrid or an SES transport —
  `makeTransport` knows `log` / `resend` / `postmark` / `smtp` and nothing else. So
  selecting either of the two validated, saved, showed a success toast, and then
  delivered no mail at all: the same declared-but-not-delivered gap #5087 closed
  for SMTP, one field to the left.

  The same field broke the invariant in the other direction at the same time:
  **`resend` has shipped a working transport all along and was not on the list**,
  so nobody could pick the one HTTP provider that worked.

  **The dropdown is now `SMTP | Resend | Postmark | None (log only — no real
delivery)` — exactly the set `makeTransport` can build.** No email capability was
  removed with SendGrid and SES. Both publish SMTP endpoints, and #5087 shipped a
  real `SmtpTransport`, so both are configured today as `smtp`:

  | provider   | host                                | port | credentials                                                                        |
  | :--------- | :---------------------------------- | :--- | :--------------------------------------------------------------------------------- |
  | SendGrid   | `smtp.sendgrid.net`                 | 587  | username `apikey`, password = your API key                                         |
  | Amazon SES | `email-smtp.<region>.amazonaws.com` | 587  | SES **SMTP credentials** (generated in the SES console — not your AWS access keys) |

  The provider field's own description says this, so the migration is in front of
  whoever goes looking for the option that disappeared.

  `log` is listed rather than hidden. It is the one option that does not deliver —
  but it does not pretend to: the label says so, `LogTransport` still records every
  message to `sys_email`, and "Send test email" answers `ok: false` for it. That
  gives an operator the deliberate, visible opt-out AGENTS.md asks a degradation to
  be, instead of expressing "no outbound mail" as a half-filled SMTP form. It is
  also what makes _offered_ and _deliverable_ the same set rather than merely
  overlapping — which is the property a test can hold.

  **Already saved `sendgrid` or `ses`? Nothing breaks and nothing goes quiet.** The
  stored value outlives the dropdown, so `applyMailSettings` now recognises it
  explicitly: the previous transport is kept (a settings row written by an older
  release must never fail a boot), and the server logs at `error` with both halves
  AGENTS.md requires — the consequence (_no mail is delivered through it_) and the
  fix (the SMTP settings above), not a bare "unknown provider". It is checked
  _before_ the API-key check, because "set an API key" is the wrong instruction for
  a provider that has nothing to hand a key to. "Send test email" refuses the same
  way and sends nothing. Switching the provider to `smtp` and saving recovers the
  transport without a restart.

  Two smaller corrections in the same field:

  - `api_key` is now shown and required for exactly `resend` and `postmark`
    (`provider === 'resend' || provider === 'postmark'`). It was `provider !==
'smtp'`, which only worked because every non-SMTP option happened to be an
    HTTP API; `required` is enforced server-side wherever the field is visible, so
    that expression would have refused to save "None (log only)" until an API key
    it never reads had been typed in.
  - The built-in `mail/test` fallback (the one that runs when no email plugin is
    mounted) rejects any `provider` outside the manifest's own option list instead
    of answering "the form is well-formed".

  **Held by a test, in both directions.** `EMAIL_TRANSPORT_PROVIDERS` is now a
  runtime array (the `EmailTransportProvider` union is derived from it), and
  `plugin-email`'s `mail-manifest-providers.contract.test.ts` asserts set equality
  between it and the manifest's option values, then builds a real transport for
  each. Adding an option without a transport fails; adding a transport without an
  option fails. `RETIRED_EMAIL_PROVIDERS` / `isEmailTransportProvider` /
  `unsupportedProviderFix` are exported alongside it for hosts that surface the
  same guidance.

- 41c3b48: feat(plugin-email): real SMTP delivery — `SmtpTransport`, settings hot-swap, and a `mail/test` that actually sends (#5087)

  The **Mail Delivery** settings page has always defaulted to SMTP and offered a
  full host / port / TLS / username / password form. Nothing behind it delivered:
  `applyMailSettings` treated `provider: 'smtp'` as a no-op ("transport
  unchanged"), `mail/test` answered `ok: true, "Configuration looks valid … Wire
@objectstack/plugin-mail for actual delivery"` — a success toast for a message
  nobody sent, naming a package that has never existed — and the code pointed
  operators at `@objectstack/plugin-mail-smtp`, which is not in this repo or on
  npm. A workspace that selected SMTP got a green form, a green test button, and
  mail that only ever reached the log and the `sys_email` table. For deployments
  in China this left **no** working channel at all: Resend and Postmark are
  overseas HTTPS SaaS with unreliable reach and deliverability to QQ / 163 /
  enterprise mailboxes, where SMTP is the normal path (Aliyun DirectMail, Tencent
  SES, corporate mail servers).

  **`SmtpTransport` now ships in `@objectstack/plugin-email`** (ADR-0012: SMTP in
  core, implemented with `nodemailer`). `nodemailer` is a real dependency but is
  imported **lazily on the first send**, so deployments that never select SMTP —
  and non-Node runtimes — never load `node:net` / `node:tls`.

  Three doors reach it, all sharing one options reader so they cannot drift:

  - **Settings → Mail** (`smtp_host` / `smtp_port` / `smtp_secure` / `smtp_user` /
    `smtp_password`) hot-swaps the live transport on save, no restart.
  - **`os serve`** via `OS_EMAIL_PROVIDER=smtp` plus the new `OS_EMAIL_SMTP_HOST` /
    `_PORT` / `_SECURE` / `_USER` / `_PASSWORD` (or `config.email.options`).
  - **Constructor**: `new EmailServicePlugin({ provider: 'smtp', providerOptions:
{ host, port, secure, user, password } })`.

  TLS is one toggle with the wire behaviour derived from the port, as providers
  document it: on `465` implicit TLS (SMTPS); on any other port a **required**
  STARTTLS upgrade, so a server that refuses to upgrade fails the send instead of
  leaking credentials over a cleartext socket; `secure: false` connects in the
  clear and upgrades only when STARTTLS is offered.

  **Failure is loud everywhere, because a silent fallback is the bug this fixes.**
  On the construction path (CLI / plugin options) a `smtp` provider with no host
  **throws** and the boot fails — it no longer degrades into a LogTransport that
  reports every send as successful. On the settings hot-swap path a save can never
  kill a running server, so the previous transport is kept — but the failure is
  logged at `error` naming the consequence and the fix, and **`mail/test` now
  performs a real delivery** through the settings on screen and reports the SMTP
  server's own words (`535 … authentication failed`) instead of a green toast. The
  built-in fallback `mail/test` handler (used only when no email plugin is
  mounted) answers `ok: false` and says plainly that nothing was sent.

  Nothing to migrate: `log`, `resend` and `postmark` behave exactly as before, and
  a deployment that never selects `smtp` is unaffected.

- f104bab: feat(plugin-email,platform-objects): `sys_email` carries headers and small attachments, so those messages become durably deliverable (#5177)

  Durable email delivery works from the **row**, not from the in-memory message:
  `send()` publishes an `{ rowId }` job (#5160), the boot sweep re-reads rows
  (#5161), and both end at `rowToNormalized`. So anything a `sys_email` row could
  not carry, a row-based delivery would have dropped — and custom headers and
  attachments were exactly that. The honest workaround was to refuse: a message
  with either was pushed back onto inline delivery so that it would at least go
  out whole, which closed the durable path to precisely the mail most worth
  making durable (a signed receipt, a `List-Unsubscribe` header, an invoice PDF).

  `sys_email` now has two columns, and those messages are queueable.

  **`headers_json`** — the custom headers, as a JSON object. Written in both
  delivery modes (it is audit evidence as much as delivery input) and rebuilt on
  read. Headers are no longer a reason to fall back to inline delivery.

  **`attachments_json`** — attachments as a JSON array of
  `{ filename, contentType?, size, hash, cid?, contentForm, inline?, storageKey? }`,
  content base64 in `inline`. Written when the **combined raw size of one
  message's attachments is within `SYS_EMAIL_ATTACHMENT_LIMIT_BYTES` (256 KiB,
  exported from `@objectstack/plugin-email`)** — worst case ~350 KB of base64, so
  a row stays bounded. Both arms of the declared `content: string | Buffer`
  contract round-trip as the arm they were sent as: restoring a text attachment
  as a Buffer would silently drop `charset=utf-8` from its MIME part and let the
  recipient's client mis-decode a UTF-8 file, so `contentForm` records which one
  it was. `cid` travels too — an inline `<img src="cid:…">` is unusable without
  it.

  **Over the limit, nothing changes.** The message is delivered inline exactly as
  before, whole, and the row stores no attachment content; the reason is stated
  at `info` (a bound, not a degradation — the worst outcome is today's
  behaviour). Out-of-row storage for large attachments is #5172; `storageKey` is
  declared now so that lands as a new _producer_ rather than a data migration.

  Rows written before these columns exist read exactly as they did. A column that
  is present but does not describe what it claims — malformed JSON, a size or
  hash that disagrees with the content, a missing `contentForm` — is **rejected**,
  and the row lands at `failed` carrying the reason, rather than being delivered
  with a part quietly missing.

  The `sys_email` schema change is additive (two optional textarea columns); no
  migration is required and default inline delivery is unchanged.

### Patch Changes

- 205e81b: fix(plugin-email)!: `EmailPersistence.insert` must return the row's own id — a substituted id is rejected instead of double-sending (#5523)

  **FROM** — `insert` could answer with an id of its own (a database-assigned
  primary key, an external delivery system's receipt id) and `EmailService.send()`
  adopted it: the substituted id was added to the service-managed set, used as the
  queued job's `rowId`, and returned to the caller.

  **TO** — `insert` must confirm the id it was handed. Returning a different id
  throws, naming the contract and the value returned, **before the message is
  delivered**.

  **Fix, one line:** return `{ id: row.id }` (or `row.id`) from `insert`. If your
  store assigns its own primary key, keep the service-minted id in the row's `id`
  column and record the store's key in a column of its own.

  Why the contract tightened rather than the service accommodating both: the id is
  minted by the service _before_ the insert and is already load-bearing by the time
  `insert` is called — out-of-row attachment content has been uploaded under
  `sys_email/attachments/<row.id>/…`, so the row id is the only key that finds
  those bytes again. Re-keying the row also broke delivery exactly-once: the
  `sys_email` `afterInsert` outbox drain hook decides whether a freshly-inserted
  row is the service's to deliver by asking `isServiceManaged()` about **the
  inserted row's own id**, and that hook runs _inside_ the insert — before `send()`
  had seen, let alone reserved, the substituted id. So the hook read the row as an
  application-inserted outbox entry and delivered it, while `send()` delivered it
  again down its own path: one message sent twice, two terminal updates racing on
  one row. The only thing that ever prevented it was the hook's `setTimeout(…, 0)`
  losing a race to `send()`'s inline delivery — and `transport.send` is real
  network I/O, so that race is normally lost.

  Scope of the check: it judges the confirmation's **value**, not its presence. An
  implementation that returns no id at all leaves nothing to disagree with (the
  drain hook reads the id off the inserted row, which is the minted one either
  way), so the mail still goes. An insert that _throws_ is unchanged — that stays
  an operational condition the service rides out with a warning and inline
  delivery; only a _successful_ insert that renames the row is fatal.

  Breaking for external `EmailPersistence` implementations that re-key the row —
  of which there are currently none: the in-repo implementation forwards the
  engine's own answer and ObjectQL honours the id it is handed. Filed at `patch`
  because the surface has no known external consumer and the declared TypeScript
  signature is unchanged; a maintainer who counts a narrowed public-interface
  contract as `minor`/`major` should relabel it.

- Updated dependencies [9fe9c1d]
- Updated dependencies [d4e0809]
- Updated dependencies [f724f69]
- Updated dependencies [28ad90e]
- Updated dependencies [f8644c7]
- Updated dependencies [306ca50]
- Updated dependencies [978fed2]
- Updated dependencies [cfc293f]
- Updated dependencies [de70b42]
- Updated dependencies [fb3d99b]
- Updated dependencies [cdfbee2]
- Updated dependencies [29c6c9d]
- Updated dependencies [d21c001]
- Updated dependencies [f1cc3a3]
- Updated dependencies [ddc2527]
- Updated dependencies [553a47f]
- Updated dependencies [a3a884d]
- Updated dependencies [cfed092]
- Updated dependencies [2e284b2]
- Updated dependencies [1b49eaf]
- Updated dependencies [0161c7f]
- Updated dependencies [e900015]
- Updated dependencies [b5bdf48]
- Updated dependencies [a019e52]
- Updated dependencies [64fc6d5]
- Updated dependencies [b746aa0]
- Updated dependencies [947d4f9]
- Updated dependencies [eaaf03c]
- Updated dependencies [d17df80]
- Updated dependencies [7d0e7b5]
- Updated dependencies [6513c17]
- Updated dependencies [c142ced]
- Updated dependencies [eda599e]
- Updated dependencies [c001422]
- Updated dependencies [77022a9]
- Updated dependencies [52760bf]
- Updated dependencies [5543020]
- Updated dependencies [880d343]
- Updated dependencies [6e82972]
- Updated dependencies [4615a18]
- Updated dependencies [7f62706]
- Updated dependencies [667fa44]
- Updated dependencies [37e38d1]
- Updated dependencies [0f17114]
- Updated dependencies [1eb13a0]
- Updated dependencies [c52e608]
- Updated dependencies [4dfd002]
- Updated dependencies [77be690]
- Updated dependencies [811c30c]
- Updated dependencies [b49ccfd]
- Updated dependencies [85d95e7]
- Updated dependencies [168f60f]
- Updated dependencies [244ca86]
- Updated dependencies [546ab3c]
- Updated dependencies [58f3220]
- Updated dependencies [07f1822]
- Updated dependencies [0b51bb6]
- Updated dependencies [d9971d3]
- Updated dependencies [eb3e650]
- Updated dependencies [abeb375]
- Updated dependencies [ef4efa8]
- Updated dependencies [cbb6a5c]
- Updated dependencies [795b6e1]
- Updated dependencies [175d789]
- Updated dependencies [55dbbba]
- Updated dependencies [72c3c86]
- Updated dependencies [7f1a635]
- Updated dependencies [e98fb14]
- Updated dependencies [0f2fdcd]
- Updated dependencies [8ffa8b9]
- Updated dependencies [674ac99]
- Updated dependencies [1b9a53b]
- Updated dependencies [502564d]
- Updated dependencies [471839d]
- Updated dependencies [46365ab]
- Updated dependencies [b508244]
- Updated dependencies [594508e]
- Updated dependencies [1c625ca]
- Updated dependencies [71f205d]
- Updated dependencies [414395b]
- Updated dependencies [c5adfe1]
- Updated dependencies [26e1029]
- Updated dependencies [108ba8d]
- Updated dependencies [b4ad984]
- Updated dependencies [a9f32df]
- Updated dependencies [aeb9b27]
- Updated dependencies [7d27da0]
- Updated dependencies [089767f]
- Updated dependencies [e4c8b6c]
- Updated dependencies [acb10f6]
- Updated dependencies [1c3da1f]
- Updated dependencies [a34fd2e]
- Updated dependencies [889ae47]
- Updated dependencies [4f4c3fb]
- Updated dependencies [7adc841]
- Updated dependencies [4845f85]
- Updated dependencies [bf1edef]
- Updated dependencies [7b005b4]
- Updated dependencies [94f7b6a]
- Updated dependencies [5c94f83]
- Updated dependencies [73e576f]
- Updated dependencies [c5a5996]
- Updated dependencies [ae490ef]
- Updated dependencies [f61c8cf]
- Updated dependencies [e3ef52b]
- Updated dependencies [07f1822]
- Updated dependencies [04fab5e]
- Updated dependencies [efedd28]
- Updated dependencies [5278e11]
- Updated dependencies [23dba62]
- Updated dependencies [ba98e26]
- Updated dependencies [f104bab]
- Updated dependencies [fc5f536]
- Updated dependencies [f8cfbb4]
- Updated dependencies [c89d18c]
- Updated dependencies [aac90a5]
- Updated dependencies [1e6ab15]
- Updated dependencies [c87ef70]
- Updated dependencies [3cb0618]
- Updated dependencies [32a0874]
- Updated dependencies [7055c22]
- Updated dependencies [785a748]
- Updated dependencies [3af0354]
- Updated dependencies [866ff16]
- Updated dependencies [5a85e67]
- Updated dependencies [c183a12]
- Updated dependencies [8064b07]
- Updated dependencies [4a56dbd]
- Updated dependencies [06df4fa]
  - @objectstack/spec@17.0.0-rc.4
  - @objectstack/core@17.0.0-rc.4
  - @objectstack/platform-objects@17.0.0-rc.4
  - @objectstack/formula@17.0.0-rc.4

## 17.0.0-rc.2

### Minor Changes

- ce92674: feat(email): declared email templates reach the mail service (#4509)

  Authoring an `email_template` was a silent no-op. `EmailService.sendTemplate`
  resolves `(name, locale)` against **`sys_email_template` rows**, and the only
  writers of those rows were the built-in auth templates plus a code-constructed
  `EmailServicePluginOptions.templates` that no bootstrapper ever passed. Every
  door an author can actually use — a stack's `emailTemplates:`, an
  `*.email-template.ts` file, Studio's metadata-admin list, `PUT /meta` — parked
  items in a metadata store nothing read back. So an admin could "fix" the
  password-reset email in Studio, get a success toast, and watch users keep
  receiving the built-in copy: ADR-0078 false compliance on **authentication
  mail**. This is the shape #3461 had for webhooks, closed the same way (ADR-0049
  enforce-or-remove, route: enforce).

  **`bootstrapDeclaredEmailTemplates`** now materializes declared templates into
  `sys_email_template` at boot. Each item is validated through
  `EmailTemplateDefinitionSchema.parse()` — the spec schema finally has a real
  consumer, defaults and all — and projected with `mapTemplateToRow`, which is the
  **same** mapping the built-in seeder uses, extracted and shared so the two doors
  cannot drift apart. A malformed template warns and is skipped rather than
  crashing boot.

  **Runtime writes take effect immediately.** Unlike `webhook`, `email_template`
  is `allowRuntimeCreate: true`, so a boot-only bridge would have left a Studio
  save inert until the next restart — the same bug, half-fixed. The plugin also
  subscribes to `email_template` metadata changes and re-materializes the single
  changed item; withdrawing a template deactivates its rows (across locales)
  rather than deleting them.

  **Three breaks sat on this path, not one**, and closing any two of them would
  still have shipped a template that never sent:

  - `@objectstack/objectql` never registered a manifest's `emailTemplates:` into
    the metadata registry at all — the key was simply missing from the generic
    ingestion list, so the bridge's own source was empty.
  - The built-in seeder left `managed_by` at the column's `'admin'` default, which
    made platform templates masquerade as admin-authored. Since the bridge refuses
    to overwrite admin rows, a built-in would have permanently outranked the
    template an app declared. Built-ins now stamp `managed_by: 'platform'`.
  - Nothing materialized declared metadata into rows.

  **Seed-not-clobber** mirrors `sys_webhook` (#3489) and `sys_sharing_rule`
  (#2909): `sys_email_template` gains `managed_by` / `customized`. Declared
  templates re-seed every boot as `managed_by: 'package'`; a row an admin created
  (`admin`) or edited (`customized`, stamped by a `beforeUpdate` hook) is never
  overwritten, so reworded transactional mail survives redeploys. This is a
  separate axis from `is_system`, which keeps its existing meaning for built-ins.

  The `email_template` liveness ledger flips from 13 dead properties to fully
  live, with an ADR-0054 runtime proof bound on `subject`
  (`email-template-materialization`): it boots a real stack, authors a template
  that overrides a built-in auth template, and asserts the **authored** wording is
  what reaches the transport.

### Patch Changes

- Updated dependencies [430dcc2]
- Updated dependencies [e6ac4bd]
- Updated dependencies [80334c7]
- Updated dependencies [ce5242c]
- Updated dependencies [a7163ea]
- Updated dependencies [e6e9379]
- Updated dependencies [98877c9]
- Updated dependencies [98877c9]
- Updated dependencies [c44dd5e]
- Updated dependencies [e6b1b69]
- Updated dependencies [ad047d2]
- Updated dependencies [2826d1e]
- Updated dependencies [5a84d41]
- Updated dependencies [20b1a9e]
- Updated dependencies [203a449]
- Updated dependencies [ac37fc6]
- Updated dependencies [4820f55]
- Updated dependencies [462d9c4]
- Updated dependencies [7d21581]
- Updated dependencies [f2445c9]
- Updated dependencies [23338c3]
- Updated dependencies [5b843fb]
- Updated dependencies [b4487aa]
- Updated dependencies [65ca83a]
- Updated dependencies [67bf2e2]
- Updated dependencies [c6d1cb4]
- Updated dependencies [36030ff]
- Updated dependencies [6117f7b]
- Updated dependencies [e533b0b]
- Updated dependencies [cdf4d9a]
- Updated dependencies [aee1806]
- Updated dependencies [c13350b]
- Updated dependencies [c13350b]
- Updated dependencies [9ca2d85]
- Updated dependencies [c13350b]
- Updated dependencies [891d345]
- Updated dependencies [a52e2ef]
- Updated dependencies [5293114]
- Updated dependencies [20bc357]
- Updated dependencies [5966c2a]
- Updated dependencies [2382580]
- Updated dependencies [d9fa683]
- Updated dependencies [3c7bcc0]
- Updated dependencies [4b6cac7]
- Updated dependencies [7631964]
- Updated dependencies [ac471a0]
- Updated dependencies [60ae58e]
- Updated dependencies [ce92674]
- Updated dependencies [9f601e8]
- Updated dependencies [51c5227]
- Updated dependencies [a4a85c8]
- Updated dependencies [07a4e26]
- Updated dependencies [ec975f1]
- Updated dependencies [eb4204b]
- Updated dependencies [4f13be2]
- Updated dependencies [61cc079]
- Updated dependencies [0e96e46]
- Updated dependencies [d52d4fe]
- Updated dependencies [742cebb]
- Updated dependencies [ce92674]
- Updated dependencies [cf2c9b7]
- Updated dependencies [833b512]
- Updated dependencies [0f9faa2]
- Updated dependencies [7cf42fe]
- Updated dependencies [5966c2a]
- Updated dependencies [f78dd83]
- Updated dependencies [a2cd18a]
- Updated dependencies [4638aaa]
- Updated dependencies [0222d3c]
- Updated dependencies [071d0dc]
- Updated dependencies [0a936ea]
- Updated dependencies [023c00b]
- Updated dependencies [155507e]
- Updated dependencies [7bba90b]
- Updated dependencies [7e05d8e]
- Updated dependencies [061406d]
- Updated dependencies [c1f344b]
- Updated dependencies [9c93465]
- Updated dependencies [ebb209c]
- Updated dependencies [63b33e6]
- Updated dependencies [2a44c1d]
- Updated dependencies [695cfbd]
- Updated dependencies [7445149]
- Updated dependencies [071d0dc]
- Updated dependencies [0848bea]
- Updated dependencies [d51bed2]
- Updated dependencies [b8b3c64]
- Updated dependencies [0c0fbd9]
- Updated dependencies [f3141d8]
- Updated dependencies [5a84d41]
- Updated dependencies [fd3013a]
- Updated dependencies [21676eb]
- Updated dependencies [e336549]
- Updated dependencies [d40f43a]
- Updated dependencies [e5e7ee0]
- Updated dependencies [a2ebea2]
- Updated dependencies [800bdb0]
- Updated dependencies [04f1182]
- Updated dependencies [5647006]
- Updated dependencies [38f7e4f]
- Updated dependencies [c57f3cf]
- Updated dependencies [97faca3]
- Updated dependencies [ad5fe25]
- Updated dependencies [ea90179]
- Updated dependencies [ce92674]
- Updated dependencies [5ef0b5b]
- Updated dependencies [48fbacb]
- Updated dependencies [355e951]
- Updated dependencies [dadb43f]
  - @objectstack/spec@17.0.0-rc.2
  - @objectstack/platform-objects@17.0.0-rc.2
  - @objectstack/core@17.0.0-rc.2
  - @objectstack/formula@17.0.0-rc.2

## 17.0.0-rc.1

### Patch Changes

- 2e836de: chore(packaging): CHANGELOG.md ships in every npm tarball (#4261)

  The AGENTS.md post-task checklist requires breaking changesets to carry their
  FROM → TO migration because "this text ships to consumers as `CHANGELOG.md`
  inside the npm package and is what an upgrading agent greps after the tombstone
  error." That delivery path was severed for 68 of the 69 publishable packages:
  npm packs `package.json` / `README*` / `LICENSE*` unconditionally but — unlike
  older npm versions — not `CHANGELOG.md`, and the canonical
  `"files": ["dist", "README.md"]` whitelist never named it. Measured on npm
  10.9.7: `npm pack --dry-run` on `@objectstack/types` shipped 3 files while its
  70KB `CHANGELOG.md` stayed behind. Only `@objectstack/spec` listed it
  explicitly.

  The tombstone-error scenario is precisely the one where the repo is out of
  reach — the upgrading agent has `node_modules` and nothing else — so the
  migration text has to ride in the tarball. Every publishable package now
  declares `CHANGELOG.md` in `files`, and the canonical whitelist is
  `["dist", "README.md", "CHANGELOG.md"]`.

  The other half is the gate: `check:published-files` gains a fifth invariant,
  COMPLETE — a whitelist that fails to cover `CHANGELOG.md` fails the
  always-required lint job, so the next package cannot silently sever the path
  again. `@objectstack/spec`'s per-package EXTRA_ENTRIES exemption dissolves
  into the canonical set.

  Consumer-visible change: one more file per install (the package's changelog,
  e.g. 70.8KB for `@objectstack/types`), and `grep -r "removed key"
node_modules/@objectstack/*/CHANGELOG.md` now finds the migration it was
  promised.

- be7360c: chore(plugins,services): declare `providesServices` on the 20 remaining init-time service providers (ADR-0116 follow-up, #4131)

  ADR-0116 gave the kernel a declared ordering contract, but only
  `ObjectQLPlugin` and `MetadataPlugin` had declared what their `init()`
  registers. The pre-Phase-1 ordering check can only _name a provider_ for
  services someone declared, so its coverage was two plugins wide.

  An audit of every plugin's `init()` body (brace-matched, comments stripped,
  each call classified by whether it sits inside a `try`/`if`) found 20 plugins
  that register a service on every path without declaring it. All 20 now
  declare `providesServices`. Purely additive: no ordering changes, no new
  failure modes — a `providesServices` entry only lets the kernel say _who_
  provides a service when it reports a misordering, and enriches the Phase-1
  `getService` miss diagnostic.

  Three needed a closer read before declaring, because they register the same
  service from several branches (`cache`, `queue`, `job`): each early-return
  branch plus the fallback registers it, so every path does — the declaration
  is honest. ADR-0116's rule that a _conditionally_ registered service must
  never be declared is unchanged and was applied throughout.

  The same audit found 12 plugins that hard-resolve a service during `init()`
  (11 of them `manifest`) without declaring `requiresServices`. None is a live
  exposure — every one already declares a hard `dependencies` entry on the
  provider, so the kernel orders them correctly today. Those are tracked
  separately: with a hard dependency in place, `requiresServices` mostly
  restates what the kernel already enforces, and its real value is on
  _soft_-dependency consumers, of which `AppPlugin` is currently the only one.

- cc2de0e: chore(packaging): 20 packages stop publishing their sources, tests and build tooling (#4248)

  These 20 packages declared no `files` field, so npm fell back to packing the
  whole package directory. `npm pack --dry-run` on `@objectstack/plugin-webhooks`
  listed **21 files** — 15 under `src/`, three of them unit tests
  (`auto-enqueuer.test.ts`, `bootstrap-declared-webhooks.test.ts`, …), plus the
  build-time `scripts/i18n-extract.config.ts`. `dist/` lands on top of that at
  publish time rather than instead of it, so consumers were installing the
  TypeScript sources and the test suite alongside the artifact they asked for.

  Each now declares `"files": ["dist", "README.md"]`, matching the 29 packages
  that already did. Nothing a consumer imports moves: every `main` / `types` /
  `exports` target in all 20 already resolved inside `dist/`, which the new
  `check:published-files` guard verifies rather than assumes. The visible change
  is a smaller install and a smaller dependency-scanning surface — `npm pack` on
  `@objectstack/plugin-webhooks` now yields 2 files plus `dist/`.

  The other half of the fix is the gate. Half the packages declaring `files` and
  half not was the #3786 shape — a hand-copied convention with nothing enforcing
  it, where whoever forgets the line gets no signal at all. `check:published-files`
  (new, wired into the always-required `lint` job) holds every non-private
  workspace package to four invariants: `files` is **declared**; it is
  **sufficient** (covers every entry point, so tightening a whitelist cannot ship
  a package that fails to resolve); it is **minimal** (admits no test, test-harness
  config or build script); and anything beyond `dist` + `README.md` is
  **registered** with a reason, reconciled in both directions so a stale exemption
  is an error rather than dead text. `@objectstack/spec` is the one package with
  registered extras — its `.zod.ts` sources, JSON Schemas, liveness ledgers and
  `CHANGELOG.md` are product, not build input.

  This also closes an assumption #4206 was resting on. Excluding `<pkg>/scripts/**`
  from the docs-drift implementation test is sound only while no package publishes
  `scripts/` as runtime code; that held, but it held because someone read all three
  offenders by hand. It is now checked on every PR.

- Updated dependencies [6a67d7a]
- Updated dependencies [0ecc656]
- Updated dependencies [06772eb]
- Updated dependencies [270650f]
- Updated dependencies [3aef718]
- Updated dependencies [1ea6bce]
- Updated dependencies [c1dcacd]
- Updated dependencies [ad303ed]
- Updated dependencies [32ccb23]
- Updated dependencies [f5a4ef0]
- Updated dependencies [2d3e255]
- Updated dependencies [7d7521f]
- Updated dependencies [5dc4d02]
- Updated dependencies [05154a1]
- Updated dependencies [9b6fe7c]
- Updated dependencies [8c711fb]
- Updated dependencies [09e4547]
- Updated dependencies [91f4c78]
- Updated dependencies [820eff9]
- Updated dependencies [8d895ff]
- Updated dependencies [f6472d7]
- Updated dependencies [78caf51]
- Updated dependencies [62a789b]
- Updated dependencies [789ad63]
- Updated dependencies [2af1988]
- Updated dependencies [0af50a3]
- Updated dependencies [2e836de]
- Updated dependencies [12a19a8]
- Updated dependencies [41dcda3]
- Updated dependencies [c8124e5]
- Updated dependencies [a1a4140]
- Updated dependencies [217e2e6]
- Updated dependencies [86a71d1]
- Updated dependencies [d5c75e2]
- Updated dependencies [03d26f7]
- Updated dependencies [4384921]
- Updated dependencies [3c628ce]
- Updated dependencies [7cb922e]
- Updated dependencies [1d22114]
- Updated dependencies [b5f9397]
- Updated dependencies [ed77493]
- Updated dependencies [58a03d2]
- Updated dependencies [dc530b4]
- Updated dependencies [e59786e]
- Updated dependencies [bcf1112]
- Updated dependencies [9774b78]
- Updated dependencies [b07d829]
- Updated dependencies [a648e96]
- Updated dependencies [a47ac06]
- Updated dependencies [e4c61a7]
- Updated dependencies [cc60165]
- Updated dependencies [081aa6f]
- Updated dependencies [91f4c78]
- Updated dependencies [e8d0c21]
- Updated dependencies [45dc446]
- Updated dependencies [c1d44f7]
- Updated dependencies [ab9fb5c]
- Updated dependencies [f985b3f]
- Updated dependencies [9a4932a]
- Updated dependencies [f9fc874]
- Updated dependencies [011b386]
- Updated dependencies [7777e8f]
- Updated dependencies [507b92a]
- Updated dependencies [7309c81]
- Updated dependencies [20bc1ec]
- Updated dependencies [90c2b15]
- Updated dependencies [42eeb7d]
- Updated dependencies [01e124d]
- Updated dependencies [7ce02eb]
- Updated dependencies [a13827e]
- Updated dependencies [7733604]
- Updated dependencies [40e420f]
- Updated dependencies [d13004a]
- Updated dependencies [be7360c]
- Updated dependencies [cc2de0e]
- Updated dependencies [5b47ab5]
- Updated dependencies [b09d8d9]
- Updated dependencies [b09d8d9]
- Updated dependencies [8675db6]
- Updated dependencies [b09d8d9]
- Updated dependencies [3eb1b2b]
- Updated dependencies [59b85c0]
- Updated dependencies [6e357ed]
- Updated dependencies [d6938bf]
- Updated dependencies [31e0be9]
- Updated dependencies [4bfd455]
- Updated dependencies [ffd2ce2]
- Updated dependencies [62f8017]
- Updated dependencies [a831df1]
- Updated dependencies [f752ee3]
- Updated dependencies [a1b61e0]
- Updated dependencies [cd6b9f2]
- Updated dependencies [2cb6d3c]
- Updated dependencies [af2a095]
- Updated dependencies [ec796d5]
- Updated dependencies [e87fea1]
- Updated dependencies [c65e529]
- Updated dependencies [3ca34c1]
- Updated dependencies [239c3a3]
- Updated dependencies [94a0bbc]
- Updated dependencies [d6bfb3d]
- Updated dependencies [a2266a6]
- Updated dependencies [d25a0ec]
- Updated dependencies [667b83e]
- Updated dependencies [627b188]
- Updated dependencies [8d4eae7]
- Updated dependencies [857a6cf]
- Updated dependencies [65a3a84]
- Updated dependencies [ccd9397]
- Updated dependencies [bca935b]
- Updated dependencies [d92c72d]
- Updated dependencies [c54c822]
- Updated dependencies [8dcc0f5]
- Updated dependencies [75b9e51]
- Updated dependencies [0a2f233]
- Updated dependencies [8621cdd]
- Updated dependencies [6f23667]
- Updated dependencies [5d21a48]
- Updated dependencies [19365b7]
- Updated dependencies [b7ed26d]
- Updated dependencies [68dea0b]
- Updated dependencies [64f8cbe]
- Updated dependencies [b3a3d83]
- Updated dependencies [7a55913]
- Updated dependencies [35accbf]
- Updated dependencies [6038de7]
- Updated dependencies [eb95d97]
- Updated dependencies [e4c2dc8]
- Updated dependencies [1bd2795]
- Updated dependencies [8186a70]
- Updated dependencies [a329cca]
- Updated dependencies [6eec18c]
- Updated dependencies [4d7bebf]
- Updated dependencies [821ac7a]
- Updated dependencies [8f81731]
- Updated dependencies [4965bfa]
- Updated dependencies [8b50cb3]
- Updated dependencies [8c2db68]
- Updated dependencies [22b5e54]
- Updated dependencies [0166bd5]
- Updated dependencies [9b702dc]
- Updated dependencies [ab16331]
  - @objectstack/spec@17.0.0-rc.1
  - @objectstack/platform-objects@17.0.0-rc.1
  - @objectstack/core@17.0.0-rc.1
  - @objectstack/formula@17.0.0-rc.1

## 17.0.0-rc.0

### Patch Changes

- Updated dependencies [50616d9]
- Updated dependencies [08b5a3d]
- Updated dependencies [d99aeb3]
- Updated dependencies [4727eb8]
- Updated dependencies [f63cd09]
- Updated dependencies [fa3d0cf]
- Updated dependencies [af5a224]
- Updated dependencies [71f76e1]
- Updated dependencies [37b1346]
- Updated dependencies [99736a0]
- Updated dependencies [fe67e34]
- Updated dependencies [fdb4f50]
- Updated dependencies [1bd5652]
- Updated dependencies [14252d3]
- Updated dependencies [7fb436c]
- Updated dependencies [879ea13]
- Updated dependencies [201b31f]
- Updated dependencies [e2616e0]
- Updated dependencies [6fdc5c6]
- Updated dependencies [8b9d71e]
- Updated dependencies [33f5e23]
- Updated dependencies [259af21]
- Updated dependencies [587fc91]
- Updated dependencies [1986594]
- Updated dependencies [ad4af62]
- Updated dependencies [d44dbfa]
- Updated dependencies [474fe39]
- Updated dependencies [0bc685a]
- Updated dependencies [b949059]
- Updated dependencies [be1c52c]
- Updated dependencies [c5ff96d]
- Updated dependencies [84e7be9]
- Updated dependencies [a6c3f38]
- Updated dependencies [debc23a]
- Updated dependencies [0f8ad09]
- Updated dependencies [8f9689f]
- Updated dependencies [57a3bb3]
- Updated dependencies [5f9a987]
- Updated dependencies [9f060e5]
- Updated dependencies [bc17d39]
- Updated dependencies [db02d47]
- Updated dependencies [0bfdf46]
- Updated dependencies [376a061]
- Updated dependencies [7c7e246]
- Updated dependencies [f35cdc5]
- Updated dependencies [9ea2bc5]
- Updated dependencies [c2d9098]
- Updated dependencies [a227ed7]
- Updated dependencies [9613396]
- Updated dependencies [e47b342]
- Updated dependencies [4ed7ed4]
- Updated dependencies [2fa4ca1]
- Updated dependencies [f5a2320]
- Updated dependencies [deb538f]
- Updated dependencies [5b89711]
- Updated dependencies [0c8a22f]
- Updated dependencies [763931e]
- Updated dependencies [de9af8a]
- Updated dependencies [c4df271]
- Updated dependencies [a41ba5c]
- Updated dependencies [189854c]
- Updated dependencies [0e3a226]
- Updated dependencies [524151c]
- Updated dependencies [1d4756e]
- Updated dependencies [720c5ad]
- Updated dependencies [a8d1e24]
- Updated dependencies [d1cabaa]
- Updated dependencies [41642b0]
- Updated dependencies [4cca74c]
- Updated dependencies [88ef03e]
- Updated dependencies [9e2caf3]
- Updated dependencies [81ce41a]
- Updated dependencies [85e1e4e]
- Updated dependencies [dac6a08]
- Updated dependencies [394b7a1]
- Updated dependencies [677b591]
- Updated dependencies [d77d1b7]
- Updated dependencies [5b79a34]
- Updated dependencies [c757854]
- Updated dependencies [0045682]
- Updated dependencies [2a5f04a]
- Updated dependencies [4f740b0]
- Updated dependencies [67452d1]
- Updated dependencies [4921a95]
- Updated dependencies [0fc6219]
- Updated dependencies [605e190]
- Updated dependencies [c6c59f1]
- Updated dependencies [b0e78a8]
- Updated dependencies [f31cc8d]
- Updated dependencies [f343dc4]
- Updated dependencies [8269e32]
- Updated dependencies [74f7339]
- Updated dependencies [a6c35a2]
- Updated dependencies [c2f1002]
- Updated dependencies [f163028]
- Updated dependencies [f07808c]
- Updated dependencies [7ffc3d3]
- Updated dependencies [88346ba]
- Updated dependencies [4631592]
- Updated dependencies [32ff033]
- Updated dependencies [5ac93d4]
- Updated dependencies [93f267f]
- Updated dependencies [0024abf]
- Updated dependencies [acbf364]
- Updated dependencies [5487c20]
- Updated dependencies [aa8b847]
- Updated dependencies [7687f7b]
- Updated dependencies [1659072]
- Updated dependencies [abceb0d]
- Updated dependencies [0c302a7]
- Updated dependencies [6633337]
- Updated dependencies [f00d8d4]
- Updated dependencies [503be86]
- Updated dependencies [cde1975]
- Updated dependencies [0bc685a]
- Updated dependencies [11949fc]
- Updated dependencies [b098b0e]
- Updated dependencies [4d00b13]
- Updated dependencies [9aa5510]
- Updated dependencies [57bab76]
- Updated dependencies [b90086a]
- Updated dependencies [b95577a]
- Updated dependencies [83c161f]
- Updated dependencies [d8c4957]
- Updated dependencies [f24cb83]
- Updated dependencies [5dbbb92]
- Updated dependencies [69f1dfd]
  - @objectstack/spec@17.0.0-rc.0
  - @objectstack/platform-objects@17.0.0-rc.0
  - @objectstack/core@17.0.0-rc.0
  - @objectstack/formula@17.0.0-rc.0

## 16.1.0

### Patch Changes

- Updated dependencies [212b66a]
- Updated dependencies [d10c4dc]
- Updated dependencies [9e45b63]
- Updated dependencies [b20201f]
  - @objectstack/platform-objects@16.1.0
  - @objectstack/spec@16.1.0
  - @objectstack/core@16.1.0
  - @objectstack/formula@16.1.0

## 16.0.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [6289ec3]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [8efa395]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [bfa3c3f]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [7125007]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [62a2117]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [06ff734]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
- Updated dependencies [8ff9210]
  - @objectstack/spec@16.0.0
  - @objectstack/platform-objects@16.0.0
  - @objectstack/core@16.0.0
  - @objectstack/formula@16.0.0

## 16.0.0-rc.1

### Patch Changes

- Updated dependencies [6289ec3]
- Updated dependencies [8efa395]
- Updated dependencies [bfa3c3f]
- Updated dependencies [7125007]
- Updated dependencies [62a2117]
- Updated dependencies [06ff734]
  - @objectstack/spec@16.0.0-rc.1
  - @objectstack/platform-objects@16.0.0-rc.1
  - @objectstack/formula@16.0.0-rc.1
  - @objectstack/core@16.0.0-rc.1

## 16.0.0-rc.0

### Patch Changes

- Updated dependencies [f972574]
- Updated dependencies [22013aa]
- Updated dependencies [3ad3dd5]
- Updated dependencies [3a18b60]
- Updated dependencies [a8aa34c]
- Updated dependencies [e057f42]
- Updated dependencies [a3823b2]
- Updated dependencies [bc65105]
- Updated dependencies [43a3efb]
- Updated dependencies [524696a]
- Updated dependencies [6b51346]
- Updated dependencies [80273c8]
- Updated dependencies [5e3301d]
- Updated dependencies [dd9f223]
- Updated dependencies [46e876c]
- Updated dependencies [5f05de2]
- Updated dependencies [021ba4c]
- Updated dependencies [158aa14]
- Updated dependencies [d2723e2]
- Updated dependencies [fefcd54]
- Updated dependencies [beaf2de]
- Updated dependencies [369eb6e]
- Updated dependencies [b659111]
- Updated dependencies [5754a23]
- Updated dependencies [6c270a6]
- Updated dependencies [290e2f0]
- Updated dependencies [668dd17]
- Updated dependencies [8abf133]
- Updated dependencies [e0859b1]
- Updated dependencies [04ecd4e]
- Updated dependencies [4d5a892]
- Updated dependencies [16cebeb]
- Updated dependencies [86d30af]
- Updated dependencies [8923843]
- Updated dependencies [ea32ec7]
- Updated dependencies [a2795f6]
- Updated dependencies [f16b492]
- Updated dependencies [4b6fde8]
- Updated dependencies [2018df9]
- Updated dependencies [fc5a3a2]
  - @objectstack/spec@16.0.0-rc.0
  - @objectstack/platform-objects@16.0.0-rc.0
  - @objectstack/core@16.0.0-rc.0
  - @objectstack/formula@16.0.0-rc.0

## 15.1.1

### Patch Changes

- @objectstack/spec@15.1.1
- @objectstack/core@15.1.1
- @objectstack/formula@15.1.1
- @objectstack/platform-objects@15.1.1

## 15.1.0

### Patch Changes

- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [3fe9df1]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [4109153]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [627f225]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
- Updated dependencies [f531a26]
  - @objectstack/spec@15.1.0
  - @objectstack/platform-objects@15.1.0
  - @objectstack/core@15.1.0
  - @objectstack/formula@15.1.0

## 15.0.0

### Patch Changes

- Updated dependencies [02a014b]
- Updated dependencies [28b7c28]
- Updated dependencies [13749ec]
- Updated dependencies [e62c233]
- Updated dependencies [ed61c9b]
- Updated dependencies [31d04d4]
  - @objectstack/platform-objects@15.0.0
  - @objectstack/spec@15.0.0
  - @objectstack/core@15.0.0
  - @objectstack/formula@15.0.0

## 14.8.0

### Patch Changes

- Updated dependencies [16b4bf6]
- Updated dependencies [16b4bf6]
- Updated dependencies [10e8983]
- Updated dependencies [607aaf4]
- Updated dependencies [bb71321]
  - @objectstack/spec@14.8.0
  - @objectstack/platform-objects@14.8.0
  - @objectstack/core@14.8.0
  - @objectstack/formula@14.8.0

## 14.7.0

### Patch Changes

- Updated dependencies [d6a72eb]
  - @objectstack/spec@14.7.0
  - @objectstack/core@14.7.0
  - @objectstack/formula@14.7.0
  - @objectstack/platform-objects@14.7.0

## 14.6.0

### Patch Changes

- Updated dependencies [609cb13]
- Updated dependencies [ce6d151]
  - @objectstack/spec@14.6.0
  - @objectstack/platform-objects@14.6.0
  - @objectstack/core@14.6.0
  - @objectstack/formula@14.6.0

## 14.5.0

### Patch Changes

- Updated dependencies [526805e]
- Updated dependencies [d79ca07]
- Updated dependencies [33ebd34]
- Updated dependencies [c044f08]
- Updated dependencies [01274eb]
- Updated dependencies [8f23746]
- Updated dependencies [b97af7e]
- Updated dependencies [6da03ee]
  - @objectstack/spec@14.5.0
  - @objectstack/platform-objects@14.5.0
  - @objectstack/core@14.5.0
  - @objectstack/formula@14.5.0

## 14.4.0

### Patch Changes

- Updated dependencies [7953832]
- Updated dependencies [82e745e]
- Updated dependencies [f3035bd]
- Updated dependencies [82c0d94]
- Updated dependencies [7449476]
  - @objectstack/spec@14.4.0
  - @objectstack/platform-objects@14.4.0
  - @objectstack/core@14.4.0
  - @objectstack/formula@14.4.0

## 14.3.0

### Patch Changes

- Updated dependencies [2a71f48]
- Updated dependencies [02f6af4]
- Updated dependencies [c1064f1]
  - @objectstack/platform-objects@14.3.0
  - @objectstack/spec@14.3.0
  - @objectstack/core@14.3.0
  - @objectstack/formula@14.3.0

## 14.2.0

### Patch Changes

- Updated dependencies [ac8f029]
- Updated dependencies [4ab9958]
  - @objectstack/spec@14.2.0
  - @objectstack/platform-objects@14.2.0
  - @objectstack/core@14.2.0
  - @objectstack/formula@14.2.0

## 14.1.0

### Patch Changes

- Updated dependencies [5a8465f]
- Updated dependencies [7f8620b]
- Updated dependencies [82ba3a6]
  - @objectstack/spec@14.1.0
  - @objectstack/core@14.1.0
  - @objectstack/formula@14.1.0
  - @objectstack/platform-objects@14.1.0

## 14.0.0

### Patch Changes

- Updated dependencies [0a8e685]
- Updated dependencies [afa8115]
- Updated dependencies [80f12ca]
- Updated dependencies [332b711]
- Updated dependencies [e2fa074]
- Updated dependencies [23c8668]
- Updated dependencies [29f017d]
- Updated dependencies [216fa9a]
- Updated dependencies [6c22b12]
- Updated dependencies [d0531c4]
- Updated dependencies [cff5aac]
  - @objectstack/spec@14.0.0
  - @objectstack/platform-objects@14.0.0
  - @objectstack/core@14.0.0
  - @objectstack/formula@14.0.0

## 13.0.0

### Patch Changes

- a1766fe: fix(validation): remove polynomial ReDoS in email validation regexes

  The email validators used `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, whose quantifiers
  around `\.` overlap (the literal dot is also matched by `[^\s@]`) and backtrack
  polynomially on adversarial input. The domain part is rewritten as
  `[^\s@.]+(?:\.[^\s@.]+)+` so labels exclude `.` and matching is linear. Valid
  addresses (including multi-label domains) are unaffected; addresses with an
  empty label such as `a@b..c` are now correctly rejected.

- Updated dependencies [6d83431]
- Updated dependencies [01917c2]
- Updated dependencies [b271691]
- Updated dependencies [a5a1e41]
- Updated dependencies [466adf6]
- Updated dependencies [5be00c3]
- Updated dependencies [466adf6]
- Updated dependencies [2bee609]
- Updated dependencies [9fa84f9]
- Updated dependencies [fc7e7f7]
  - @objectstack/spec@13.0.0
  - @objectstack/core@13.0.0
  - @objectstack/formula@13.0.0
  - @objectstack/platform-objects@13.0.0

## 12.6.0

### Patch Changes

- Updated dependencies [6cebf22]
- Updated dependencies [21420d9]
  - @objectstack/spec@12.6.0
  - @objectstack/core@12.6.0
  - @objectstack/formula@12.6.0
  - @objectstack/platform-objects@12.6.0

## 12.5.0

### Patch Changes

- Updated dependencies [8b3d363]
  - @objectstack/spec@12.5.0
  - @objectstack/core@12.5.0
  - @objectstack/formula@12.5.0
  - @objectstack/platform-objects@12.5.0

## 12.4.0

### Patch Changes

- Updated dependencies [60dc3ba]
  - @objectstack/spec@12.4.0
  - @objectstack/core@12.4.0
  - @objectstack/formula@12.4.0
  - @objectstack/platform-objects@12.4.0

## 12.3.0

### Patch Changes

- Updated dependencies [e7eceec]
  - @objectstack/spec@12.3.0
  - @objectstack/core@12.3.0
  - @objectstack/formula@12.3.0
  - @objectstack/platform-objects@12.3.0

## 12.2.0

### Patch Changes

- Updated dependencies [fce8ff4]
- Updated dependencies [3962023]
- Updated dependencies [2bb193d]
- Updated dependencies [0426d27]
- Updated dependencies [da807f7]
- Updated dependencies [4f5b791]
  - @objectstack/spec@12.2.0
  - @objectstack/core@12.2.0
  - @objectstack/formula@12.2.0
  - @objectstack/platform-objects@12.2.0

## 12.1.0

### Patch Changes

- Updated dependencies [93e6d02]
  - @objectstack/spec@12.1.0
  - @objectstack/core@12.1.0
  - @objectstack/formula@12.1.0
  - @objectstack/platform-objects@12.1.0

## 12.0.0

### Patch Changes

- Updated dependencies [a8df396]
- Updated dependencies [e695fe0]
- Updated dependencies [07f055c]
- Updated dependencies [7c09621]
- Updated dependencies [7709db4]
- Updated dependencies [2082109]
- Updated dependencies [7c09621]
- Updated dependencies [9860de4]
- Updated dependencies [069c205]
  - @objectstack/spec@12.0.0
  - @objectstack/platform-objects@12.0.0
  - @objectstack/core@12.0.0
  - @objectstack/formula@12.0.0

## 11.10.0

### Patch Changes

- Updated dependencies [6a9397e]
- Updated dependencies [c0efe5d]
  - @objectstack/spec@11.10.0
  - @objectstack/core@11.10.0
  - @objectstack/formula@11.10.0
  - @objectstack/platform-objects@11.10.0

## 11.9.0

### Patch Changes

- Updated dependencies [d3595d9]
  - @objectstack/spec@11.9.0
  - @objectstack/core@11.9.0
  - @objectstack/formula@11.9.0
  - @objectstack/platform-objects@11.9.0

## 11.8.0

### Patch Changes

- Updated dependencies [53d491a]
- Updated dependencies [b84726b]
  - @objectstack/platform-objects@11.8.0
  - @objectstack/spec@11.8.0
  - @objectstack/core@11.8.0
  - @objectstack/formula@11.8.0

## 11.7.0

### Patch Changes

- Updated dependencies [5178906]
  - @objectstack/spec@11.7.0
  - @objectstack/platform-objects@11.7.0
  - @objectstack/core@11.7.0
  - @objectstack/formula@11.7.0

## 11.6.0

### Patch Changes

- @objectstack/spec@11.6.0
- @objectstack/core@11.6.0
- @objectstack/formula@11.6.0
- @objectstack/platform-objects@11.6.0

## 11.5.0

### Patch Changes

- Updated dependencies [6ee4f04]
- Updated dependencies [c1e3a65]
  - @objectstack/spec@11.5.0
  - @objectstack/core@11.5.0
  - @objectstack/formula@11.5.0
  - @objectstack/platform-objects@11.5.0

## 11.4.0

### Patch Changes

- Updated dependencies [5821c51]
- Updated dependencies [a0fce3f]
  - @objectstack/spec@11.4.0
  - @objectstack/core@11.4.0
  - @objectstack/formula@11.4.0
  - @objectstack/platform-objects@11.4.0

## 11.3.0

### Patch Changes

- Updated dependencies [58e8e31]
- Updated dependencies [b4a5df0]
  - @objectstack/spec@11.3.0
  - @objectstack/core@11.3.0
  - @objectstack/formula@11.3.0
  - @objectstack/platform-objects@11.3.0

## 11.2.0

### Patch Changes

- Updated dependencies [d0f4b13]
- Updated dependencies [302bdab]
  - @objectstack/spec@11.2.0
  - @objectstack/core@11.2.0
  - @objectstack/formula@11.2.0
  - @objectstack/platform-objects@11.2.0

## 11.1.0

### Patch Changes

- Updated dependencies [cbc8c02]
- Updated dependencies [07c2773]
- Updated dependencies [d7a88df]
- Updated dependencies [4f8f108]
- Updated dependencies [ce0b4f6]
- Updated dependencies [90bce88]
- Updated dependencies [3209ec6]
- Updated dependencies [e011d42]
- Updated dependencies [6e5bdd5]
- Updated dependencies [9ccfcd6]
- Updated dependencies [ecf193f]
- Updated dependencies [51bec81]
- Updated dependencies [3e593a7]
- Updated dependencies [63d5403]
  - @objectstack/platform-objects@11.1.0
  - @objectstack/core@11.1.0
  - @objectstack/spec@11.1.0
  - @objectstack/formula@11.1.0

## 11.0.0

### Patch Changes

- Updated dependencies [9b5bf3d]
- Updated dependencies [cb5b393]
- Updated dependencies [ab5718a]
- Updated dependencies [4845c12]
- Updated dependencies [c1a754a]
- Updated dependencies [6fbe91f]
- Updated dependencies [715d667]
- Updated dependencies [5eef4cf]
- Updated dependencies [72759e1]
- Updated dependencies [6c4fbd9]
- Updated dependencies [ef3ed67]
- Updated dependencies [cd51229]
- Updated dependencies [7697a0e]
- Updated dependencies [e7e04f1]
- Updated dependencies [cfd5ac4]
- Updated dependencies [2be5c1f]
- Updated dependencies [ad143ce]
- Updated dependencies [5c4a8c8]
- Updated dependencies [3afaeed]
- Updated dependencies [5737261]
- Updated dependencies [a619a3a]
- Updated dependencies [f44c1bd]
- Updated dependencies [8801c02]
- Updated dependencies [3d04e06]
- Updated dependencies [4a84c98]
- Updated dependencies [c715d25]
- Updated dependencies [aa33b02]
- Updated dependencies [d980f0d]
- Updated dependencies [a658523]
- Updated dependencies [82ff91c]
- Updated dependencies [638f472]
  - @objectstack/platform-objects@11.0.0
  - @objectstack/spec@11.0.0
  - @objectstack/formula@11.0.0
  - @objectstack/core@11.0.0

## 10.3.0

### Patch Changes

- @objectstack/spec@10.3.0
- @objectstack/core@10.3.0
- @objectstack/formula@10.3.0
- @objectstack/platform-objects@10.3.0

## 10.2.0

### Patch Changes

- Updated dependencies [b496498]
  - @objectstack/spec@10.2.0
  - @objectstack/core@10.2.0
  - @objectstack/formula@10.2.0
  - @objectstack/platform-objects@10.2.0

## 10.1.0

### Patch Changes

- Updated dependencies [49da36e]
- Updated dependencies [ac79f16]
  - @objectstack/spec@10.1.0
  - @objectstack/core@10.1.0
  - @objectstack/formula@10.1.0
  - @objectstack/platform-objects@10.1.0

## 10.0.0

### Patch Changes

- Updated dependencies [d7ff626]
- Updated dependencies [2a1b16b]
- Updated dependencies [2256e93]
- Updated dependencies [7108ff3]
- Updated dependencies [30c0313]
- Updated dependencies [e16f2a8]
- Updated dependencies [cfd86ce]
- Updated dependencies [e411a82]
- Updated dependencies [ae271d0]
- Updated dependencies [61ed5c7]
- Updated dependencies [a581385]
- Updated dependencies [d5f6d29]
- Updated dependencies [220ce5b]
- Updated dependencies [3efe334]
- Updated dependencies [0df063e]
- Updated dependencies [ce13bb8]
- Updated dependencies [feead7e]
- Updated dependencies [6ca20b3]
- Updated dependencies [5f875fe]
- Updated dependencies [b469950]
- Updated dependencies [47d978a]
- Updated dependencies [48a307a]
- Updated dependencies [25fc0e4]
  - @objectstack/spec@10.0.0
  - @objectstack/platform-objects@10.0.0
  - @objectstack/formula@10.0.0
  - @objectstack/core@10.0.0

## 9.11.0

### Patch Changes

- Updated dependencies [e7f6539]
- Updated dependencies [2365d07]
- Updated dependencies [6595b53]
- Updated dependencies [fa8964d]
- Updated dependencies [36138c7]
- Updated dependencies [a8e4f3b]
- Updated dependencies [4c213c2]
- Updated dependencies [2afb612]
  - @objectstack/spec@9.11.0
  - @objectstack/core@9.11.0
  - @objectstack/formula@9.11.0
  - @objectstack/platform-objects@9.11.0

## 9.10.0

### Patch Changes

- Updated dependencies [db02bd5]
- Updated dependencies [641675d]
- Updated dependencies [1f88fd9]
- Updated dependencies [94e9040]
- Updated dependencies [4331adb]
- Updated dependencies [1f88fd9]
- Updated dependencies [1f88fd9]
  - @objectstack/spec@9.10.0
  - @objectstack/formula@9.10.0
  - @objectstack/platform-objects@9.10.0
  - @objectstack/core@9.10.0

## 9.9.1

### Patch Changes

- @objectstack/spec@9.9.1
- @objectstack/core@9.9.1
- @objectstack/formula@9.9.1
- @objectstack/platform-objects@9.9.1

## 9.9.0

### Minor Changes

- 575448d: feat(formula,email): render `datetime` in a reference timezone (ADR-0053 Phase 2)

  `datetime` template holes now render in a reference timezone's wall-clock when one is supplied, at the presentation boundary — storage stays UTC.

  - **Formula template engine** — the `datetime` formatter takes the reference timezone from `EvalContext.timezone` (threaded in #1980) and passes it to `Intl.DateTimeFormat`. `{{ ts | datetime }}` renders in that zone; `{{ ts | datetime:iso }}` stays UTC (machine-readable). Calendar-day `date` rendering is intentionally **unchanged** (tz-naive — a `Field.date` has no zone). New exported `formatValue(name, value, arg, { locale, timeZone })` makes the whitelisted formatters reusable outside the full CEL template engine.
  - **Email pipeline** — `plugin-email`'s renderer previously bypassed the formatter pipeline (`String()` only), so a datetime went out as raw ISO. Email holes now accept the shared formula formatters — `{{ order.total | currency }}`, `{{ ts | datetime }}` — reusing `formatValue` (single source of truth), while keeping the engine's HTML-escaping and `{{{ }}}` raw-output semantics. `SendTemplateInput.timezone` (mirroring the existing `locale`) flows into rendering so an email's datetime shows the recipient's wall-clock.

### Patch Changes

- Updated dependencies [84249a4]
- Updated dependencies [11af299]
- Updated dependencies [d5774b5]
- Updated dependencies [134043a]
- Updated dependencies [90108e0]
- Updated dependencies [9afeb2d]
- Updated dependencies [6bec07e]
- Updated dependencies [601cc11]
- Updated dependencies [d99a75a]
- Updated dependencies [575448d]
  - @objectstack/spec@9.9.0
  - @objectstack/core@9.9.0
  - @objectstack/formula@9.9.0
  - @objectstack/platform-objects@9.9.0

## 9.8.0

### Patch Changes

- Updated dependencies [97c55b3]
- Updated dependencies [1b1f490]
  - @objectstack/spec@9.8.0
  - @objectstack/core@9.8.0
  - @objectstack/platform-objects@9.8.0

## 9.7.0

### Patch Changes

- @objectstack/spec@9.7.0
- @objectstack/core@9.7.0
- @objectstack/platform-objects@9.7.0

## 9.6.0

### Patch Changes

- Updated dependencies [d1e930a]
- Updated dependencies [71578f2]
- Updated dependencies [5e3a301]
- Updated dependencies [5db2742]
  - @objectstack/spec@9.6.0
  - @objectstack/core@9.6.0
  - @objectstack/platform-objects@9.6.0

## 9.5.1

### Patch Changes

- Updated dependencies [ee72aae]
  - @objectstack/spec@9.5.1
  - @objectstack/core@9.5.1
  - @objectstack/platform-objects@9.5.1

## 9.5.0

### Patch Changes

- Updated dependencies [d08551c]
- Updated dependencies [5be7102]
- Updated dependencies [707aeed]
- Updated dependencies [7a103d4]
- Updated dependencies [4b01250]
  - @objectstack/spec@9.5.0
  - @objectstack/platform-objects@9.5.0
  - @objectstack/core@9.5.0

## 9.4.0

### Patch Changes

- Updated dependencies [060467a]
- Updated dependencies [0856476]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
- Updated dependencies [b678d8c]
  - @objectstack/spec@9.4.0
  - @objectstack/core@9.4.0
  - @objectstack/platform-objects@9.4.0

## 9.3.0

### Patch Changes

- Updated dependencies [1ada658]
- Updated dependencies [3219191]
- Updated dependencies [290f631]
- Updated dependencies [50b7b47]
- Updated dependencies [f15d6f6]
- Updated dependencies [f8684ea]
- Updated dependencies [c802327]
- Updated dependencies [b4765be]
  - @objectstack/spec@9.3.0
  - @objectstack/platform-objects@9.3.0
  - @objectstack/core@9.3.0

## 9.2.0

### Patch Changes

- Updated dependencies [2f57b75]
- Updated dependencies [2f57b75]
  - @objectstack/spec@9.2.0
  - @objectstack/core@9.2.0
  - @objectstack/platform-objects@9.2.0

## 9.1.0

### Patch Changes

- Updated dependencies [b9062c9]
  - @objectstack/spec@9.1.0
  - @objectstack/core@9.1.0
  - @objectstack/platform-objects@9.1.0

## 9.0.1

### Patch Changes

- Updated dependencies [1817845]
  - @objectstack/spec@9.0.1
  - @objectstack/core@9.0.1
  - @objectstack/platform-objects@9.0.1

## 9.0.0

### Patch Changes

- Updated dependencies [4c3f693]
- Updated dependencies [0bf39f1]
- Updated dependencies [f533f42]
- Updated dependencies [1c83ee8]
  - @objectstack/spec@9.0.0
  - @objectstack/core@9.0.0
  - @objectstack/platform-objects@9.0.0

## 8.0.1

### Patch Changes

- @objectstack/spec@8.0.1
- @objectstack/core@8.0.1
- @objectstack/platform-objects@8.0.1

## 8.0.0

### Patch Changes

- Updated dependencies [a46c017]
- Updated dependencies [b990b89]
- Updated dependencies [99111ec]
- Updated dependencies [d5a8161]
- Updated dependencies [5cf1f1b]
- Updated dependencies [9ef89d4]
- Updated dependencies [3306d2f]
- Updated dependencies [c262301]
- Updated dependencies [bc44195]
- Updated dependencies [9e2e229]
  - @objectstack/spec@8.0.0
  - @objectstack/core@8.0.0
  - @objectstack/platform-objects@8.0.0

## 7.9.0

### Patch Changes

- @objectstack/spec@7.9.0
- @objectstack/core@7.9.0
- @objectstack/platform-objects@7.9.0

## 7.8.0

### Patch Changes

- Updated dependencies [06f2bbb]
- Updated dependencies [36719db]
- Updated dependencies [424ab26]
  - @objectstack/spec@7.8.0
  - @objectstack/core@7.8.0
  - @objectstack/platform-objects@7.8.0

## 7.7.0

### Patch Changes

- Updated dependencies [b391955]
- Updated dependencies [f06b64e]
- Updated dependencies [023bf93]
- Updated dependencies [764c747]
  - @objectstack/spec@7.7.0
  - @objectstack/platform-objects@7.7.0
  - @objectstack/core@7.7.0

## 7.6.0

### Patch Changes

- d8aa11d: Harden `htmlToText` against double-escaping and incomplete tag stripping

  Fixes two CodeQL high-severity alerts in `template-engine.ts`:

  - `js/double-escaping`: the order-dependent chain of single-entity
    `.replace()` calls could double-unescape (e.g. `&amp;lt;` → `&lt;` → `<`).
    Entities are now decoded in a single left-to-right pass via one alternation
    regex, so each entity decodes exactly once.
  - `js/incomplete-multi-character-sanitization`: the single `<[^>]+>` strip
    could leave a live tag behind on crafted/overlapping input
    (e.g. `<scr<script>ipt>`). Tag stripping now loops until the string is
    stable, and runs before entity decoding so decoding cannot re-introduce a
    tag.

  Adds adversarial unit tests covering nested entities and overlapping tags.

- Updated dependencies [955d4c8]
- Updated dependencies [c4a4cbd]
- Updated dependencies [b046ec2]
- Updated dependencies [2170ad9]
- Updated dependencies [02d6359]
- Updated dependencies [7648242]
- Updated dependencies [8fa1e7f]
- Updated dependencies [7ae6abc]
- Updated dependencies [55866f5]
- Updated dependencies [60f9c45]
  - @objectstack/spec@7.6.0
  - @objectstack/platform-objects@7.6.0
  - @objectstack/core@7.6.0

## 7.5.0

### Patch Changes

- @objectstack/spec@7.5.0
- @objectstack/core@7.5.0
- @objectstack/platform-objects@7.5.0

## 7.4.1

### Patch Changes

- @objectstack/spec@7.4.1
- @objectstack/core@7.4.1
- @objectstack/platform-objects@7.4.1

## 7.4.0

### Patch Changes

- Updated dependencies [23c7107]
- Updated dependencies [c72daad]
- Updated dependencies [4404572]
- Updated dependencies [eea3f1b]
- Updated dependencies [e478e0c]
- Updated dependencies [4cc2ced]
- Updated dependencies [13632b1]
- Updated dependencies [f115182]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [2faf9f2]
- Updated dependencies [58b450b]
- Updated dependencies [82eb6cf]
- Updated dependencies [c381977]
- Updated dependencies [13d8653]
- Updated dependencies [ff3d006]
- Updated dependencies [5e831de]
  - @objectstack/spec@7.4.0
  - @objectstack/platform-objects@7.4.0
  - @objectstack/core@7.4.0

## 7.3.0

### Patch Changes

- Updated dependencies [5e7c554]
  - @objectstack/spec@7.3.0
  - @objectstack/core@7.3.0
  - @objectstack/platform-objects@7.3.0

## 7.2.1

### Patch Changes

- @objectstack/spec@7.2.1
- @objectstack/core@7.2.1
- @objectstack/platform-objects@7.2.1

## 7.2.0

### Patch Changes

- @objectstack/spec@7.2.0
- @objectstack/core@7.2.0
- @objectstack/platform-objects@7.2.0

## 7.1.0

### Patch Changes

- Updated dependencies [6228609]
- Updated dependencies [47a92f4]
  - @objectstack/platform-objects@7.1.0
  - @objectstack/spec@7.1.0
  - @objectstack/core@7.1.0

## 7.0.0

### Patch Changes

- Updated dependencies [74470ad]
- Updated dependencies [d29617e]
- Updated dependencies [dc72172]
- Updated dependencies [d29617e]
- Updated dependencies [010757b]
- Updated dependencies [257954d]
  - @objectstack/spec@7.0.0
  - @objectstack/platform-objects@7.0.0
  - @objectstack/core@7.0.0

## 6.9.0

### Patch Changes

- @objectstack/spec@6.9.0
- @objectstack/core@6.9.0
- @objectstack/platform-objects@6.9.0

## 6.8.1

### Patch Changes

- @objectstack/spec@6.8.1
- @objectstack/core@6.8.1
- @objectstack/platform-objects@6.8.1

## 6.8.0

### Patch Changes

- Updated dependencies [6e88f77]
- Updated dependencies [c8b9f57]
- Updated dependencies [45d27c5]
  - @objectstack/spec@6.8.0
  - @objectstack/platform-objects@6.8.0
  - @objectstack/core@6.8.0

## 6.7.1

### Patch Changes

- @objectstack/spec@6.7.1
- @objectstack/core@6.7.1
- @objectstack/platform-objects@6.7.1

## 6.7.0

### Patch Changes

- Updated dependencies [430067b]
- Updated dependencies [4f9e9d4]
- Updated dependencies [4f9e9d4]
  - @objectstack/spec@6.7.0
  - @objectstack/platform-objects@6.7.0
  - @objectstack/core@6.7.0

## 6.6.0

### Patch Changes

- Updated dependencies [a49cfc2]
  - @objectstack/spec@6.6.0
  - @objectstack/core@6.6.0
  - @objectstack/platform-objects@6.6.0

## 6.5.1

### Patch Changes

- @objectstack/spec@6.5.1
- @objectstack/core@6.5.1
- @objectstack/platform-objects@6.5.1

## 6.5.0

### Patch Changes

- @objectstack/spec@6.5.0
- @objectstack/core@6.5.0
- @objectstack/platform-objects@6.5.0

## 6.4.0

### Patch Changes

- Updated dependencies [f8651cc]
- Updated dependencies [f8651cc]
- Updated dependencies [0bf6f9a]
  - @objectstack/spec@6.4.0
  - @objectstack/core@6.4.0
  - @objectstack/platform-objects@6.4.0

## 6.3.0

### Patch Changes

- @objectstack/spec@6.3.0
- @objectstack/core@6.3.0
- @objectstack/platform-objects@6.3.0

## 6.2.0

### Patch Changes

- Updated dependencies [b4c74a9]
  - @objectstack/spec@6.2.0
  - @objectstack/core@6.2.0
  - @objectstack/platform-objects@6.2.0

## 6.1.1

### Patch Changes

- @objectstack/spec@6.1.1
- @objectstack/core@6.1.1
- @objectstack/platform-objects@6.1.1

## 6.1.0

### Patch Changes

- Updated dependencies [93c0589]
  - @objectstack/spec@6.1.0
  - @objectstack/core@6.1.0
  - @objectstack/platform-objects@6.1.0

## 6.0.0

### Patch Changes

- Updated dependencies [629a716]
- Updated dependencies [dbc4f7d]
- Updated dependencies [944f187]
  - @objectstack/spec@6.0.0
  - @objectstack/platform-objects@6.0.0
  - @objectstack/core@6.0.0

## 5.2.0

### Patch Changes

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/core@5.2.0

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/core@5.1.0

## 5.0.0

### Patch Changes

- Updated dependencies [888a5c1]
- Updated dependencies [2f9073a]
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/core@5.0.0

## 4.2.0

### Patch Changes

- Updated dependencies [2869891]
  - @objectstack/spec@4.2.0
  - @objectstack/core@4.2.0
  - @objectstack/platform-objects@4.2.0

## 4.1.1

### Patch Changes

- @objectstack/spec@4.1.1
- @objectstack/core@4.1.1
- @objectstack/platform-objects@4.1.1

## 4.0.1

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0
