---
'@object-ui/console': patch
'@object-ui/plugin-kanban': patch
'@object-ui/plugin-form': patch
---

fix(ui): the console form page Edit, the kanban drop prompt and the Edit wizard judge a field's `requiredWhen` as the engine does, a transition gate against the stored record

Clause-②: no
Metadata-protocol: none

- **`@object-ui/console` form page (`/forms/:name?recordId=`):** an Edit no longer refuses a record that already sits inside a `requiredWhen` gate without the value (for example a contract activated before its signed-copy rule existed). The field shows no required marker there, and an unrelated edit saves, as REST `PATCH` already accepts. Still refused: the edit that moves a record into the gate without the value, and clearing the value of a record that held it. A create form enforces as before.
- **`@object-ui/plugin-kanban` drop prompt:** dropping a card no longer asks for a field the engine lets rest. A record already inside the gate without the value moves between columns with no dialog; a drop that moves a compliant record into the gate still asks for the value first.
- **`@object-ui/plugin-form` Edit wizard:** the final submit's cross-step check no longer refuses a record that already sits inside a `requiredWhen` gate without the value; it asks `requiredWhenRestsOnStoredRecord` about the record as first read. The record reaches only that stored-record check, so a `visibleWhen` reading `previous` is still unevaluable at that check, as before. Moving a compliant record into the gate is still refused, and a Create wizard enforces as before.

All three read the stored-record verdict `resolveFieldRuleState` already returns (`requiredWhenAtRest`, or its exported check `requiredWhenRestsOnStoredRecord`); no second rule.
