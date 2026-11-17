# Design — MCP local-first door (build and 问数)

**Status**: design record of the maintainer's rulings on [#34659](https://github.com/objectstack-ai/objectstack/issues/34659), all of 2026-11-17: D1–D7 A, E1 A (enforce first), E3 phased and E4 A in record 6940528935; E2 A, re-ruled by F1 B on [#34691](https://github.com/objectstack-ai/objectstack/issues/34691) in record 6943126855 (knocked to #34659 as 6943149235); S1–S3 A on #34691 in record 6943116536; milestone 1 released in record 6944452341. This record restates those rulings and decides nothing new.
**Builds on**: ADR-0149 (governed datasets), ADR-0087 (conversion layer), cloud ADR-0112 (MCP build tiers), cloud ADR-0025 / ADR-0082 (open/closed line).
**Audience**: the seats that implement the milestones.
**Readings**: every count below was taken on objectstack `62d9d0d99` and cloud `53a5844`, unless a row says otherwise. Every objectstack file:line was re-read on `6091b645` and corrected where it moved; the cloud readings were not re-taken and stand as read on cloud `53a5844`.

## Direction (the maintainer's words, verbatim)

- 「远程 MCP 直接改环境，这个没问题，但是思考的过程查技能查协议都可以在本地啊」
- 「工具只需要提供元数据写入口」
- 「mcp问数呢，也可以用类似的方案优化吗」
- 「除了搭建以外，还需要考虑问数的方式能否使用对应的在本地安装技能包的方案提升质量」
- 「有没有有可能把元数据下载到本地模拟测试，运行测试通过之后再提」

## The one principle

Split what an AI client needs into three layers, and give each layer one home:

| Layer | What it is | Home | Why |
|:---|:---|:---|:---|
| Knowledge | Authoring rules, type contracts, the 问数 procedure, lint | A versioned local package (`@objectstack/skills`, `@objectstack/spec`, `@objectstack/lint`) | Static text. Serving it costs tokens on every connection and drifts from the published copy |
| Environment facts | Objects, fields, option labels, datasets and synonyms, the restriction profile, drafts | The server, as data | Only the environment knows them, and they change |
| Enforcement | Validation, permissions, quotas, destructive-change confirmation, publish | The server | A client cannot be trusted with them |

The open-source door and the cloud door differ in how rich the third layer is, not in where the first two live.

## Current state (verified)

None of the cards named below has merged; each row names the card that carries it.

### Open-source build

