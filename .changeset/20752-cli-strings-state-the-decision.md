---
'@objectstack/cli': patch
'@objectstack/types': patch
---

CLI help, warnings and refusals no longer cite tracker numbers; each one states the decision behind it in words

Clause-②: no

Several lines the CLI prints sent the reader to an issue-tracker number for the reason behind them. The number goes; where the sentence did not already say what was decided, it now does.

- `os build` / `os validate`: the provider preflight step now reads "Checking that every required capability has a provider installable in this edition...", and the undeclared-key header reads "Undeclared authoring keys (N) — dropped at load; reported here, never refused".
- `os doctor`: the retired `referenceFilters` row now says the key was removed from FieldSchema as a key no runtime read; the `NODE_ENV` and config-load rows drop their citations.
- `os serve`: the no-auth refusal says anonymous data access is always denied with no setting that turns that off; the organizations remedies drop their citations.
- `os meta resync`, `os db clean` and the `os migrate duplicates` / `multi-value-columns` / `recorded-by` / `summary-nulls` descriptions, the `os dev --restart` flag help, the `os storage orphans` closing line and the storage-driver refusals each say what was decided instead of citing it.
- `os serve`'s unknown-hostname 404 page spells its three short grey colours in six hex digits; they render the same.
- `@objectstack/types`: the host importer's undeclared-package message says the fallback resolves from the caller once `fallbackImport` is passed, and drops the citation beside "Being merely REACHABLE is not enough".

Text only: no exit code, error code, flag, field or control flow moves. A script that matches the old CLI text (for example the "Checking capability providers" step line) needs the new spelling.
