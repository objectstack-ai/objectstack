---
'@objectstack/service-messaging': patch
---

fix(service-messaging): the heading of a notification digest of two or more items is rendered in its recipient's language, not as the English "You have N notifications" for everyone

Clause-②: no
Metadata-protocol: none

- **Before.** A recipient whose notification preference digests `daily` or `weekly` received each window's digest headed "You have N notifications" in English, whatever their language, even when every item under it was rendered in their language.
- **Now.** The heading is keyed (`messages.notificationDigestTitle`, with a `{{count}}` hole) in `@objectstack/service-messaging`'s own translation bundle, in en, zh-CN, ja-JP and es-ES. It is rendered at delivery by the same keyed-text renderer as the digest's items (`EmitInput.keyedText`), in the same locale read: the recipient's `sys_user.locale`, then the deployment default. A zh-CN recipient reads "您有 3 条通知".
- **Unchanged.** The English sentence stays the literal fallback, byte for byte: with no `i18n` service, with no renderer composed, or when neither the recipient's language nor the deployment default has a pack. A one-item digest is still titled by its item. No export, option or type changes.
- **Cost.** With an `i18n` service registered, each digest of two or more items now reads its recipient's locale once, even when none of its items is keyed, because its heading always is.
