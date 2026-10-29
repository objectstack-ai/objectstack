---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a new Rollup field is held until it is set up, and its child-field picker offers only the fields the spec accepts for the chosen function

Clause-②: no
Metadata-protocol: none

- **Held, not autosaved.** Adding a field with Type = Rollup used to send the draft at once as `{ type: 'summary' }` with no `summaryOperations`, which the server saves as a roll-up that reads 0 everywhere. The Data pillar now holds a roll-up like a choice field before its options: it stays on screen and unsent, the held line names the field and the input it still needs (Child object, Aggregation, or Child field to aggregate when the function reads one), "Show me" reopens it, and Publish refuses while it is held. The judges are the spec's: the `field/summary-without-operations` completeness rule and `FieldSchema`. A roll-up the spec refuses for any other reason is sent, so its refusal shows as before.
- **Child field picker.** "Child field to aggregate" lists only the child fields `isAggregateCompatibleWithFieldType` accepts for the chosen function (Sum no longer offers text, audit, lookup or master-detail fields), and before a function is picked, a field some value-reading function accepts. The filter rows still offer every child field.

`@object-ui/i18n` gains `engine.studio.held.fieldNeedsInput` in the en and zh studio packs.
