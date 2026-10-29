---
'@objectstack/skills': patch
---

docs(skills): objectstack-formula gains an eval for a mail amount shown in each record's own currency (`currency:@path`)

Clause-②: no
Metadata-protocol: none

- **Before.** The skill taught `{{ amount | currency:@currency_code }}` for a mail template that shows each record's amount in that record's own currency, but no eval checked that an AI author reaches for it. An author could write a bare path after the colon (refused at authoring), hard-code one currency code for every record, or leave the argument out (the organization's default currency for every record), and nothing scored that wrong.
- **Now.** Case 8 of `evals/cel-predicates-formulas.json` asks for an `email_template` that mails one overdue notice per contract with the amount in that contract's own currency. Its reference answer names the marked form, that only a mail template may read the code from the send's data, that the stored code is three capitals exactly as stored, and that a declared `variables` list must name the path or a root above it; the assertions require `currency:@` and refuse the bare path, a hard-coded code and the no-argument form. Six reference answers of existing cases are shortened where they restated a point they already make, with every assertion and fact kept, to pay for the case inside the file's token ceiling.
- No schema, key or behaviour changes.
