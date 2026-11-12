# #32183 landing plan and handover (PR #32497, branch `claude/project-thread-phk4r9`)

Written 2026-11-12 ~12:15Z by the card thread (session_01Utp6CZWiYtefqQt3DQa9iW), on the seat's wind-down order (12:08Z relay; Bill 12:06Z).

## 中文速读

- 分支 `claude/project-thread-phk4r9` 已全部推送，head `8ec8d78ea`，本地没有未推的提交。PR #32497 仍是草稿，没开新 PR。
- 第 4 轮完成：审查 PASS 6821393023、红线复核 PASS 6821404403、席位纯文字复读 6821456566；r4 报告 6823037573；r4 正文已由席位套用。
- 还没做：落地合并。等 #32513 合入后，合一次 `origin/main`（不 rebase），带上下面 4 项落地职责，推之前报行数（预计超过 3000，由席位找 Bill，不拆）。新席位读完之后再落地，不要排队。
- 已做的准备：在本地草稿分支试合了 main（不推），冲突和解法见下；flow 门的平价钉测试已写好、并在试合树上测到它在修复前变红（6/6），文件在 `landing-wip/`。

## State

| | |
|:--|:--|
| PR | #32497, draft, no assignee, no review request |
| Head (pushed) | `8ec8d78ea` (changeset-only on top of `292dce529`) |
| `main` merged at | `216674301` (not merged again, by order) |
| Size | 48 files, +2893 −97, **2990** changed lines against `216674301`; the same against `origin/main` `0c8097ec0` on the trial merge |
| Reviews | delta CR PASS 6821393023; epic red-line PASS 6821404403; seat read of the text-only delta 6821456566 |
| Report | r4 6823037573 (r1 6811876493, r2 6815594567, r3 6819087741) |
| Body | `pr-body-r4.md` in this folder, applied by the seat (byte-identical read-back, 12:03Z) |
| Verified on `292dce529`/`8ec8d78ea` | 13 full suites, 12 typechecks, `pnpm lint`, `dispatch-gates --ran` 84/84 exit 0, dogfood 451 files / 3780 tests green (lock 1826s) |
| CI | `292dce529`: 66 runs, 55 success, 11 skipped, 0 failed. `8ec8d78ea`: no check run created at 12:00Z (get_status 0); the landing push runs CI again |
| Follow-ups | #32670 (served judgment at the send/run doors; the seat adds "the flow doors too"), #32705 (N2 pin, per-transport pins), #32354, #32501 |

Local scratch branches in the old container, **never pushed** (standing rule): `wip-32183-qualifier`, `wip-landing-trial` (the trial merge below). Nothing on them is needed: what matters is copied into `landing-wip/`.

## Landing steps (in order)

