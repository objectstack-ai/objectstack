---
'@objectstack/cloud-connection': minor
---

fix(cloud-connection)!: the marketplace `reseed-sample-data` door converts the installed package body forward once, as the install and the rehydrate do, so it reloads the translations those two doors load

Clause-②: no (narrowing)

<!-- adr-0087: already-registered translation-per-app-settings-removed, translation-validation-messages-removed, translation-component-submit-label-removed, translation-widget-sub-caption-removed -->

**BREAKING** (a served-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

`POST /api/v1/marketplace/install-local/:manifestId/reseed-sample-data` handed its side effects (the translations it reloads into the i18n service, and the seed datasets it runs) the package body exactly as the install ledger stores it. The install and the boot rehydrate hand the same side effects that body converted forward, through the ADR-0087 window the body's own `engines.protocol` opens (`ObjectQL.convertPackageBodyForward`). So for a package built before a translation retirement, a reseed reloaded a retired translation shape that the other two doors strip. The reseed now converts the body once, through the same entry point, after the protocol handshake has judged the entry as stored.

- **Served less now:** for a package whose body declares a range this runtime admits, from a floor that predates a retirement, a reseed no longer reloads the translation shapes the conversions named above remove. For example, a pre-17.4 per-app `settings` group is no longer loaded into the i18n service on reseed. After a reseed the i18n service holds what it holds after the install or a restart.
- **Refused now:** a stored body the converter throws on is no longer reloaded. The reseed raises the converter's error, as the install does, and loads nothing. Before, it reloaded the raw body. The protocol handshake that runs first throws on the same malformed range at every door, so this arises only for a body whose range reads differently to the handshake and to the converter.
- **Unchanged:** a body that declares no range is handed back as stored, so it reloads exactly as before. The handshake still runs first: a range that excludes this runtime is still answered `422 OS_PROTOCOL_INCOMPATIBLE`, before anything is converted or loaded. No conversion touches seed `data`, so a reseed seeds the same rows and answers the same counts. The ledger keeps the body as installed.

What changes for you: nothing to rewrite. For such a package the install and every restart already log the conversion warning, once per conversion per process, and it names the remedy: rebuild the package with `os build` and republish it.
