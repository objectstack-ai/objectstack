---
'@objectstack/scenarios': patch
---

fix(scenarios): the `travel_expense` figure questions write the measure's own word, so a governed answer is no longer asked back

Clause-②: no
Metadata-protocol: none

Three figure questions of the `travel_expense` card (`paid_reimbursement`, `claims_by_status`, `claimed_last_month`) lifted the word "claims". That word matches no member of the card's datasets. It is a near miss on two `reimbursement` measures, Claimed amount (synonym "expense claims") and Claim count (synonym "number of claims"), so `list_datasets` offers both as candidates and an agent following ADR-0149 D3 asks back instead of answering. This is a card defect: the door behaves as ruled. Each ask now writes a word that matches exactly the measure its truth computes, in English and Chinese: "claimed amount" / 报销金额, "number of claims" / 报销单数, and "expense claims" / 报销金额. The truths, datasets and verified build are unchanged. The build provenance records the new card sha256, so ask-round records split at this card hash.
