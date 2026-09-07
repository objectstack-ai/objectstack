---
"@objectstack/cli": patch
---

`os serve` now says so when the SQLite file it is serving is no longer the file at its configured path.

Deleting the data directory under a running server — `rm -rf .objectstack/data`, which is what a `demo:reset` script does and what a fresh-database repro starts with — unlinks the inode without touching the process. SQLite keeps reading and writing the now-invisible file, health keeps answering `200`, and a later boot creates a brand-new database at the same path. From that moment every filesystem inspection of that path describes a *different* database than the running server answers from, and nothing anywhere says so: a row edited there has no observable effect on the live server, and a user who authenticates against the live server is not in that file. Both readings are true, both look like a broken write path, and one investigation that reported them as evidence cost a full P0 cycle.

A boot that serves an on-disk SQLite file now records that file's identity once the boot is complete and re-checks it on a 30-second interval. When the file is gone, or the path holds a different file, it reports **once** at `error` — naming the path, the consequence (every external observation of this deployment is now false, and it will keep looking healthy) and the fix (restart the server so it opens the file that is at that path now).

It refuses nothing and retries nothing: the running server is still correct, merely invisible, and breaking a working dev loop to fix a reporting gap would trade a bad hour for a worse one. Nothing is added to any payload, endpoint or state file. Silence from the check is not a claim that the file is intact — every uncertainty in it resolves toward staying quiet, because a false report would send an operator to restart a server whose database is fine.
