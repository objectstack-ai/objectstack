---
"@objectstack/lint": minor
"@objectstack/cli": minor
---

feat(lint, cli): one-line author-time rule verdicts, and `os explain <rule-id>` for the reasoning

Clause-②: yes (widening)

- **Shorter warnings.** `field-no-consumers` and `security-owd-unset` now print one verdict sentence and one fix. `os validate`, `os build` and `os dev` used to print `field-no-consumers` as a single line of about 860 characters, and `os build` added a second paragraph of about 700; the warning now reads:

  ```text
  ⚠ object "my_app_ticket" · field "description": declared, but nothing in this stack displays or reads it (inert)
    fix: add it to a view column or a form section, or remove the declaration
    rule: field-no-consumers  at objects[1].fields.description — `os explain field-no-consumers` for what counts as a consumer
  ```

  The finding's `message` no longer restates its `where`, and no longer carries the list of consumer and carrier kinds, the exemptions or the scanned roots; `hint` is the fix alone (for a `carrier-only` verdict it still names each carrier site a removal must clean). The `verdict`, `carriers` and `rootsScanned` fields of a `field-no-consumers` finding are unchanged. A tool that matched the old message text should match on `rule`, `where` and `path` instead.
- **`os explain <rule-id>`.** `os explain` takes an author-time rule id as well as a schema name — `os explain field-no-consumers`, `os explain security-owd-unset` — and prints the reasoning the warning no longer carries; `--json` prints `{ rule, covers, paragraphs }`. A schema name resolves exactly as before. With no argument it also lists the rule ids that have an explanation (`--json` adds `rules: [{ id, covers }]`). The `rule:` line names the command only for those rule ids.
- **`os explain constructor` (or `__proto__`) is refused as an unknown id** instead of printing `Schema: Object … undefined` and crashing with `schema.required is not iterable`: both lookups read own keys only.
- **`os validate` prints the `fix:` and `rule:` lines** under each author-time warning, the way `os build` does, and the hint line under every author-time finding (`os build`, `os validate`, `os verify`, `os init`) is now labelled `fix:`. `os lint` adds the same `os explain` pointer to its rule line.
- **The `fix:` line is always a fix.** `expression-invalid` no longer puts the authored source in `hint`, where it printed as `fix: source: …`: the source now ends the finding's `message` as `` — source: `…` `` (the spelling the flow engine's runtime refusals use), so the CLI verdict line and the runtime publish gate's 422 issue `message` (Studio, REST `/meta`, MCP) both still carry it, and its `hint` is empty, so no `fix:` line prints. `component-props-invalid`, `flow-time-relative-descriptor-invalid`, `react-prop-missing-required` (where the component contract describes the binding) and `liveness-experimental-property` carried context in `hint`; each now leads with the instruction (the same text reaches the runtime publish gate's 422 issue `hint` for the three of them that run there: the time-relative, react-prop and liveness rules), and `component-props-invalid`'s message states its consequence (nothing refuses it today, so the renderer receives the props as written).
- **New exports in `@objectstack/lint`:** `RULE_EXPLANATIONS`, `explainRule(ruleId)` and the type `RuleExplanation`, from the root entry and from the import-free `@objectstack/lint/rule-explanations` entry.
