---
'@objectstack/cli': patch
---

`os create plugin <name>` now derives the exported plugin symbol as a JavaScript identifier rather than copying the project name into an identifier position.

`validateProjectName` accepts exactly what npm accepts — a dot, an underscore and a leading digit included — so `os create plugin foo.bar` used to exit 0 having written `export const foo.barPlugin: Plugin = {`, a property access where a binding name belongs. The scaffolded project did not parse.

What the command accepts is unchanged, and so is what it emits as a name: the package name, its scope and the project directory stay byte-for-byte what was typed. Only the code identifier is normalised — every run of characters that is legal in an npm name but illegal in a JavaScript identifier now folds the way `-` already did, and a leading digit takes an `a` prefix. Ordinary names are unaffected (`my-app` still exports `myAppPlugin`). The emitted README names the derived symbol in prose, so the mapping is stated where it is read.
