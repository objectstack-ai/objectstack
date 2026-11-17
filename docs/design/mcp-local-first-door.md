# Design — MCP local-first door (build and 问数)

**Status**: draft for the maintainer's ruling on [#34659](https://github.com/objectstack-ai/objectstack/issues/34659). Nothing here is adopted; D1–D7 on that card and E1–E4 below are open.
**Builds on**: ADR-0149 (governed datasets), ADR-0087 (conversion layer), cloud ADR-0112 (MCP build tiers), cloud ADR-0025 / ADR-0082 (open/closed line).
**Audience**: the seats that implement the milestones, and the maintainer deciding them.
**Readings**: every count below was taken on objectstack `62d9d0d99` and cloud `53a5844`, unless a row says otherwise.

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

### Open-source build

- The MCP server registers data, action, dataset and file tools. It registers no authoring tool: `packages/runtime/src/domains/mcp.ts:247-257` passes no `authoring` to `handleHttpRequest`, and no open package implements `McpAuthoringToolRegistry` (`packages/mcp/src/types.ts:96-102`).
- The seam is complete: `registerAuthoringTools` (`packages/mcp/src/mcp-server-runtime.ts:1695-1728`) registers whatever registry the host injects, behind `metadata:write`.
- **A draft save runs no authoring rule.** `AUTHORING_SURFACES = ['cli','runtime-publish']` (`packages/lint/src/authoring-rules.ts:186-205`); the gate returns no error when `state !== 'active'` (`packages/metadata-protocol/src/protocol-authoring-gate.ts:430-445`). A draft is checked by its type's Zod schema only. Of the 68 registry rules, 40 run at publish and on the CLI, 28 on the CLI alone.
- A read-side preview of the publish verdict exists: `draftPublishVerdict` (`protocol-authoring-gate.ts:713`).
- **An MCP OAuth token is not accepted on REST.** `acceptOAuthAccessToken` is set for the `/mcp` path alone (`packages/runtime/src/http-dispatcher.ts:767`). REST takes a session or an API key.
- The Studio draft review (`ui/packages/app-shell/src/preview/`) imports open packages only.
- A code-first path already reaches a self-hosted runtime: `os environments use-runtime` then `os deploy`; `os meta register` saves an active item; `os package export` writes every installed package as an installable `objectstack.json`.
- Gaps in that path: `os meta register` has no draft mode; `os lint` takes a whole project, not one item; no open runtime serves `GET /api/v1/discovery/restriction-profile`, which `os validate --target` already reads.
- Two runtime-dead shapes have no lint rule at all: a flow node `type` with no executor (the run fails with `NO_EXECUTOR`), and an approval node whose out-edges are not labelled `approve` / `reject`.

### Cloud build

- The cloud door is the in-product builder's tool registry served through the same seam, with one context switch (`authoringDoor: 'mcp'`). It lists 19 of 29 build tools.
- Its rules are already a hybrid: about 100K characters of private text in 60 rules, plus about 25 sections read from the published `@objectstack/skills` at run time. Ruling A on cloud#3659 already states that a hosted build differs from a local one by a restriction profile only.
- Most of what the server does there is the third layer, not thinking: defaults (sharing model, namespace prefix, list view and navigation entry), refusals by tier, destructive-change confirmation, quotas, and `verify_build`'s probes against the real environment.

### 问数

- The server side is in place: `list_datasets({ terms })` reports exact matches on name, label and synonym; `query_dataset` answers with `provenance`.
- **The procedure has no reliable delivery channel.** The open server's `initialize` instructions are one sentence (`mcp-server-runtime.ts:1771`). The full text is the `GET /mcp/skill` page, which a person must fetch. A client that only ran `claude mcp add` has the tool descriptions and nothing else.
- The scenario runner's ask persona is exactly that client: an empty directory, `--strict-mcp-config`, `--allowedTools mcp__app` (`packages/qa/scenarios/src/runner/driver.ts:468-483`). Every ask score recorded so far is a no-skill score.
- `skills/objectstack-query` teaches a developer to write ObjectQL in code. No published skill teaches a client to answer a question over a live environment.
- None of the 9 open scenario cards declares a dataset or a synonym.

## Corrections to the card