- The MCP server registers data, action, dataset and file tools. It registers no authoring tool: `packages/runtime/src/domains/mcp.ts:247-257` passes no `authoring` to `handleHttpRequest`, and no open package implements `McpAuthoringToolRegistry` (`packages/mcp/src/types.ts:97-102`). Carried by #34766.
- The seam is complete: `registerAuthoringTools` (`packages/mcp/src/mcp-server-runtime.ts:1695-1728`) registers whatever registry the host injects, behind `metadata:write`.
- **A draft save runs no authoring rule.** `AUTHORING_SURFACES = ['cli','runtime-publish']` (`packages/lint/src/authoring-rules.ts:186-205`); the gate returns no error when `state !== 'active'` (`packages/metadata-protocol/src/protocol-authoring-gate.ts:430-447`). A draft is checked by its type's Zod schema only. Of the 69 registry rules (68 on `62d9d0d99`), 40 run at publish and on the CLI, 29 on the CLI alone.
- A read-side preview of the publish verdict exists: `draftPublishVerdict` (`protocol-authoring-gate.ts:714`).
- **An MCP OAuth token is not accepted on REST.** `acceptOAuthAccessToken` is set for the `/mcp` path alone (`packages/runtime/src/http-dispatcher.ts:767`). REST takes a session or an API key. E4 A keeps it so.
- The Studio draft review (`ui/packages/app-shell/src/preview/`) imports open packages only.
- A code-first path already reaches a self-hosted runtime: `os environments use-runtime` then `os deploy`; `os meta register` saves an active item; `os package export` writes every installed package as an installable `objectstack.json`.
- Gaps in that path: `os meta register` has no draft mode; `os lint` takes a whole project, not one item (both #34777); no open runtime serves `GET /api/v1/discovery/restriction-profile`, which `os validate --target` already reads (#34774).
- Two runtime-dead shapes have no lint rule at all: a flow node `type` with no executor (the run fails with `NO_EXECUTOR`), and an approval node whose out-edges are not labelled `approve` / `reject`. Both are among #34776's six publish-time checks.

### Cloud build

Read on cloud `53a5844`; not re-read.

- The cloud door is the in-product builder's tool registry served through the same seam, with one context switch (`authoringDoor: 'mcp'`). It lists 19 of 29 build tools.
- Its rules are already a hybrid: about 100K characters of private text in 60 rules, plus about 25 sections read from the published `@objectstack/skills` at run time. Ruling A on cloud#3659 already states that a hosted build differs from a local one by a restriction profile only.
- Most of what the server does there is the third layer, not thinking: defaults (sharing model, namespace prefix, list view and navigation entry), refusals by tier, destructive-change confirmation, quotas, and `verify_build`'s probes against the real environment.

### 问数

- The server side is in place: `list_datasets({ terms })` reports exact matches on name, label and synonym; `query_dataset` answers with `provenance`.
- **The procedure has no reliable delivery channel.** The open server's `initialize` instructions are one sentence (`DEFAULT_HTTP_INSTRUCTIONS`, `mcp-server-runtime.ts:1772-1773`). The full text is the `GET /mcp/skill` page, which a person must fetch. A client that only ran `claude mcp add` has the tool descriptions and nothing else. Carried by #34686 (its first PR, #34790, is a draft).
- The scenario runner's ask persona is exactly that client: an empty directory, `--strict-mcp-config`, `--allowedTools mcp__app` (`packages/qa/scenarios/src/runner/driver.ts:468-483`). Every ask score recorded so far is a no-skill score. Carried by #34687.
- `skills/objectstack-query` teaches a developer to write ObjectQL in code. No published skill teaches a client to answer a question over a live environment. Carried by #34685.
- None of the 9 open scenario cards declares a dataset or a synonym. Carried by #34687.

## Corrections to the card

| The card says | Reading |
|:---|:---|
| The save door "stays authoritative and returns structured findings" | Not for a draft: only the schema parse runs. The draft tool must return the publish verdict itself (Design A; E3) |
| Not verified: an OAuth MCP token on REST `/meta` | Not accepted. The local loop needs an API key (E4 A) |
| Not verified: Studio draft review with no cloud packages | Verified: open imports only |

## Design A — the open-source draft door

Ruled: D2 A (drafts only), D3 A (OAuth `metadata:write` only), D4 A (a different major is refused with the install line, a different minor is advised), E3 (the save answers with the publish verdict). Cards: #34766 the door, #34774 the contract version and the restriction-profile route, #34776 the publish-time checks, #34777 the CLI, #34778 the thin build skill.

Tools, registered by a new open registry behind `metadata:write`, each checking the caller's own `manage_metadata`:

| Tool | Does | Notes |
|:---|:---|:---|
| `list_metadata({ type, state? })` | Lists items, draft-first | Read |
| `get_metadata({ type, name, state? })` | One item's body | Read |
| `save_metadata_draft({ type, name, item, package?, ifMatch?, clientSpecVersion? })` | `saveMetaItem({ mode: 'draft', surface: 'mcp' })` | **Returns `draftPublishVerdict` for the saved draft**, so the client sees every rule a publish would raise |
| `delete_metadata_draft({ type, name })` | Discards a pending draft | |
| `list_drafts({ package? })` | Pending drafts with their verdicts | The review queue, as the client sees it |

- No publish tool, no `force`: a draft executes nothing, and the destructive-change confirmation stays at the human publish.
- `initialize` instructions and discovery state `Authoring contract: @objectstack/spec <version>` and the install line for `@objectstack/skills@<version>`.
- The open runtime serves `GET /api/v1/discovery/restriction-profile` (mount what the CLI already reads).
- Two lint rules join the registry, both runtime-gated for `flow`: node type without an executor in the sealed vocabulary, and approval out-edges not labelled `approve` / `reject`. E1 A (enforce first) makes them publish-time checks; #34776 carries them with four more.
- CLI: `os meta register --mode draft`, and `os lint --item <file>`.

## Design B — the local loop (export, simulate, submit)

The strongest answer to runtime-dead metadata is to run it before submitting it.

Ruled E3 phased: of this loop only the flow test run is built now (#34779); the other steps wait for a request.

| Step | Today | Missing |
|:---|:---|:---|
| Download | `os package export` → one `objectstack.json` per package | An editable project form (one file per object, view, flow) |
| Install locally | `os package install`, `os dev` | Sample data: a seed-only export or a bounded sample |
| Test | `os lint`, `os validate --target`, `os verify` (CRUD, RLS, reference shapes, delete behaviour, unique scope, dashboard windows) | **A flow test run**: trigger a flow against the local runtime and report the node trace |
| Submit | `os deploy` (active) | A draft submit of the **difference** only: `os deploy --as-drafts`, staging through the same draft door |

- The restriction profile travels with the export, so the local runtime refuses what the target refuses.
- The loop is the same for a cloud environment, provided the environment may export (not verified; see Not verified).

## Design C — 问数

1. **One source, two renderings.** Move the data loop (terms → `list_datasets` → one match answers, several ask back, none asks back over the `candidates` if any (E2) and otherwise falls back and says so → cite `provenance`) into a published skill written for a client answering over MCP (#34685). Generate the served `/mcp/skill` text and the package copy from it (#34686).
2. **Deliver it.** The open `initialize` instructions name the skill and its install line, and carry the selection rule in five lines for a client that installs nothing (D5 A; #34686). A tool description does not do this job: the client loads a tool's schema only after choosing the tool (M4, reading 3).
3. **Fix the semantic data, which no skill can supply.** The build skills teach dataset `synonyms` and member `description` in the user's language, and a lint rule warns on a measure that has neither (#34718).
4. **Slim the tool list.** `validate_expression` alone is 7.8 KB of the open door's 40 KB. Text that teaches moves to the skill; a description keeps what the call needs (#34689, on hold).
5. **E2 — zero-match candidates (ruled A, by F1 B).** On a zero-match `list_datasets` returns a `candidates` list, never auto-selected, for the client to ask back with. Candidates never count as a match: ADR-0149 D3's exact match stands, and D3 gains a note. The skill gains the matching branch (candidates listed → ask, never pick). M4 shows the need: on a near-miss word both arms picked a reading silently. Which members are candidates, the entry shape, order and cap are the contract of #34761 (spec and the D3 note) and #34763 (the server fill), not of this record.

## Design D — the cloud door

Keep the tools. Change four things (M-4, routed whole to the cloud PM; #34690 is the public pointer):

1. Move static rule text to the published skills until the served corpus is the environment delta (the restriction profile, the hosted-only rules, the tool-behaviour notes). The served copy stays as the fallback for a client with no local package. Under E1 A a rule whose breach is runtime-dead metadata becomes a publish-time check first, and its prose moves to the published skills once it is stable.
2. Give `confirm-before-change` an MCP rendering. The no-argument answer today describes the in-product confirm card and, two paragraphs later, says the connection has none.
3. Measure the door: token weight of `tools/list` and of the rules answer, and a build-accuracy eval over MCP. Neither exists.
4. Make two guards real on MCP: the verification bound and read de-duplication are keyed on a chat turn the door does not have, and the daily write cap is a per-process counter.

## Measurements

Taken once by the first epic seat, before the rulings; kept as history. Token figures are estimates (characters / 4); CJK text tokenizes denser, so read them as a floor. Raw outputs are kept outside the repository tree by the measuring session.

| # | Question | Method | Result |
|:---|:---|:---|:---|
| M1 | Weight of the open door | `examples/app-crm` booted on `a0326b06`, admin API key, read over HTTP | `initialize` instructions 98 B. `tools/list` 17 tools, 40,341 B (about 10k tokens): descriptions 16,320 B, input schemas 20,925 B. Heaviest: `validate_expression` 7,791 B, `query_dataset` 5,508, `aggregate_records` 3,942, `run_action` 3,433. `/mcp/skill` 16,625 B |
| M2 | Weight of the cloud build door | The package's own code run against a mocked kernel, cloud `53a5844`; the no-argument answer is byte-identical through the real door `execute()` | Door tool list 19 tools, 35,725 B (about 9k tokens); `apply_edit`, `create_object`, `add_field`, `modify_field` are 60% of it. `initialize` instructions 11,580 B. No-argument rules answer 33,014 B. On-demand rule text 104,672 characters over 30 rules (private 63,792, read from the published skills 40,880). Of 60 rules, 44 are static (77,734 characters) and 16 depend on the environment (77,221) |
| M3 | Dataset term match rate for natural business words | One `list_datasets({ terms })` call with 30 words on a live hosted CRM environment whose datasets carry no synonyms | 6 of 30 matched. Chinese 0 of 16. English 6 of 14; misses include `revenue`, `sales`, `deals`, `customers`, `average deal size`, `quota attainment` |
| M4 | Does a local 问数 skill change answers | A/B pilot on `examples/app-crm`: 12 questions per arm, `claude -p --model haiku --effort medium`, subscription login. Arm A is the scenario runner's ask client (empty directory, `--allowedTools mcp__app`). Arm B adds `.claude/skills/objectstack-ask/SKILL.md` and the `Skill` tool | Measured. The scores are held by the measuring session for the maintainer; the direction is described below without figures |
| M5 | Does a draft door stage runtime-dead metadata | Build-over-draft-door eval mode | Not started; needs Design A (#34780) |

### What the readings say

1. **M4 is a pilot: one run per cell shows direction, not a ranking.** The scenario-eval noise rule asks for five repetitions before a model or effort decision rests on a number.
2. **The skill changes the path, not the arithmetic.** Both arms computed the right numbers. Without the skill the client answered from `aggregate_records` and cited nothing; with it the client went `list_datasets` → `query_dataset` and cited the governed measure. A governed metric that the client never reaches is not governing anything.
3. **Tool descriptions are not a delivery channel.** Claude Code defers MCP tool schemas and loads the ones it picks. In arm A, three of the four synonym questions never loaded `list_datasets`, so the selection rule written in its description was never read. This is why the 98-byte `initialize` text matters (Design C, item 2).
4. **Fallback labelling is the clearest effect**: after a zero-match the baseline answered with no marker; the skill arm wrote 非指标口径.
5. **Neither arm asks back on a near-miss word** (`revenue`, 金额, 销售额): there is no match to ask about, so both pick a reading silently. The skill cannot fix this alone. E2 A answers it in the tool result: a `candidates` list, never selected, to ask back with (#34761, #34763).
6. **Semantic data dominates on a real environment.** M3's environment has no synonyms, so the path the skill teaches would end in the fallback for every Chinese question there.
7. **Both doors are heavy before any work starts.** The open door lists 40 KB of tools while its instructions say one sentence; the cloud door adds 36 KB of tools, 12 KB of instructions and a 33 KB first rules read. Half of the cloud rule text by character count is static.

## Decisions (ruled)

D1–D7 are recorded on #34659. The maintainer's word on them and on E1–E4 was 「同意你的所有建议，开始立专题子卡」 (record 6940528935, 2026-11-17T06:22Z). E2 was re-ruled by F1 B, option text 「B 零命中返回候选」 — 「现在就改服务器，list_datasets 零命中时返回候选数据集。专题席的新推荐。」 (record 6943126855, knock 6943149235, 2026-11-17T08:42Z). S1–S3 were ruled by the option 「四张全部 A」 (record 6943116536, 2026-11-17T08:42Z).

- **E1 = A, enforce first.** Rule content is open. A rule whose breach is runtime-dead metadata becomes a publish-time check first; its prose moves to the published skills once it is stable. The cloud keeps the index, the triggers and the tier rendering (#34776).
- **E2 = A**, by F1 B, replacing the "B with a premise" of record 6940528935. On a zero-match `list_datasets` returns a `candidates` list, never auto-selected. Candidates never count as a match: what counts as a match in ADR-0149 D3 does not change, and D3 gains a note. The contract is #34761's and #34763's (Design C, item 5).
- **E3 = phased.** The draft door returns the publish verdict of the saved draft. Of the local export / simulate / submit loop, only a local flow test run is built now (#34779); the rest waits for a request.
- **E4 = A.** The local path uses an API key, documented beside the MCP login. REST does not start accepting the MCP OAuth token.
- **S2 = A.** The skills' existing eval cases run on a weekly schedule, and the skills are iterated from those readings (#34764).
- **S3 = A.** One copy of the shape knowledge for code-first and MCP development, with one thin procedure for each. The thin "build over MCP" procedure skill is written when the draft door exists (#34778); the triggers, the router-sized `SKILL.md` and the JSON form are #34769, #34770 and #34771.
- S1 A (who reviews a change to a published skill stays as today) touches nothing in this record.

## Milestones (as on #34659's body)

- **M-0 measure** (history): M1–M4 above, taken once before the rulings. The five-repetition ask round they called for is owed through the scenario runner: the opt-in skills directory for the ask client and the dataset scenario cards are #34687.
- **M-1 问数** (released by the maintainer, record 6944452341): #34685 the ask-data skill; #34686 the `initialize` instructions and a single-source `/mcp/skill` (two PRs); #34687 the ask-mode skills option, dataset cards and graders; #34689 slimming the tool list (on hold); #34718 dataset members published with neither synonyms nor a description; #34720 and #34721, two readings; #34761 → #34763 `candidates` on a zero-match (E2), spec then server; #34764 the weekly skills-eval runner (S2); #34789 the skills' eval cases reviewed for over-literal assertions, with trigger cases (S2, blocked by #34764); #34787 the stdio door's `list_datasets` never localizes. Existing cards #33824, #33752 and #34414 stay on their own lanes.
- **M-2 draft door** (filed and held until the maintainer's go on the M-1 summary): #34766 the door; #34774 the contract version, major refusal and restriction-profile route; #34776 six publish-time checks (E1); #34777 `os meta register --mode draft` and `os lint --item`; #34778 the thin build skill; the S3 skills cards #34769, #34770, #34771 and #34773 (`os skills install | update | status`).
- **M-3 local flow test run** (filed and held, E3 phased): #34779 the flow test run; #34780 the build-over-the-draft-door eval mode (M5).
- **M-4 hosted door**: Design D and the D1 pricing cell, in the cloud repository, routed to the cloud PM.

## Not verified

- Whether a cloud environment may export its packages.
- The exact rendered size of the cloud rule corpus.
- Whether `list_datasets` matches against translated labels for the caller's locale: #34720 reads whether a translation-bundle label is matched, #34721 what `list_objects` and `describe_object` return of an author's descriptions, and #34787 carries the stdio door, which never localizes.
- Every cloud reading in this record (Cloud build, M2, Design D), as of cloud `53a5844`.
