---
"@objectstack/driver-turso": patch
---

test(verify): `checkDateBucketParity` / `checkReadCoercion` 的调用点不再 `as never`，替身的编译期检查恢复生效 (#6354)

`@objectstack/verify` 用 `BucketableDriver` / `CoercibleDriver` 两个**结构替身**表达「被测驱动确实具备这组方法」。这是一个**已发布**的契约面——仓外驱动（cloud 的 `driver-turso`）照着它实现自己的一致性测试。但全仓 **10 个**调用点无一例外把驱动 `as never` 之后再传进去，于是这件事**一次也没有被检查过**：替身存在的全部意义，被 100% 的调用点关掉了。

本次逐处删掉这 10 个 cast，一个不留：

- `packages/qa/dogfood/test/date-bucket-parity-conformance.test.ts` **6 处**（真实 `SqlDriver` / `SqliteWasmDriver` 1 处，负向控制的假驱动 5 处）
- `packages/drivers/driver-turso/src/date-bucket-parity.test.ts` **2 处**（`TursoDriver` 本地模式 + 那条 `week` 绊线）
- `packages/qa/dogfood/test/read-coercion-conformance.test.ts` **2 处**（`checkReadCoercion` 同族，同形且同样是死 cast）

**零运行时改动，零新增逃逸口**——只删不加，全程未引入任何 `as any` / `as unknown as` / `@ts-expect-error` / `as never`。三个包 typecheck 全绿：这些 cast 每一个都是死的，替身与真实驱动的形状本来就一致，被抹掉的只是**说出这件事**的能力。

代价原本是休眠的，也正因为休眠才值得修：哪天某个驱动少掉替身要求的一个方法、或替身自身长出新成员，10 个调用点一个都不会红，`checkDateBucketParity` 会在运行期抛 `driver.aggregate is not a function`，而不是在 `tsc` 里被拦下。对仓外驱动作者而言，这个替身是他们唯一能对照的形状说明书，而说明书此前从不校验。