0. Wait for #32513 (#31700) to land (it was in the merge queue at 11:57Z, ACCEPT 6822947309). Check `git log origin/main` for `(#32513)`. If #32407 (PR #32566) has landed too, see step 5.
1. `git fetch origin main && git merge origin/main` on `claude/project-thread-phk4r9` — **once, no rebase**.
   - Expected conflicts (trial merge with `0c8097ec0`, before #32513): `packages/rest/src/meta-qualified-item-route.test.ts` and `packages/runtime/src/domains/meta-qualified-item-read.test.ts`. In each, both sides add a top-level `describe` at one spot, and the shared tail `    });\n});` closes both. Keep both: ours, its own `    });\n});`, then theirs (main's #32365 describe). `landing-wip/keep-both.py <file>` does exactly that (asserts one conflict per file).
   - #32513 brings `judgePicklistArrival` and edits `registry.ts` near this PR's `withPendingManifests` change (this PR makes the view's `packageScopedHoldersOf` forward `(type, name, callerPackageId, options)`). If they conflict: keep this PR's forwarding and #32513's body.
   - Then `pnpm install --frozen-lockfile` and a full `pnpm build` (main moved 40+ commits).
2. **Duty: `judgePicklistArrival`** (objectql `registry.ts`, from #32513; ruling 6815997281). In its `judged` memo, both calls, `before` (over `this`) and `after` (over the pending view), pass `includeDisabledPackages: true`, as `picklistReferenceVerdict` (the field verdict) already does on this branch. Docblock: the arrival judge reads every holder because the field verdict does, so the install audit and the served field agree for a disabled holder.
   - Pin (objectql, beside #32513's `registry-bare-name-one-holder.test.ts` "the install door re-judges the references already installed"): A (namespace alpha) holds list `status` and is **disabled**; C depends on A and B; C's field names `status`. Installing B (namespace beta, declaring `status`) is refused exactly as with A enabled (the `references` verdict names C's field and both holders). CONTROL: `picklistReferenceVerdict('status', C)` resolves to A while A is disabled. Both registration orders. Without the fix the served `before` is not-found for C, the reference is skipped as "refused already", B is admitted and C's field silently loses its options. Ablate (drop the two arguments): the pin goes red.
3. **Duty: #32507's flow doors, held at `main` (R4-G; the seat ruled "全部 hold 在 main（读全部持有者），加平价钉测试", 12:03Z).**
   Measured on the trial tree (served reads, nothing held yet), CRM and HR each holding flow `convert_lead` and api `lead_api`, engine double with both slots (the engine's state after a runtime disable: `disablePackage` unregisters nothing from the engine). FROM = nothing disabled (= `main`), TO = served:

   | Disabled | Door | FROM (main) | TO (served, unheld) |
   |:--|:--|:--|:--|
   | CRM | HR's own flow action (`flowServiceForCaller`) | runs HR's slot | 409 from the bare entries |
   | CRM | CRM's own action; OPS (depends on CRM) action | runs CRM's slot | 409 |
   | CRM | BOTH (closure holds both) `flowHolderForCaller` | undefined | HR |
   | CRM | `flowWalkReads.rootPackage` / `endpointPackageOf` | null / undefined | HR / HR |
   | CRM | `bareNameRefusal` (bare `/automation/NAME`, MCP `resume_run`) | refused [CRM, HR] | undefined (no refusal) |
   | CRM | `/automation/crm/NAME` / `/automation/hr/NAME` | slot CRM / slot HR | 409 [HR] / bare path |
   | both | `/automation/crm/NAME`, `hr`, `ops`, `none` | slot / 409 | 404 |
   | both | `/automation/_env/NAME` | 409 [CRM, HR] | bare path |

   So a served read breaks the enabled holder's own flow action (200 → 409) and widens others. Hold every one at `main`:
   - runtime `flow-slot-view.ts`: every `resolvePackageScopedName` call (`flowServiceForCaller` bare and own, `endpointPackageOf`, `flowWalkReads.rootPackage` and `callee` bare and own, `flowHolderForCaller`) passes `includeDisabledPackages: true`. Module docblock: every answer is `main`'s; the served judgment is #32670.
   - runtime `domains/automation-address.ts`: `bareNameRefusal` passes `includeDisabledPackages: true` (it only refuses a two-holder name, so a one-holder answer does not move). `admitAutomationAddress`: when the name has two or more holders over every holder (`holdersOf(…, { includeDisabledPackages: true }).length > 1`, the state #32507 opened for a flow), read `holders` and `bare` with `includeDisabledPackages: true`; a one-holder name keeps this PR's served read (rows 1–2).
   - service-automation `engine.ts` (the slot table from #31696 PR-2 `c62e72a43`, reachable only since #32507): the `FlowSlotTable` `heldByMany` callback, `sharedFlowNameRefusal`, and `resolveFlowKey`'s shared branch read every holder (`durableFlowHolder`, or `flowNameResolver(name, caller, { includeDisabledPackages: true })`). Leave `flowHolder` / `flowHolderPackage` (row 12) and `stillHolds` as they are. `flowDispatchHolder` reads `flowHolder`: a dispatch key, not a body door; read it and say so in the body.
   - Pins: `landing-wip/flow-slot-view-disabled-holder.test.ts` → `packages/runtime/src/`. Parity over a real `SchemaRegistry`: for each non-empty disabled set of the two holders, both orders, every door's answer equals the answer with nothing disabled; 2 CONTROLs say what `main` answers. **Measured on the trial tree before any fix: 6 parity tests red, 2 CONTROLs green.** Add an engine parity pin in service-automation (real engine + registry, as `flow-slots-per-package.test.ts` builds them): both slots armed then one holder disabled (runtime disable), and only the enabled holder's slot armed with both in the registry (boot disable); a subflow from a caller flow of each package (CRM, HR, OPS, BOTH, NONE), and the bare execute. Ablate each hold.
   - Body and changeset: a "held at `main` (R4-G)" line under Not moved for these doors; nothing here moves. Tell the seat to add the flow doors to #32670.
4. **Duty: `storeRemovalKeys`.** This branch does not touch `packages/metadata/src/package-slotted-store.ts`. After the merge, check `main` carries both #32533's every-slot action removal and #32513's package arm, and run the metadata full suite. The ruling asks "both kept, with a pin where both touch one reader": if no reader touches both, say so in the body.
5. **If #32407 landed first**: `judgesPackageLessRows` excludes disabled holders, with a pin (ruling R4-G family; see `card-32407` notes).
6. **#31700 family check** (seat: moved → rows + pins; not moved → "已核，无移动" with the measurement). With one of two namespaces' holders disabled, measure on the merged tree:
   - metadata service `get` / `unregister` by name (the store's slots): no registry disabled read, expected no move;
   - engine function `resolveFunction` / `functionHoldersOf` (the engine's own holder map): expected no move;
   - field verdict and boot audit (`picklistReferenceVerdict`, `findDisagreeingPicklistReferences`): every holder, expected no move; the extension orphan judge (`findOrphanPicklistExtensions`): check which read it uses;
   - install arrival judge: duty 2;
   - bare `GET /meta/{picklist,mapping,dataset,api}/NAME`, the import door's `mappingName`, `?callerPackage=` dataset: served, so rows 4 and 10 apply; the runtime and rest loops already iterate every `PACKAGE_SCOPED_READ_TYPES` type, these four included. #32513 makes the two-namespace state reachable through install: add one line saying so, with the measurement.
7. Size, then push: report the size to the seat **before** pushing (expected over 3000; the seat asks Bill; do not split). Then the full battery on the landing head (13 suites + `service-automation`, `metadata`, typechecks, lint, `dispatch-gates --ran`, dogfood alone), CI, a delta review and the epic red-line read on the landing head. **Do not queue** until the new seat has read it.

## Gotchas

- objectql tests import objectql src but metadata-protocol **dist**: rebuild metadata-protocol after editing it. plugin-email and runtime tests use the objectql **dist**: rebuild objectql after editing it.
- Measure `main`'s FROM cheaply: `git checkout <main> -- packages/objectql/src packages/metadata-protocol/src`, rebuild metadata-protocol, run the probe, then `git checkout HEAD --` and rebuild.
- Ablation markers `!== 'ABLATED_X'`; rebuild after the restore; check the marker is in 0 dist files.
- `NODE_OPTIONS=--max-old-space-size=6144` for the cli typecheck. Background runs stop at 2 h: run dogfood alone (`bash scripts/pm/os-verify-lock.sh -c 'pnpm --filter @objectstack/dogfood test'`, ~30 min).
- Report: `node scripts/pm/post-stamped.mjs --comment=32183 --file=F` (`--dry-run` first; only `{{NOW}}` is a known token).
- Commit trailers model-free; no `--no-verify`; never a closing keyword next to another card number.
