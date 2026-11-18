---
'@objectstack/service-messaging': patch
'@objectstack/plugin-security': patch
'@objectstack/platform-objects': patch
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(account): a Notification Settings page where each person chooses their own notification topics, channels, digest and quiet hours

Clause-②: yes
Metadata-protocol: none

The Account app has a new **Notification Settings** page, under Inbox and only when the messaging service runs. It shows one row per notification topic and one column per channel. Each cell shows whether that notification reaches you on that channel, and where the answer comes from: your own setting, your organization's default, the built-in default, or a mandatory topic. Mandatory topics are always delivered and cannot be switched off. A channel the deployment cannot send on yet says so in its column header. Above the matrix you can set your digest and your quiet hours.

- **The read: `GET /api/v1/messaging/me/preferences`.** This new door answers the signed-in person's *effective* preferences. The server computes them with the same resolver `emit` uses to filter (`PreferenceResolver.effectiveFor`), so the page shows what is actually sent and computes nothing itself. The door takes no parameters and answers only about the caller: there is no `user` parameter, and any parameter is refused `VALIDATION_ERROR` / `400`. It keeps the posture of `GET /api/v1/messaging/preference-options`:
  - an anonymous caller gets `401`;
  - a held sign-in gets `403`;
  - a source it cannot read is `500` / `INTERNAL_ERROR`, never a partial or "everything on" answer.

  The organization's defaults appear only as `source: 'default'` on the caller's own cells. No other person's row, and no row id except the caller's own, is ever answered.
- **The writes: your own `sys_notification_preference` rows, through the data door, as you.** `member_default` now grants ordinary members (`positions: ['org_member']`) read, create and edit on the object, with no delete. The policy has two parts:
  - the row scope is `user_id == current_user.id`;
  - the write check is the same expression, so the row as written must still be your own.

  A member's create with `user_id` omitted, empty or naming another person is refused `403` / `PERMISSION_DENIED`, as is moving their own row to another person or to the organization default. A member lists only their own rows.
- **Administrators are unchanged.** They still list every row, create and edit the organization default, and edit another person's row in the Setup grid.

There is no "reset to the organization's default" button, because that needs a delete, which members are not granted. Changing your digest or quiet hours saves your own general setting, and the page says so beside the control. From then on, that setting applies in place of the organization's defaults to every topic and channel you have not set yourself.
