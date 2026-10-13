---
"@objectstack/lint": patch
---

fix(lint): 16 more author-time rule ids print a `fix:` line of one remedy sentence, and `os explain <rule-id>` carries what those lines used to enumerate

Clause-②: no

- **Shorter fix lines.** Each finding of these 16 rule ids now carries a `hint` (the CLI's `fix:` line, the runtime issue's `hint`) of one remedy sentence of at most 200 characters on every variant the lint suite fires (the lengths here are the `hint` alone; the CLI prints it after `fix: `). The longest of each, before → after:
  - validation rules: `validation-rule-json-schema-unknown-format` (646 → 183);
  - datasets and cubes: `measure-aggregate-field-type-refused` (645 → 178) and `dimension-json-stored-field-refused` (262 → 177);
  - form predicates: `predicate-rhs-path-shaped` (643 → 184), `predicate-path-unrooted` (214 → 122) and `predicate-path-unresolved` (201 → 153);
  - RLS predicates: `rls-predicate-unknown-user-variable` (618 → 193) and `rls-predicate-unparseable` (523 → 171);
  - hook bodies: `hook-api-update-readonly-when-field` (607 → 173);
  - action names: `action-name-undefined` (560 → 195);
  - AI skills: `ai-skill-tool-unresolved` (548 → 189);
  - organization axis: `org-axis-permission-inheritance` (542 → 145) and `org-axis-cross-org-bu-grant` (315 → 141);
  - object names: `object-reference-unknown` (522 → 134) and `object-reference-unregistered-platform` (500 → 187);
  - filters: `filter-empty-node` (515 → 113).
- **Lists are no longer echoed.** `object-reference-unknown` no longer lists every object the stack and its artifact define, and `action-name-undefined` no longer lists every action of the stack or of the related object: the verdict's "Did you mean" already names the nearest one. `validation-rule-json-schema-unknown-format` names the nearest registered format and no longer lists all of them, and `ai-skill-tool-unresolved` no longer lists the tool family prefixes. `rls-predicate-unknown-user-variable` names the kernel keys and the nearest one, and so holds no author text.
- **One line, one remedy.** Where a fix line explained its remedy, the explanation moved: why a missing object costs what it costs at each site (the record picker, the view container's index, the dashboard filter, the dataset's reports, the nav entry), the doors that refuse a refused aggregate pair later (a dataset's compile, a cube's query), how an app stages an RLS membership set, why no system context waives a `readonlyWhen` lock, and the declared "match nothing" filter spelling. Where the namespace-prefixed object exists, a view container's fix line is that spelling alone (`write "my_app_order_line", not "order_line"`).
- **`os explain <rule-id>` carries the rest.** What the fix lines stopped saying is each id's `RULE_EXPLANATIONS` entry in `@objectstack/lint`, which `os explain <rule-id>` prints. Two ids had no entry and gain one, so their `rule:` line now ends with the `os explain` pointer: `object-reference-unknown` ("how an object name resolves, and what a miss costs") and `org-axis-permission-inheritance` ("why access never walks the organization tree"). The other 14 entries gain paragraphs. The registered format names and the tool family prefixes are written out in their entries and held to the live sets by the rules' tests.
- **Where the new fix lines print.** On the CLI: the `fix:` line under each finding of `os validate`, `os build` (and `os compile`, which `os dev` runs at startup and, under `--verbose`, on each watch recompile), the scaffold check `os init` runs, and `os verify`'s refusal list; `os lint` prints it as `→ fix:` under `--fix` and as `fix` in `--json`; `os validate --json` (`errors`) and `os build --json` (author-time `issues`) carry it on an error-severity finding; their `warnings` carry an advisory as one `where: message` string, without it. At the runtime publish gate (Studio, REST `PUT /api/v1/meta`, and the MCP and AI authors that write through that door), the `hint` FROM → TO, measured at the door:
  - an `object` write: `validation-rule-json-schema-unknown-format` (422 `issues[].hint`, 638 / 606 → 175 / 143, with and without a nearest name);
  - a `dataset` write: `measure-aggregate-field-type-refused` (422, 606 / 581 → 147 / 122), `dimension-json-stored-field-refused` (422, multi-value 259 → 166, structured JSON 177 unchanged), `object-reference-unknown` (422 on the dataset's `object`, 331 → 134) and `object-reference-unregistered-platform` (2xx `advisories[].hint` and the `[Protocol] authoring advisory` log line, 449 → 187);
  - a `view` write of a schema-bound metadata form: `predicate-rhs-path-shaped` (422 on a dotted right-hand side, 384 → 156; 2xx advisory on a bare word, 631 → 180), `predicate-path-unrooted` (422, 214 → 122) and `predicate-path-unresolved` (422, 100 → 36 with a nearest key);
  - a `permission` write: `rls-predicate-unparseable` (422, 523 → 171) and `rls-predicate-unknown-user-variable` (422, 566 / 634 → 158 / 190, without and with a nearest key);
  - a `flow` or `report` write: `filter-empty-node` (422, 515 / 278 / 170 → 113 / 107 / 69 for the whole filter, a `$or` branch and a `$and` branch).

  Studio's save-advisory toast prints an advisory's `hint` after its message, so the platform-object and bare-word toasts shorten; no Studio, REST or MCP reader in this repository or in objectui matches on `hint` text. A tool that did should match on `rule` and `path` instead.
- **Never at the runtime gate:** `hook-api-update-readonly-when-field`, `action-name-undefined`, `ai-skill-tool-unresolved` and the two `org-axis-*` ids run on the CLI only, as do the object-reference ids on every site but a dataset's `object`.
- **Unchanged:** every `message` (the verdict), rule id, severity and `path`, and what each rule accepts or refuses.
