---
'@objectstack/spec': minor
'@objectstack/plugin-audit': minor
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': minor
'@objectstack/client': minor
---

feat(spec): a comment's author is told which @mentioned users will not be notified, and a mention added by editing is notified

Clause-②: yes
Metadata-protocol: added

The `@mention` recipient gate withholds a notification from a mentioned user who cannot read the comment or its record. Until now it only logged that, so the author believed the person had been told. The comment still saves with every mention; now the requester's own answer says who will not be notified.

- **Spec.** `CreateDataResponseSchema` and `UpdateDataResponseSchema` declare an optional, response-only `withheldMentions`: the ids of the users this write @mentioned whose notification the mention gate withheld. Ids only, never the reason. Only a `sys_comment` write fills it, only on the requester's own answer to that request, and the key is omitted when nobody was withheld. It is not a field of `sys_comment` and is never stored, since a stored member would tell every reader who cannot read the thread. `WriteObservabilityOptions` declares the in-process listener that carries it, `onMentionsWithheld(userIds)`, beside `onFieldsDropped` and `onValidationAdvisory`. Like them it never crosses the wire.
- **plugin-audit.** The mention writer reports the gate's own verdict to that listener, which it reads off its hook's `ctx.input.options` (the write's own options bag). Readability is not derived a second time, and who the gate admits is unchanged. The writer now also runs on `sys_comment` `afterUpdate`, so a mention added by editing a comment is judged and notified like one written with it. An edit judges only the mentions it added; a mention the comment already carried is not judged or notified again. The editor, who may be a parent-record editor rather than the author, is the actor of an edit's notifications: they are named in the title and never notified themselves. `MentionGateInput` takes an optional `onWithheld(userId)` callback.
- **metadata-protocol.** `createData` and `updateData` pass the listener and answer the ids as `withheldMentions`. A nested write that a hook or a flow makes inside this one carries its own options, so its verdicts never reach this answer.
- **client.** `CreateDataResult` and `UpdateDataResult` declare `withheldMentions?: string[]`, mirroring the two schemas.
- **objectql.** `engine.update` accepts the `onMentionsWithheld` option. The engine never calls it; it carries it to the `after*` hooks with the rest of the caller's bag.

Nothing to do for existing clients: a client that does not read `withheldMentions` sees the same answer as before.
