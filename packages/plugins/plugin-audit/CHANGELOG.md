# @objectstack/plugin-audit

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

### Minor Changes

- 13632b1: ADR-0030 P0 (framework) — converge notifications onto a single ingress and the
  layered model. Every producer now publishes through
  `NotificationService.emit(EmitInput)`; the in-app inbox is a materialization of
  delivery, not a row producers write.

  **Single ingress (`@objectstack/service-messaging`) — breaking**

  - `MessagingService.emit` takes the new `EmitInput` contract (`topic` /
    `audience` / `payload` / `severity` / `dedupKey` / `source` / `actorId` /
    `organizationId` / `channels`) instead of the flat `Notification` shape. It
    writes the L2 `sys_notification` event (idempotent on `dedupKey`), resolves the
    audience, then fans out; it returns `{ notificationId, deduped, deliveries,
delivered, failed }`.
  - New `sys_notification_receipt` object — the read-state spine
    (`delivered|read|clicked|dismissed`), keyed `(notification_id, user_id,
channel)`. The inbox channel writes a `delivered` receipt on materialization.
  - `sys_inbox_message`: adds `notification_id` / `delivery_id`, **drops `read`**
    (read-state moved to the receipt), adds the user `mine` list view.

  **Event re-model (`@objectstack/platform-objects`) — breaking**

  - `sys_notification` is re-modeled from a per-user inbox into the L2 **event**
    (`topic`, `payload`, `severity`, `dedup_key`, `source_*`, `actor_id`). Removes
    `recipient_id` / `is_read` / `read_at` / `type` / `title` / `body` / `url` /
    `actor_name` and the inbox actions/views. App-nav: the account inbox points at
    `sys_inbox_message`; Setup shows the notification event log.

  **Producers routed through `emit()`**

  - `@objectstack/service-automation`: the `notify` node maps its config to
    `EmitInput`.
  - `@objectstack/plugin-audit`: collaboration `@mention` → `collab.mention` and
    assignment → `collab.assignment` (both with a `dedupKey`); no more direct
    `sys_notification` writes. Collaboration notifications now require
    `MessagingServicePlugin` (they degrade to a warn otherwise).

  **Migration (`@objectstack/metadata`)**

  - Idempotent `migrateSysNotificationToEvent` splits legacy `sys_notification`
    inbox rows into `sys_inbox_message` + receipts and rewrites the event row.

  **Startup (`@objectstack/cli`, `@objectstack/runtime`)**

  - `messaging` is now a foundational capability. On `objectstack serve` it is
    added to `ALWAYS_ON_CAPABILITIES` (every non-`minimal` preset starts it); on
    cloud per-project kernels the capability loader expands `requires` to add
    `messaging` whenever `audit` is present. This keeps collaboration `@mention` /
    assignment notifications (which now flow through the pipeline) working out of
    the box on both paths. `--preset minimal` opts out.

  The Console bell repoint (objectui) and phases P1–P3 are tracked in
  `docs/handoff/adr-0030-notification-convergence.md`.

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

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [23db640]
  - @objectstack/spec@4.1.0
  - @objectstack/core@4.1.0
  - @objectstack/platform-objects@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/core@4.0.5
  - @objectstack/platform-objects@4.0.5

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/core@4.0.4

## 4.0.3

### Patch Changes

- @objectstack/spec@4.0.3
- @objectstack/core@4.0.3

## 4.0.2

### Patch Changes

- Updated dependencies [5f659e9]
  - @objectstack/spec@4.0.2
  - @objectstack/core@4.0.2

## 4.0.0

### Patch Changes

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/core@4.0.0

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/core@3.3.1

## 3.2.10

### Patch Changes

- @objectstack/spec@3.3.0
- @objectstack/core@3.3.0

## 3.2.9

### Patch Changes

- @objectstack/spec@3.2.9
- @objectstack/core@3.2.9

## 3.2.8

### Patch Changes

- @objectstack/spec@3.2.8
- @objectstack/core@3.2.8

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
