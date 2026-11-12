---
'@objectstack/runtime': minor
'@objectstack/spec': minor
---

fix(runtime)!: the automation write doors refuse a `notify` node that names a channel no plugin registers, so `POST /api/v1/automation` answers 400 at the save instead of storing a flow whose deliveries on that channel fail at every run

Clause-②: no (narrowing) — the `/automation` definition write doors refuse a definition they accepted before: one with a `notify` node whose `channels` name a channel the messaging service knows nothing of. Nothing is widened.
Metadata-protocol: narrowed
Skills-docs: none — every `notify` node `skills/objectstack-automation` teaches names `inbox` or `email`, which the messaging service registers, and the refusal text carries the cure.

<!-- adr-0087: registered notify-channel-unknown-refused -->

**BREAKING** accept-set narrowing at the automation definition write doors: `POST /api/v1/automation`, `PUT /api/v1/automation/NAME` and the copy door `POST /api/v1/automation/NAME/clone`.

- **Before.** A flow whose `notify` node named a channel nothing registers (`channels: 'emial'`, or a plugin's channel on a deployment without that plugin) saved with `200`. At run time every delivery on that channel failed with `channel 'NAME' not registered`, and the step recorded a warning.
- **Now.** The door answers `400 VALIDATION_FAILED` and registers and stores nothing. The message opens "Flow 'NAME' rejected: N notify channel(s) no plugin registers:", names each node and channel at its path (`nodes.1.config.channels`, `nodes.1.config.channels.0` for a list member, inside a region body too) with a did-you-mean, and lists the channels the deployment registers; `error.details.fields` carries the same paths. An update the door refuses leaves the flow the engine held in place.
- **What counts as registered.** Every channel the messaging service knows: the inbox, a channel a plugin registers, and the `email`, `sms` and `push` providers whether or not their transport is configured yet (such a channel is listed as "no transport configured yet" and accepted: it starts sending once the transport is configured, with no flow edit). The registry is read at the save, once the kernel's `kernel:ready` has settled, when every plugin has registered its channels.
- **Not judged.** A deployment with no messaging service (a `notify` node then delivers nothing whatever it names), one whose channel reader throws or answers no list, a save before `kernel:ready` has settled, a flow a package ships, a flow stored through the metadata door, and a stored row re-registered at boot: they register as before. Positions and queues an approval node names are not checked at the save either: they are runtime data, and a name nobody holds is resolved when the run reaches the node.
- **Unchanged.** A `notify` node naming registered channels, or no `channels` at all (the inbox), saves as before; the run-time `channel 'NAME' not registered` outcome is unchanged.
