---
name: objectstack-ask
description: >
  Answer a business question over a live ObjectStack environment through its
  MCP tools (list_datasets, query_dataset, list_objects, describe_object,
  query_records, aggregate_records): find the governed metric the question
  names, compute it and cite its source, or fall back to an object query and
  say so. Use for EVERY question answered from the app's records, before the
  first data tool call, even when it names no metric: a number, a total, what
  has been claimed, spent, sold or paid so far, a ranking, a breakdown, a trend
  or a list, in any language ("how many", "how much", "total", "so far", "top
  10", "by stage", "this quarter"; "多少", "一共", "总额", "排名", "占比",
  "趋势", "按阶段统计", "列出"). Do not use for building or changing metadata (the
  domain skills cover that), or for writing a query in application code (see
  objectstack-query).
license: Apache-2.0
compatibility: Requires an environment served by @objectstack/mcp 18.x
metadata:
  author: objectstack-ai
  version: "18.6.0"
  domain: process
  tags: ask, question, metric, dataset, mcp, list_datasets, query_dataset, 问数, 指标
---

# Answering a business question over an ObjectStack environment

You are connected to a live environment through its MCP tools, and the user
asked for a figure or a list from its data. Work these steps in order for every
question. Never skip step 1: a governed metric (a dataset measure whose owner
wrote its business definition) outranks a number you work out yourself.

## 1. Lift the business words and look for a governed metric

- Lift the question's business words: the thing measured ("win rate", "营收",
  "商机数") and what it is grouped or filtered by ("by stage", "按行业").
- Call `list_datasets({ terms })` with those words, as the user wrote them.
  Do not translate or reword a term: a match on a word
  you supplied is your reading, not the user's. A term is the noun phrase for
  the thing, kept whole ("travel budget", not "travel" and "budget";
  "number of deals", not "deals") and without the verbs, time words
  and question words around it ("trip days", not "trip days requested";
  "报销金额", not "报销金额合计是多少").
- Each dataset in the answer carries `matches`: one entry per hit, with the
  `term`, the `member` it names (`measures.<name>` or `dimensions.<name>`) and
  `matchedOn`. A word matches only when it equals a member's name, label or
  synonym (case, spacing, `_` and `-` aside), never by similarity.
- A word that matched nothing may have `candidates`: members
  offered as possible readings, each a `{ term, dataset, member }` pointer to a
  member the same answer lists. A candidate is not a match.
- No `list_datasets` among your tools: this environment serves you no governed
  metrics. Go to step 4.

## 2. Decide by the matches

| What the answer shows | What you do |
|:--|:--|
| Each word for a thing measured matches exactly one measure | Compute: step 3. Two words with one measure each ("营收和赢单率") are two metrics, not a choice: compute both, with one `query_dataset` per dataset. |
| One word matches several measures, in one dataset or in two | Ask the user which one they mean. List each candidate's label, its dataset's label and its description. Do not pick one. |
| A word with a measure among its `candidates` | Ask the same way; with one candidate, ask whether it is the one meant. |
| A word whose `candidates` are all dimensions | At most a possible grouping: never ask about it, and it never stops a matched measure. |
| No word for a thing measured, only grouping or filter words | A grouping is not a number: ask which number is meant. |
| No match and no candidates for the word for a thing measured | Step 4, without asking: a grouping word's match, or another word's, is no reason to ask. |
| `membersWithheld: true` on a dataset | Say that it has members (measures or groupings) you may not read; the metric asked for may be among them. Do not say the metric does not exist. |

When the answer has `nextStep`, follow its `decision` and `note`. If `note`
says to answer one measure and ask about a word, do both.

When you only ask, the reply is the question alone: no tool call until the user
answers. State no figure of your own in it (no count, total
or option number): name each option by its label in a bullet, and quote its
description as written. Ask only about matches or candidates for words the user
wrote. `partial: true` on the answer means the catalogue may
be incomplete; `warning` says why, and you repeat it when you fall back.

Use an option only once the user picks it: compute it by its exact name
(step 3). Another word starts at step 1; if they only pick none, go to step 4.

## 3. Compute a governed metric

- `query_dataset({ datasetName, selection })`. `selection.measures` and
  `selection.dimensions` take the names `list_datasets` gave;
  `selection.runtimeFilter` filters; `selection.dateGranularity` buckets a date
  dimension for a trend; `selection.order` and `selection.limit` rank.
- Cite the answer's `sourceLine` as given; without one, build the source from
  `provenance` (the dataset's label and each measure's label, as in
  「指标：营收（数据集：销售分析）」), not from memory.
- Use the measure's `description` to say what the number includes and excludes.
- A `warning` on the answer narrows what you were allowed to read: repeat it.

## 4. Fallback: object queries

- The question names a kind of record (trip requests, invoices) and no listed
  object or dataset is that kind: say you cannot see those records here (they
  may be hidden from you) and stop. Never answer from a different object that
  merely links to it.
- `list_objects`, then `describe_object({ objectName })` on the object you will
  read. Read its fields before you filter: a field with `options` is filtered
  by the option's `value`, never its label.
- Use `aggregate_records` for a count, sum, average or breakdown. Never page
  through `query_records` to add numbers up yourself. For a top or bottom N,
  pass `orderBy` (an aggregation alias or a group key) and `limit: N`, so the
  database ranks and cuts the groups.
- `withheldFields` on a `query_records` or `get_record` answer names fields
  that exist but are hidden from you: say they are not visible to you, never
  that they are empty.
- Open the answer with one line saying it is not from a governed metric
  (非指标口径), and name the object and fields you computed it from.
- When that object is a listed dataset's `object`, add one line naming the
  dataset and its measures, so the user can ask for the governed figure.

## 5. When the data cannot answer

- No metric, object or field records what the question needs: say the data you
  can read does not record it, name what is missing (such as a shipment's
  weight), and offer the computation if the user supplies it.
- Never fill the gap with an assumed value, and never draw a conclusion from
  one.

## 6. Writing the answer

- Answer in the user's language.
- Show labels, not machine names or raw option values.
- Every figure comes from a tool answer in this conversation.
- `truncated: true`: more rows or groups existed than came back; say the
  result is partial, and cite `totalGroups` as how many groups existed before
  the cut. Without it, say a `query_dataset` total is unknown, not `rowCount`.
- State the filter and the time window you used, in words.
