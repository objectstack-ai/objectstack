---
"@objectstack/spec": patch
---

`RestServerConfig` now documents its own reachability: the `crud` / `metadata` / `batch` blocks are embedder-only, and the schema says so instead of implying a deployment posture nobody can author.

`RestServerConfig` is the argument a host passes when it constructs the REST server, and both doors are programmatic — `createRestApiPlugin({ api })` and `plugin-hono-server`'s `restConfig`. No shipped boot path opens either with a config of its own: `os serve` passes a fixed argument carrying exactly two CLI-derived keys (`api.enableProjectScoping`, `api.projectResolution`), and the dev plugin passes none at all. So on a CLI-started deployment every other key is whatever its `.default()` says, with no flag, env var or config file that moves it — and until now the schema did not say so anywhere an operator would look.

- **The file header gains a `WHO CAN WRITE THIS CONFIG` section**, which is the part that reaches the generated reference page, and the `crud` / `metadata` / `batch` sub-schemas each gain a `Reachability: EMBEDDER-ONLY` line. The three keys' entries on the parent `RestServerConfig` table say it too, so the fact survives into `content/docs/references/api/rest-server.mdx` rather than living only in the TS source.
- **`metadata.maskObjectFields`'s docblock is corrected.** It said `false` "opts this server out and serves the full schema to every authenticated caller" and offered the env var as a "deployment-wide counterpart", as if a deployment could pick either. Only an embedder can write the key; the opt-out a deployment can actually reach is `OS_ALLOW_UNMASKED_OBJECT_METADATA=1`. This is the one on the list that reads as a security control (ADR-0106 D8), which is why it is called out here.
- **`api.enableSearch` is corrected the same way.** Its docblock called it a "Deployment-wide switch" and its `describe()` a "deployment-wide search opt-out"; `os serve` does not thread it either, so it is embedder-only like the rest of the block apart from the two project-scoping keys.
- **The liveness ledger answers the ADR-0049 question in writing.** Every `live` row in `liveness/crud_endpoints.json`, `metadata_endpoints.json` and `batch_endpoints.json` gains a `REACHABILITY` sentence, and each file's `_note` carries the measurement once. `status` and `verifiedAt` are untouched on purpose: `live` answers who *reads* a key, reachability answers who can *set* it, and adding the second re-verified no call graph.

No behaviour changes and no schema shape changes — no key, default, bound or refusal moves, so the accept set is byte-identical. This is prose plus ledger rows, and the regenerated `content/docs/references/api/rest-server.mdx` that follows from the `describe()` edits.
