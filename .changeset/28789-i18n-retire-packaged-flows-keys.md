---
'@object-ui/i18n': patch
---

refactor(i18n)!: the Packaged automation flows keys and Home's Manage Objects keys leave every pack

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-interface-only ui/packages/i18n/src/locales/en.ts#TranslationKeys) the key type of the console's own translation catalogue: no Zod schema, no spec declaration and no stored metadata reads it, so the compiler is the channel that reaches every caller -->

Setup's Packaged automation flows page and Home's Manage Objects entry are retired: packaged flows are switched on and off, and copied, in Studio's Automations pillar, and objects are managed in Studio. The strings those screens read stayed in `@object-ui/i18n` with no reader. They now leave all ten packs (ar, de, en, es, fr, ja, ko, pt, ru, zh).

**BREAKING** (`@object-ui/i18n`, TypeScript only): the exported `TranslationKeys` (`typeof en`) loses 28 keys. A `t()` call that names one still compiles, since its key is a `string`, and reads the key back. Nothing replaces them; the fix is to delete the reference.

| Removed key | Replacement |
|:---|:---|
| `packagedAutomation.title`, `.subtitle`, `.flowsHeading`, `.colFlow`, `.colActions`, `.toggleLabel`, `.notRunning`, `.notRunningDeploymentPolicy`, `.reasonDetails`, `.emptyTitle`, `.emptyBody`, `.loadFailed` | none: the flows list is retired; a packaged flow's switch lives in Studio |
| `packagedAutomation.clone`, `.cloneTitle`, `.cloneBody`, `.cloneName`, `.cloneLabel`, `.cloneCopyLabel`, `.cloneConfirm`, `.cloneCreated`, `.cloneSwitchSourceOff`, `.cloneSourceOff`, `.cloneOpen`, `.cloneFailed`, `.cloneFailedHttp` | none: the clone dialog is retired; Studio's New similar copies a flow |
| `home.quickActions.manageObjects`, `home.quickActions.manageObjectsDesc`, `layout.systemNav.objectManager` | none: Home's Manage Objects entry is retired |

The keys Setup's Packaged actions page reads (`packagedAutomation.actionsHeading`, `.refresh`, `.colActivation`, `.on`, `.off`, `.cancel`, `.toggleFailed`, `.toggleFailedHttp` and the `actions*` / `switched*` / `actionOff*` family) are unchanged.
