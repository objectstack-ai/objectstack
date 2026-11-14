---
'@objectstack/service-messaging': patch
---

fix(service-messaging): a `role:` audience resolves in the emitting organization only

Clause-②: no
Metadata-protocol: none

A `role:NAME` audience now resolves in the emitting organization: the organization the producer passed to `emit()`, else the one stored on the notification's own event row, which is the organization its delivery, inbox and receipt rows already carry. It reaches the holders of that role in that organization and in no other. When neither the producer nor the stored event row names an organization, `role:` reaches nobody: 0 recipients and a warning naming the remedy (pass `organizationId` to `emit()`), the same answer `org:members` gives without an organization. Every other selector is unchanged: `org:members` still resolves with the organization the producer passed, and nobody when it passed none. Emits that name their organization resolve as before.

Who moves: a producer whose `role:` audience has no organization anywhere — none passed to `emit()` and none stored on the event row — now reaches no one, with a warning. Pass the organization to `emit()`, or run the flow that carries the `notify` node in the organization whose members it addresses.
