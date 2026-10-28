---
'@object-ui/console': patch
---

feat(console): a shared record shows its authored field labels, picklist labels and currency

Clause-②: no
Metadata-protocol: none

- **Before.** The share-link page `/s/:token` labelled each row of a non-chat record with the field key humanized ("Annual Revenue") and formatted each value by its JSON shape only, so a picklist showed its stored code and a currency amount showed a plain number.
- **Now.** The page reads the resolve answer's `fields` projection. Each row carries the field's authored label. A picklist value shows its authored option label and colour, one badge per value for a multi-select. A currency amount is formatted in the currency the field declares (`currencyConfig`), through the same resolution the record detail view uses; a field with no fixed currency and no tenant default still shows a plain amount.
- **Lookups.** A lookup row shows its authored label and the stored record id. The page never reads the referenced record: an anonymous visitor cannot, so the target's name is not shown.
- **Unchanged.** A key the projection does not describe, and an answer from a server that does not send `fields`, keep the humanized label and the JSON-shape value. Redacted fields stay absent. The page makes no request beyond the resolve call.
