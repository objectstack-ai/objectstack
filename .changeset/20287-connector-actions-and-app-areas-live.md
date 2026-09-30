---
"@objectstack/spec": patch
---

Liveness ledger: `connector.actions.description`, `connector.actions.outputSchema` and `app.areas.description` are now `live`, not `dead`. Studio reads each of them at the `.objectui-sha` pin, and each row cites that reader and its producer. Ledger data, two README Notes cells and the regenerated count shards only. ⛔ No schema, parse, `.describe()` or accept-set change.

The ledgers ship inside this package (`files[]` includes `liveness`), and `@objectstack/lint` reads them to decide which authored keys draw an advisory warning. None of the three rows sets `authorWarn`, so the set of warnings does not change.

- `connector.actions.description`: the flow designer's Action picker on a `connector_action` node shows each action's description beside its label.
- `connector.actions.outputSchema`: the flow designer offers a `connector_action` node's downstream references from the top-level `properties` of its action's `outputSchema`.
- `app.areas.description`: the Studio app preview lists each area, with its description beneath it when one is authored.
- Both connector rows are fed from the plugin and provider door, as their sibling `actions.*` rows are: the `actions` an author writes on a metadata connector entry never reach the registry the designer reads.
- The regenerated count shards: `connector` has 31 live and 23 dead (was 29 and 25), and `app` has 50 live and 8 dead (was 49 and 9).
