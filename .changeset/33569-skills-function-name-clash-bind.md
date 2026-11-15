---
'@objectstack/skills': patch
---

docs(skills): the automation skill says what a clashing flow function name really does: the later package installs, and none of its functions or hooks bind

Clause-②: no
Metadata-protocol: none

Item 3 of "Valid-but-silently-wrong" in `objectstack-automation` said a second package holding a function name of the same namespace (or of none) is "refused at install". No install door judges a function. The hook binder's bind refuses it (`claimBareNameFunctions`), the runtime binder logs `Failed to bind declarative hooks` at `error`, and the package installs anyway with every function and hook of that owner unbound, the names that do not clash included. The skill now says that, keeps the remedy (rename, or another namespace), and splits the two moments it used to merge: a pair both held at boot warns `Bare-name conflict at boot`; a holder bound after the boot is the one left unbound. This corrects the "refused at install" sentence of the `32522-skills-automation-function-name-per-namespace` entry. To stay within the file's token budget, two restatements are shortened: the flow door's `400 FLOW_FAILED` answer (taught in `objectstack-api`) and the `outputVariable` explanation (shown by the example under it). No schema, accept set or behaviour changes.