| The card says | Reading |
|:---|:---|
| The save door "stays authoritative and returns structured findings" | Not for a draft: only the schema parse runs. The draft tool must return the publish verdict itself (Design A) |
| Not verified: an OAuth MCP token on REST `/meta` | Not accepted. The local loop needs an API key (E4) |
| Not verified: Studio draft review with no cloud packages | Verified: open imports only |

## Design A — the open-source draft door

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
- Two lint rules join the registry, both runtime-gated for `flow`: node type without an executor in the sealed vocabulary, and approval out-edges not labelled `approve` / `reject`.
- CLI: `os meta register --mode draft`, and `os lint --item <file>`.

## Design B — the local loop (export, simulate, submit)

The strongest answer to runtime-dead metadata is to run it before submitting it.

| Step | Today | Missing |
|:---|:---|:---|
| Download | `os package export` → one `objectstack.json` per package | An editable project form (one file per object, view, flow), E3 |
| Install locally | `os package install`, `os dev` | Sample data: a seed-only export or a bounded sample |
| Test | `os lint`, `os validate --target`, `os verify` (CRUD, RLS, reference shapes, delete behaviour, unique scope, dashboard windows) | **A flow test run**: trigger a flow against the local runtime and report the node trace |
| Submit | `os deploy` (active) | A draft submit of the **difference** only: `os deploy --as-drafts`, staging through the same draft door |

- The restriction profile travels with the export, so the local runtime refuses what the target refuses.
- The loop is the same for a cloud environment, provided the environment may export (not verified; see Not verified).

## Design C — 问数

1. **One source, two renderings.** Move the data loop (terms → `list_datasets` → one match answers, several ask back, none falls back and says so → cite `provenance`) into a published skill written for a client answering over MCP. Generate the served `/mcp/skill` text and the package copy from it.
2. **Deliver it.** The open `initialize` instructions name the skill and its install line, and carry the selection rule in five lines for a client that installs nothing. A tool description does not do this job: the client loads a tool's schema only after choosing the tool (M4, reading 3).
3. **Fix the semantic data, which no skill can supply.** The build skills teach dataset `synonyms` and member `description` in the user's language, and a lint rule warns on a measure that has neither.
4. **Slim the tool list.** `validate_expression` alone is 7.8 KB of the open door's 40 KB. Text that teaches moves to the skill; a description keeps what the call needs.
5. **E2 — zero-match candidates.** Exact matching is ADR-0149 D3's choice. Without loosening it, `list_datasets` may return a `candidates` list (members whose name, label or synonym *contains* the term) marked as not a match, for the client to ask back with, and the skill gains the matching branch (candidates listed → ask, never pick). M4 shows the need: on a near-miss word both arms picked a reading silently. This needs the maintainer's word because it touches D3.

## Design D — the cloud door

Keep the tools. Change four things:

1. Move static rule text to the published skills until the served corpus is the environment delta (the restriction profile, the hosted-only rules, the tool-behaviour notes). The served copy stays as the fallback for a client with no local package.
2. Give `confirm-before-change` an MCP rendering. The no-argument answer today describes the in-product confirm card and, two paragraphs later, says the connection has none.
3. Measure the door: token weight of `tools/list` and of the rules answer, and a build-accuracy eval over MCP. Neither exists.
4. Make two guards real on MCP: the verification bound and read de-duplication are keyed on a chat turn the door does not have, and the daily write cap is a per-process counter.

## Measurements

Token figures are estimates (characters / 4); CJK text tokenizes denser, so read them as a floor. Raw outputs are kept outside the repository tree by the measuring session.

