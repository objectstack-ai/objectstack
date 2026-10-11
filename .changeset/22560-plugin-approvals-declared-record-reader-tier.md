---
'@objectstack/plugin-approvals': minor
---

feat(plugin-approvals): the record-reader approval tier honours an object's own `enable.approvalsVisibleToReaders` declaration

Clause-②: yes (widening)

- **Before this,** the read-only record-reader tier could be switched on only through the `recordReaderVisibleObjects` constructor option. A config-driven app, whose host builds the plugin with no options, had no way to reach it.
- **Now** the tier is on for an object when either source turns it on: the host's `recordReaderVisibleObjects`, or the object's own `enable.approvalsVisibleToReaders: true`. With neither, visibility is exactly as before.
- **Read where it is used.** The service reads the declaration from the object's live registered definition on each read that names a record, not once at start. An object registered after boot (an installed package, a Studio edit, a dev reload) takes effect at once. Removing the flag turns the tier off at once, with no restart.
- **Fails closed.** An engine that cannot answer an object definition, an unknown object, or any value other than `true` leaves the tier off. Default OFF costs one in-memory registry lookup on a read that names a record. The business record is never probed for an object that declares nothing.
- **Unchanged.** The rule itself: who counts as a reader, the read-only boundary, the request tables it covers on both doors, and the constructor option.
