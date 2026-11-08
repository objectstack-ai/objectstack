---
'@object-ui/app-shell': patch
---

fix(app-shell): Installed Apps shows the engine's reason for an app whose register it refused at boot

Clause-②: no
Metadata-protocol: none

Since `@objectstack/cloud-connection` lists a ledgered install whose register the engine refuses at boot as `notLoaded: { code, message }`, the install-local marker is a closed union of two arms: the protocol arm `{ code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange }` and the register-refusal arm `{ code, message }`, where `message` is the engine's own sentence. The console typed the marker as the protocol arm only and never read `message`, so a register-refused app read "Not loaded" with its code and no reason. `LocalInstallNotLoaded` now mirrors the two arms, and one reader, `MarketplaceNotLoadedReason`, draws the reason on both the Setup → Packages row and the package page header. The protocol arm reads exactly as before. The register-refusal arm reads the existing "did not load this package (CODE)" sentence followed by the engine's sentence, so the operator can tell whether to uninstall the app or fix the package. The engine's sentence is drawn as text, never as markup. A marker with no sentence, or an empty one, reads with the code alone, as before. No language pack changes.
