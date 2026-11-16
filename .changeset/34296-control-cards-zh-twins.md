---
'@objectstack/scenarios': patch
---

feat(scenarios): the three control cards carry every text in Chinese, three unanswerable questions each with an answerable twin, and avg / max / min truths

Clause-②: no
Metadata-protocol: none

The open card library ships inside this package as data, so `npx @objectstack/scenarios run` now reads the new control cards. `--lang zh` runs all three: `prompt.short`, `prompt.detailed`, `iterate.change` and every question's and operation's `ask` carry a `zh` beside the `en`, written the way a customer asks rather than word for word. Before, the three controls were skipped under `--lang zh`.

Each control now asks three questions its seed cannot answer, each beside an answerable twin of the same shape over data the app holds, so a model that declines everything fails the twins: `crm_account_with_contacts` asks annual revenue, the average credit limit and the most open support tickets beside a headcount, the average headcount and the largest headcount; `invoice_with_line_items` asks a tax rate, a discount and the lowest shipping charge beside the largest line on INV-002, the total of Acme's invoices and the smallest invoice total; `project_with_tasks` asks a sponsor, an average hourly rate and the smallest budget beside the open tasks of the Website relaunch, the average task estimate of the Office move and the smallest project total estimate. Every card now has at least one `avg`, one `max` and one `min` truth, computed by the loader from the seed. `crm_account_with_contacts` seeds a new number field, `account.employees`, which its data contract states to the build, because the card had no number to aggregate.

Question counts move, so a scorecard from before this change does not compare with one after it: `crm_account_with_contacts` 8 → 14 questions (9 → 16 persona turns), `invoice_with_line_items` 9 → 14 (11 → 16), `project_with_tasks` 8 → 13 (9 → 15). Seeds, personas and operations are otherwise unchanged.
