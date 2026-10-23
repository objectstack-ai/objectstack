---
'@objectstack/service-messaging': patch
---

fix(service-messaging): Setup's Notification Preferences form says which topics and channels can be entered

Clause-②: no
Metadata-protocol: none

The Topic and Channel boxes on a notification preference only said "Notification topic" and "Channel id (inbox/email/push/…)", so an administrator had to know the machine names. One of the channels it named, `push`, does not exist. Both fields stay free text, because neither has a fixed list to pick from:

- **Topics.** A topic is whatever name the sender uses, and nothing registers topics. A flow's notify step names its own topic, and platform features send fixed ones such as `approval.requested`.
- **Channels.** Channels are registered while the server runs, and any plugin can add one. A dropdown would accept only the values in its list, and it cannot store the `*` wildcard that means "all channels".

The help now names the values:

- **Channel:** `inbox` (always available), `email` (once an email service is configured), `sms` (once an SMS service is configured), or the id of a channel an installed plugin adds.
- **Topic:** where topics come from, with examples.

Both helps also say `*` means all, and that a value nothing uses matches nothing.

No stored row, accepted value, default or column changes. The translation bundles carry the new help.
