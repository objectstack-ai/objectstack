---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): an install-local re-install whose installed copy the resolver refuses names that copy, not the incoming package

Clause-②: no
Metadata-protocol: none

On a re-install, `POST /api/v1/marketplace/install-local` reads the copy its last install stored, to compare the incoming version with it. When this runtime's artifact resolver refuses that stored copy (for example, a package entry that still carries a retired spelling), the answer used to be "Package 'X' cannot be installed: …", which reads as a fault in the incoming package. It now says that the installed copy is refused, that the incoming version was not judged, and what to do: uninstall the package to remove the stored copy, then install this version.

The status and code are unchanged: the resolver's own (for example `422 INVALID_ARTIFACT_PACKAGE_ENTRY`), with its `details` when it states any, and nothing is installed or written. A refusal of the incoming package keeps its "Package 'X' cannot be installed" sentence, and when both copies are refused the incoming package's refusal is the answer.
