---
'@objectstack/cli': patch
---

`serve`: the multi-org runtime's stage-1 refusal no longer prints its own install remedy for a `declared-unresolvable` failure — it defers to the importer's message, which the same refusal already prints as its `cause:` line.

Driven on both shapes that kind covers, the minted bullet ("Repair the INSTALL … run `pnpm install`, check that a production prune did not drop it, and that its dist is actually built") was wrong twice over. For a genuinely broken install it repeated, word for word, the three remedies the cause line four lines below already carried. For a location install the finder cannot tie to the declaration, the cause says outright that re-running `pnpm install`, un-pruning a deploy and rebuilding a dist all change nothing — so one screen contradicted itself.

The arm now says only what it uniquely knows (the app DOES declare the package, so re-reading `package.json` will not help) and names the cause as the authority on the remedy — the same deferral the `declared-no-loadable-entry` arm has had since it landed.
