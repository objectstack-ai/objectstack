---
'@object-ui/app-shell': patch
'@object-ui/react': patch
---

fix(app-shell): a nav action item reads its action from its app's package, so two packages that share an action name each open their own

Clause-②: no
Metadata-protocol: none

- **`@object-ui/app-shell`:** a `type: 'action'` entry in an app's navigation read its action by the bare name. The server now refuses a bare read of an action name that two enabled packages hold (`409 RESOURCE_CONFLICT`), so in both packages' apps the entry showed "Action … is not defined." and ran nothing. The sidebar and the `nav:menu` block now pass the app's package to `useNavActionDispatch(packageId)`, which reads the action at `?package=` (ADR-0150 D5): each app opens the action its own package holds. An app with no package (one authored in the environment) keeps the bare read. An entry whose action only another package holds is now refused by that read, naming the holders, as ADR-0150 row U records; the lint rule `action-name-undefined` already reports such an entry when the stack is authored.
- **`@object-ui/react`:** `MetadataContextValue.getItem(type, name, options?)` takes an optional `MetadataItemReadOptions` (`{ packageId }`), exported beside it. With `packageId` the console's `MetadataProvider` reads `?package=` and does not cache the answer, since its by-name cache holds the bare read's answer. A context value whose `getItem` takes two arguments still type-checks.
