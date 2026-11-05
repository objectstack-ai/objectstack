---
'@objectstack/cloud-connection': patch
---

Clause-②: no
Metadata-protocol: none

The one-time copy of the working-directory install ledger into its `OS_HOME` location (#30217) now creates its staging directory with an exclusive `mkdirSync` of a randomly named sibling instead of `mkdtempSync`. Behaviour is unchanged: the copy still lands in a unique sibling of the ledger directory, is renamed into place, and is removed if the copy fails. This repairs the red `main` build (#30467), where the repository's in-tree scratch scan could not read the `mkdtempSync` base.
