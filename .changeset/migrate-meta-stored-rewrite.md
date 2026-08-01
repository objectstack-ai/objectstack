---
"@objectstack/metadata-protocol": minor
"@objectstack/cli": patch
---

feat(migrate,metadata-protocol): `os migrate meta --stored` rewrites sys_metadata rows so the read-path chain has a finish line (#4327)

#4317 closed the correctness gap from the read side: every stored-row
rehydration seam replays the full ADR-0087 conversion chain, retired entries
included, so a row written under any past protocol is *served* canonical
forever. What it deliberately did not do is make the rows themselves canonical.
A pre-17 row keeps its legacy bytes, the chain re-lowers it on every load, and
each affected row logs one conversion notice per process — deduped, but back
every boot. Until now the only things that ever rewrote such a row were a Studio
re-save and `duplicatePackage`.

**`os migrate meta --stored`** is the pass that ends it for a deployment that
runs it. It walks `sys_metadata` — `active` and `draft`, every organization —
replays the same `applyConversionsToStoredItem` chain, and re-saves each changed
body through the normal write path, so a rewritten row gets a
`sys_metadata_history` entry, a fresh checksum and the mutation projectors,
exactly like an author's save. The history row's `source` is `migrate-stored`,
so a later diff distinguishes an upgrade from somebody's edit.

```bash
os migrate meta --stored                    # preview: per-row report, writes nothing
os migrate meta --stored --apply            # rewrite the rows (prompts)
os migrate meta --stored --apply --yes --json   # CI / scripts
os migrate meta --stored --type view        # restrict to a type (repeatable)
```

**Preview is the default and `--apply` is the only writing mode** — the house
rule its siblings already keep (#3617's "a dry run changes nothing"), and it
applies with more force here because what moves is metadata: every affected
row's checksum and a history entry per row. An apply run also refuses to start
while another process holds the SQLite database, for the same reason
`os migrate files-to-references --apply` does.

**Nothing gates on this having run.** #3855's conclusion stands — an
operator-run migration cannot be relied upon, so the read path remains the
guarantee for every deployment, and no `sys_migration` flag is recorded (a flag
would advertise enforcement that does not exist). What a run buys is hygiene —
rows stop carrying pre-protocol dialects, so diffs, exports and history are
clean going forward, and the recurring notices go quiet — plus one thing that
was previously unobtainable: **an operator can assert it.** A run with nothing
left to do exits `0`, a deployment with rows still on an old dialect exits `1`,
so "my metadata is on protocol N" becomes a CI check rather than a belief.

Three things the pass declines, and reports rather than counting as done:
`flow` rows (their seam is `AutomationEngine.registerFlow`, which holds the
executor registry the node-type conflict guard needs), types with no repository
write path (`agent` — rewriting there would record no history and force a draft
live), and rows that still fail the current schema after conversion (a genuine
contract violation the write path is right to refuse; it keeps reading through
the chain and stays fixable in Studio).

Also new, and usable without the CLI: `protocol.migrateStoredMetadata()` returns
the same structured report an admin route would render, and `saveMetaItem`
accepts an optional `source` for the history/audit rows. `source` is not
request-derived — the REST layer builds its save request field by field and
never forwards a client-supplied value, so provenance stays something the server
states rather than something a caller claims.
