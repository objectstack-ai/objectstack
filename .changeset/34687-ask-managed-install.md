---
'@objectstack/scenarios': patch
---

fix(scenarios): ask mode installs a build the unmanaged door refuses `UNMANAGED_INSTALL_UNCOPYABLE` managed instead, and records the install mode

Clause-②: yes (widening) — reachable from `./runner` (`src/runner/index.ts` re-exports `app.ts` and `orchestrate.ts`): the new optional method `AppHarness.installManaged` and `HttpApp.installManaged`; the new optional parameter `mode` of `installableManifest`; the new exports `fallsBackToManaged`, `InstalledBuild` and `InstallAnswer`; `ModeRun.template` typed `InstalledBuild`, which adds the optional fields `installMode` and `unmanagedRefusal`
Metadata-protocol: none

Ask mode installed a verified build only unmanaged. The platform refuses an unmanaged copy of a build that carries an item no environment row can hold — a `capability`, which the metadata-type registry declares runtime-uncreatable — with `422 UNMANAGED_INSTALL_UNCOPYABLE`, and names the managed install. Builds of cards that gate actions on capabilities therefore installed nothing, and the ask round ran zero question turns.

Ask mode edits nothing, so on that refusal it now installs the same build, unchanged, through the same door with `installMode: 'managed'` (no `installModes` added: the door reads the build's own), and every fresh copy the Run half boots is installed the same way. The mode record's `template` names the install the mode ran on: `installMode` (`unmanaged` or `managed`), and, after a fallback, `unmanagedRefusal` with the refusal's status, code and message; the fallback is also listed as an ask finding. An unmanaged install that succeeds now records `installMode: 'unmanaged'`. No other refusal falls back, a managed install refused too is a finding naming both answers, and template mode never falls back: its agent edits the installed copy, which only an unmanaged install makes the environment's own.
