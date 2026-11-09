---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(app-shell): a flow bound to an object its package may not use is explained on the Problems list in the Console's language

Clause-②: no
Metadata-protocol: none

When a package's flow triggers on, scans, or declares a start input of an object outside what the package may use (its own objects, the objects of the packages it declares as dependencies, and system objects), the publish refuses it, and the flow's Problems list showed the server's English sentence in packaging terms to a reader in any language. The Problems list now words that refusal from the served entry's rule id (`flow-trigger-unknown-object`, `flow-input-unknown-object`) and its path: it names the object the flow holds there, says which objects a package can use, and points at the two fixes, picking an object from the list or declaring a dependency on the package that defines it. The copy lives in the Studio string namespace in English and Chinese. Any other server entry, and any of these at a position the Console does not word, still shows the server's sentence as sent. The served shape does not change: the editor pages now keep each served error's `code` on the entries they hand the canvas, where it used to be dropped.
