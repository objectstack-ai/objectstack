---
'@objectstack/cli': patch
---

fix(cli): `os package install` prints the connector maps the package export withheld (#29873)

Clause-②: no
Metadata-protocol: none

An exported package names each connector header or environment map the export withheld whole in its `withheldMaps`, and both install modes of the runtime's install-local endpoint name each map in their answer. The command dropped that list, so an operator who installed an export the documented way (`os package install DIR/NN-ID/objectstack.json`) was never told that the connector sends none of those headers or environment variables.

The command now prints one warning, one line per map (`connector 'NAME' PATH`, for example `connector 'erp' providerConfig.headers`), and the remedy: re-enter each map where the connector is authored. It does this for a managed install (hot-loaded or not) and for an unmanaged one, from a catalog id or an artifact file. An answer without the list prints nothing new, and the exit code is unchanged. The command has no `--json` output.
