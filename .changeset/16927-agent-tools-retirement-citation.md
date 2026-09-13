---
'@objectstack/spec': patch
---

The `agent.tools` rejection now says why ADR-0064 binds, so its `Proposed` status does not read as "not yet in force"

An author who writes the retired `agent.tools` key gets the tombstone's
prescription, which rests the rule on **ADR-0064** (*"an agent's tool set is the
union of its surface-compatible skills' tools"*). Following that citation lands
on a record whose own header reads `**Status**: Proposed (2026-06-22)` and
carries a `🔶 Cloud-owned — superseded in part by cloud ADR-0025` callout. From
the record itself an author cannot tell that the rule still binds them — the
weaker reading is the one the metadata invites.

ADR-0064 stays the cited authority, because it is the record that states the
invariant the key violated; **ADR-0109** (`Accepted — implemented (Phase 1)`)
names `agent.tools` nowhere and only *builds on* that invariant, so retargeting
the citation would send the author to a record that does not contain the rule
they broke. The message instead gains one clarifying clause: the `Proposed` /
cloud-owned status scopes the **runtime** half (tool resolution, which lives in
cloud `service-ai`), while the **authoring** half is in force in this repo and
ADR-0109 is the in-repo record carrying it.

Prose only — the rejection, the retirement and the accept set are unchanged.
