---
'@objectstack/runtime': patch
'@objectstack/spec': patch
---

fix(runtime): a channel list with a member off the declared shape is not judged at the automation save doors, so it no longer refuses every channel

Clause-②: no
Metadata-protocol: none

The `/automation` write doors (`POST /api/v1/automation`, `PUT /api/v1/automation/NAME`, `POST /api/v1/automation/NAME/clone`) read the messaging service's `getKnownChannels()` to refuse a `notify` node naming a channel nothing registers. A reader that throws or answers no list was already not judged. A list whose members were not all `{ id: string }` (the declared shape) had those members dropped instead, so a reader answering bare channel ids left an empty roster and every named channel was refused `400 VALIDATION_FAILED`. Such a list is now an unreadable registry like the other two: not judged, and the save goes on as it did before the check existed. No first-party messaging service answers that shape; `MessagingService.getKnownChannels()` answers the declared one, and a flow naming an unknown channel on it is refused exactly as before.

The `notify-channel-unknown-refused` entry `os migrate meta` prints now lists every not-judged case the doors have (a save before `kernel:ready` has settled, and an unreadable channel reader, beside the four it named) and the paths a refusal names (`nodes.N.config.channels`, `nodes.N.config.channels.M` for a list member, a longer path inside a region body). Data text only.