| # | Question | Method | Result |
|:---|:---|:---|:---|
| M1 | Weight of the open door | `examples/app-crm` booted on `a0326b06`, admin API key, read over HTTP | `initialize` instructions 98 B. `tools/list` 17 tools, 40,341 B (about 10k tokens): descriptions 16,320 B, input schemas 20,925 B. Heaviest: `validate_expression` 7,791 B, `query_dataset` 5,508, `aggregate_records` 3,942, `run_action` 3,433. `/mcp/skill` 16,625 B |
| M2 | Weight of the cloud build door | The package's own code run against a mocked kernel, cloud `53a5844`; the no-argument answer is byte-identical through the real door `execute()` | Door tool list 19 tools, 35,725 B (about 9k tokens); `apply_edit`, `create_object`, `add_field`, `modify_field` are 60% of it. `initialize` instructions 11,580 B. No-argument rules answer 33,014 B. On-demand rule text 104,672 characters over 30 rules (private 63,792, read from the published skills 40,880). Of 60 rules, 44 are static (77,734 characters) and 16 depend on the environment (77,221) |
| M3 | Dataset term match rate for natural business words | One `list_datasets({ terms })` call with 30 words on a live hosted CRM environment whose datasets carry no synonyms | 6 of 30 matched. Chinese 0 of 16. English 6 of 14; misses include `revenue`, `sales`, `deals`, `customers`, `average deal size`, `quota attainment` |
| M4 | Does a local 问数 skill change answers | A/B pilot on `examples/app-crm`: 12 questions, one run per arm, `claude -p --model haiku --effort medium` (served `claude-haiku-5-5`), subscription login. Arm A is the scenario runner's ask client (empty directory, `--allowedTools mcp__app`). Arm B adds `.claude/skills/objectstack-ask/SKILL.md` and the `Skill` tool | Expected behaviour met: A 3 of 12, B 9 of 12. By kind (A → B): metric by synonym 1/4 → 4/4; no governed metric 0/3 → 3/3; near-miss word 0/3 → 0/3; unanswerable 2/2 → 2/2. `list_datasets` called with terms: 6/12 → 11/12. Checkable numbers correct: 7/7 in both arms. Mean per run: tool calls 4.25 → 5.5, turns 5.25 → 7.42, duration 13.6 s → 15.5 s |
| M5 | Does a draft door stage runtime-dead metadata | Build-over-draft-door eval mode | Not started; needs Design A |

### What the readings say

1. **M4 is a pilot: one run per cell shows direction, not a ranking.** The scenario-eval noise rule asks for five repetitions before a model or effort decision rests on a number.
2. **The skill changes the path, not the arithmetic.** Both arms computed the right numbers. Without the skill the client answered from `aggregate_records` and cited nothing; with it the client went `list_datasets` → `query_dataset` and cited the governed measure. A governed metric that the client never reaches is not governing anything.
3. **Tool descriptions are not a delivery channel.** Claude Code defers MCP tool schemas and loads the ones it picks. In arm A, three of the four synonym questions never loaded `list_datasets`, so the selection rule written in its description was never read. This is why the 98-byte `initialize` text matters (Design C, item 2).
4. **Fallback labelling is the clearest effect** (0/3 → 3/3): the baseline answered "2 条" with no marker after a zero-match; the skill arm wrote 非指标口径.
5. **Neither arm asks back on a near-miss word** (`revenue`, 金额, 销售额): there is no match to ask about, so both pick a reading silently. The skill cannot fix this alone; it is the case E2 exists for.
6. **Semantic data dominates on a real environment.** M3's environment has no synonyms, so the path the skill teaches would end in the fallback for every Chinese question there.
7. **Both doors are heavy before any work starts.** The open door lists 40 KB of tools while its instructions say one sentence; the cloud door adds 36 KB of tools, 12 KB of instructions and a 33 KB first rules read. Half of the cloud rule text by character count is static.

## Decisions asked of the maintainer, beyond D1–D7

- **E1. Rule content.** A (rec): rule *content* is open (skills and lint); the cloud keeps the index, the triggers and the tier rendering. B: content stays private.
- **E2. Zero-match candidates** on `list_datasets`. A (rec): add `candidates`, never auto-selected. B: exact only.
- **E3. The local loop is the primary build path**, the draft door its submit step. A (rec): yes. B: the draft door alone.
- **E4. One login for both doors.** A (rec now): the local loop uses an API key, documented beside the MCP login. B: accept the MCP OAuth token on the metadata and package routes under `metadata:write`.

## Milestones (revises the card's)

- **M-0 measure**: M1–M4 above are done once. Still owed: M4 at five repetitions through the scenario runner, which needs an opt-in runner flag that places a skills directory in the ask client's working directory, and dataset scenario cards to ask against.
- **M-1 问数**: the skill and its two renderings; synonyms teaching and the lint warning; dataset scenario cards and graders; E2 if ruled.
- **M-2 draft door**: Design A.
- **M-3 local loop**: Design B.
- **M-4 cloud**: Design D, in the cloud repository.

## Not verified

- Whether a cloud environment may export its packages.
- The exact rendered size of the cloud rule corpus.
- Whether `list_datasets` matches against translated labels for the caller's locale.
