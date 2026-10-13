---
"@objectstack/cli": patch
"@objectstack/lint": patch
"@objectstack/objectql": patch
---

fix(cli): the nine rule ids the CLI produces print one verdict sentence each, `os explain <rule-id>` carries their reasoning, and the undeclared-handlers boot line is one line

Clause-②: no

- **One verdict sentence of at most 200 characters.** Measured on every finding the CLI's suites fire (message length; before → after):
  - `os lint`'s hook-body rules: `hook-body/not-lowerable` 565–661 → 165–178, `hook-body/bundled-fallback` 324–947 → 109–171, `hook-body/unparseable` 469 → 157, `hook-body/extraction-failed` 331 → 140. Over every refusal the extractor can throw (14 forbidden constructs and 7 parameter refusals), `hook-body/bundled-fallback` runs 296–1,011 → 113–199: the verdict quotes the extractor's own verdict clause, cut to fit and marked `…` when cut.
  - package docs (`os build`, `os validate`, `os lint`): `docs/uncollected-directory` 433–558 → 124–183, `docs/nav-target` 263–299 → 147–184, `docs/frontmatter-tags` 233–285 → 135–195, `docs/duplicate-name` 330 → 167 (its within-package arm is unchanged at 101). A doc finding no longer repeats its path, which every printer already leads with; lists of files, packages and directories name the first three and count the rest.
  - `picklist-reference-unverified` (the `os validate` / `os build` notice): 240–245 → 173–175, naming at most two outside dependencies and counting the rest.
- **A `fix:` line for the hook-body rules.** Their remedy moves out of the message into the finding's `fix`, at most 200 characters: `os lint` prints it as `→ fix:` under `--fix`, and `os lint --json` now carries `fix` on these four ids' issues. The remedy is still chosen per case: inline a module-scope name, or keep a check on a host-only global such as `Intl` in a string handler ref or a validation rule. A doc finding carries no separate fix, so its sentence ends with the remedy; the picklist notice's `hint` is unchanged.
- **`os explain <rule-id>` carries the rest.** Each of the nine ids gains a `RULE_EXPLANATIONS` entry in `@objectstack/lint`, the one table `os explain` reads, and `os lint`'s `rule:` line now points at it. They hold what the messages stopped saying: why a bundled handler is a change of deployment shape and how to bundle on purpose, what the sandbox cannot run and where `os build` prints the full refusal, why an instrument limit is not a verdict, where package docs are read from and why the collector never guesses, why a doc name may appear once, what a doc navigation item can open, how doc tags are read, and why a reference into a dependency outside the stack is not judged.
- **The `[action-governance]` boot line for registered handlers with no declaration** (`os dev`, `os serve`, and any host that boots ObjectQL) is one line of 192 characters, where it was 628: it names the three sources it read, states the 404 as expected rather than measured, and says to declare each with `defineAction`. Its structured `count` / `handlers` tail is unchanged, and the dead-button line beside it is unchanged.
- **Unchanged:** every rule id, severity and `path`, the boot lines' level and payload, and what each check accepts or refuses. A tool that matched on this message text should match on `rule` and `path` instead.
