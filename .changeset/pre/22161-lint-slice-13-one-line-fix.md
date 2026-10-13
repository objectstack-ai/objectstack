---
"@objectstack/lint": patch
---

fix(lint): 18 more author-time rule ids print a `fix:` line of one remedy sentence, and `os explain RULE_ID` carries what those lines used to explain

Clause-②: no

- **Shorter fix lines.** Each finding of these 18 rule ids now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters on every variant the lint suite fires (the lengths here are the `hint` alone; the CLI prints it after `fix: `). The longest of each, before → after:
  - flow credentials: `flow-credential-literal` (646 → 177);
  - flow writes: `flow-update-readonly-when-field` (549 → 174) and `flow-update-readonly-field` (400 → 143);
  - list-view bulk wiring: `action-dispatch-contract-mismatch` (514 → 157);
  - security posture: `security-controlled-by-parent-ambiguous-relation` (496 → 174), `security-master-detail-ungranted` (314 → 153), `security-controlled-by-parent-no-relation` (294 → 194), `security-fls-unknown-field` (293 → 132) and `security-wildcard-vama` (218 → 103);
  - sharing rules: `sharing-rule-object-not-shareable` (482 → 144) and `sharing-rule-object-controlled-by-parent` (395 → 169);
  - interface pages: `page/visualization-without-binding` (480 → 183);
  - action bodies: `action-api-update-readonly-when-field` (470 → 188);
  - flow triggers: `flow-api-trigger-secret-missing` (461 → 171), `flow-time-relative-descriptor-unroutable` (441 → 166), `flow-trigger-unroutable` (295 → 163), `flow-trigger-unknown-event` (268 → 101) and `flow-trigger-unknown-object` (210 → 156).
- **One line, one remedy.** Where a fix line explained its remedy, the explanation moved: why `runAs: 'system'` is the channel for a static readonly field and why a `beforeInsert` stamp survives the strip; why a hook-derived value lands on a `readonlyWhen`-locked record, the drop-the-field alternative and that the warning never blocks a build; how to pick between the two bulk contracts; the controlled-by-parent tier precedence and what each sharing baseline means; how to tell which half of a sharing rule on a public object is wrong; why `sourceView` is an interface page's one binding channel; the descriptor's optional keys and the schedule's default; the api trigger's signature format; the connector's `provider`, the Basic auth variant, where `credentialRef` resolves and that a `{variable}` template draws nothing.
- **A list becomes a nearest name.** `security-fls-unknown-field` no longer lists up to twelve of the object's fields; it names the nearest declared or registry-injected column when one is close (`'crm_account.description' is the nearest`), and none otherwise. `page/visualization-without-binding` names the field TYPE the derivation looks for and no longer repeats the name pattern it also tries.
- **`os explain RULE_ID` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain RULE_ID` prints. Two ids had no entry and gain one, so their `rule:` line now ends with the `os explain` pointer: `security-wildcard-vama` ("why the '*' entry cannot carry View All / Modify All") and `flow-trigger-unknown-object` ("why an unknown trigger object only warns"). The other 16 entries gain paragraphs. The auth variants and the descriptor keys the lines and entries spell out are held to the spec's `ConnectorInstanceAuthSchema` and `TimeRelativeTriggerSchema` by the rules' tests.
- **At the runtime publish gate** (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), 13 of the 18 fire; the `hint` FROM → TO, measured at the door:
  - a `flow` write: `flow-credential-literal` (2xx `advisories[].hint`, header / query / connector input 646 / 528 / 488 → 173 / 177 / 141), `flow-update-readonly-field` (422 `issues[].hint`, update / create 239 / 396 → 116 / 139), `flow-update-readonly-when-field` (2xx advisory, 527 → 161, under `runAs: 'user'` and `'system'` alike), `flow-trigger-unknown-object` (2xx advisory, record / time-relative 210 / 179 → 156 / 125), `flow-trigger-unknown-event` (422, token / array 191 / 268 → 101 / 96), `flow-time-relative-descriptor-unroutable` (422, 441 → 166), `flow-trigger-unroutable` (422, 295 → 163) and `flow-api-trigger-secret-missing` (422, 461 → 171);
  - an `object` write: `security-controlled-by-parent-no-relation` (422, 294 → 194), `security-controlled-by-parent-ambiguous-relation` (422, 496 → 167) and `security-master-detail-ungranted` (2xx advisory, 304 → 147);
  - a `permission` write: `security-fls-unknown-field` (422, 324 → 132), `security-wildcard-vama` (422, 218 → 103) and `security-master-detail-ungranted` (2xx advisory, 304 → 147).

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the credential, readonlyWhen, unknown-object and ungranted-detail toasts shorten, and Studio's draft-changes panel shows the `hint` in place of the message for the two controlled-by-parent errors its in-browser security check finds on object drafts. No Studio, REST or MCP reader in this repository or in objectui matches on `hint` text; a tool that did should match on `rule` and `path` instead.
- **Never at the runtime gate:** `action-dispatch-contract-mismatch`, `page/visualization-without-binding`, `action-api-update-readonly-when-field` and the two `sharing-rule-object-*` ids run on the CLI only.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
