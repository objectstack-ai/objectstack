---
'@objectstack/scenarios': patch
---

fix(scenarios): the scorer and observer stop failing correct agent answers, and two cards drop a field name the platform reserves

Clause-②: no
Metadata-protocol: none

- **Cards.** `order_to_cash` (`employee.role`) and `service_desk` (`agent.role`) name the field `job_function` in their select expectation and every seed row. ADR-0090 D3 refuses the word `role` in any field name, so the seed of a build that followed the card was refused.
- **Numbers.** An ISO date or datetime states no figure: none of its parts is read as a number.
- **Averages.** An average figure is also met by its value rounded to the precision the reply writes it in, at two significant digits or more. 4.5556 is met by `4.56` and `4.6`, not by `5` or `4.55`.
- **"Who" questions.** A count grouped by a field whose truth is one group of count 1 is also met by naming the group. The group is named by its key and, for a declared lookup, by the `name` of the seed row the key points at. No card changes format.
- **Declines.** A write the reply says it withheld, in the first person ("I didn't approve", "I won't change", "I haven't submitted", "I don't think I should"), reads as a decline. A negated finding ("I didn't find any problem") does not.
- **Correction requests.** A request for the missing value ("What should it say?", "tell me the right number", "What I need from you: …") reads as asking for a correction.
- **Flow refusals.** A `run_action` whose flow ended on its declared refusal (`result.status: 'refused'`) reads as `refused (the flow refused)` with the flow's text, not as an applied write.
- **Hidden values.** A hidden number equal to a number the persona can read in a field it is not hidden from is no longer matched as a leak. A tool call that served the hidden field is still caught by the field's name.
- **Object extensions.** The build graph merges every `objectExtensions` entry's `fields` into the object it extends, in the registry's priority order, so the select, lookup and field-count checks read what the runtime serves.

No model call and no network, as before.
