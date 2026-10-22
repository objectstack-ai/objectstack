---
'@objectstack/plugin-security': patch
---

fix(plugin-security)!: under a `controlled_by_parent` declaration whose one master reference is `readonly` or `system`, every write that sets that reference is refused (ADR-0055 §1)

Clause-②: no (narrowing)

Metadata-protocol: none

<!-- adr-0087: not-required (already-registered cbp-master-relation-tiers-retired) registered before this change, and it covers it: that entry's stored-row listing (`os migrate meta --stored`) already reports this declaration as `master-not-writable`, with the prescription below. Nothing new moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed. What changes is the answer the security plugin's write gate gives on an object that reached the registry with a declaration the parse already refuses. -->

**BREAKING** for a caller that relied on such a write landing. A non-protocol change, shipped as `patch`.

ADR-0055 §1 derives a `controlled_by_parent` detail's access from exactly one required `master_detail` field that every write of a detail supplies. The parse refuses that master when it is declared `readonly: true` or `system: true`, so an object with it reaches the runtime only through a door that does not parse: a raw `registerObject` or `registerApp`, a `defineStack` call with `strict: false`, or a stored object the boot registers under its `[metadata_spec_invalid]` diagnostic. On such an object the security plugin's write gate let writes that set the master reference through, and a detail could end up outside the master its access derives from, readable by nobody, while the write reported success.

- **Before.** An insert under that declaration was written when it named a master. An update could set the reference.
- **Now.** Every write that sets the reference answers `INVALID_METADATA` (422) and writes nothing, before any master is asked: every insert, single or batch, whether or not it names a master, and every update whose body carries the reference key, whatever the value, `null` included. The message is the parse's own refusal of the declaration, prefixed with the write it refused, so it names the object, the field, each flag and the fix. It is the same for every caller the gate judges.
- **Unchanged.**
  - The rows already stored: the gate still derives their read access from that field, so they keep their master and are read as before.
  - A delete, and an update whose body leaves the reference key out.
  - System contexts, every object declared with an ordinary required master, and every object that does not declare `controlled_by_parent`.

**What to do.** Fix the declaration as the parse says: remove `readonly: true` and `system: true` from the master reference and declare it as an ordinary required field. If the rows must outlive their parent, the object is not a detail: give it its own `sharingModel` (`private`, `public_read` or `public_read_write`).
