---
'@objectstack/skills': patch
---

docs(skills): the automation skill says what two packages shipping one flow function name now get, since function names are held per namespace

Clause-②: no
Metadata-protocol: none

Since engine `function` joined `NAMESPACE_SCOPED_BARE_NAME_TYPES` (ADR-0150 D2/D9), two packages declaring two different `namespace`s may each bind a function of one name, each flow's `script` node running its own package's, and the cold boot no longer warns for that pair. `objectstack-automation` still said every two-package pair makes the boot warn `Bare-name conflict at boot`. Item 3 of "Valid-but-silently-wrong" now says: packages of two namespaces each run their own; within one namespace, or where a package declares none, the later bind is refused at install, and a boot holding such a pair warns `Bare-name conflict at boot`. The guard refusal for a flow whose package holds none (two holders in reach, or one only outside its `dependencies` closure: `RESOURCE_CONFLICT`) is unchanged. No schema, accept set or behaviour changes.
