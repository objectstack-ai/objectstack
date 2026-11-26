---
'@objectstack/cli': patch
---

fix(cli): `os skills install` and `os skills update` stage the new catalog and swap it in by rename, so a write that fails partway leaves the previous skills and their record as they were

Clause-②: no
Metadata-protocol: none

Before, a write removed the recorded skill directories first, then wrote the new ones, and wrote the record last: a failure partway (disk full, permission, a locked file) left the directories gone or half-written under the old record, and the next `os skills update` refused them as changed locally until it was given `--force`. Now every new skill directory is written into a hidden staging directory inside the skills directory, each touched skill is renamed aside and its staged copy renamed into place, and the record is renamed over the old one last; any failure undoes the renames already done and is reported, so the catalog is either wholly the old one or wholly the new one, and a plain `os skills update` simply runs again. A staging directory a killed run leaves behind (`.objectstack-skills-staging-*`) is hidden, never read as a skill, and removed by the next write.
