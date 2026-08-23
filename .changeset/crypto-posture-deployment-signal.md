---
"@objectstack/service-settings": minor
---

**Security:** `LocalCryptoProvider` selects its crypto posture from the deployment signal only. A test-runner variable inherited by a spawned server can no longer disarm the production key refusal (#11352).

`detectMode` read `env.VITEST` as a vote for `'test'` posture:

```ts
if (env.VITEST || env.NODE_ENV === 'test') return 'test';
```

`'test'` is not a softer flavour of `'production'`. It is the branch that takes an ephemeral key, never touches disk, and **never refuses to boot** — and that refusal is the reason the class exists: minting a key at boot makes every previously-written `sys_secret` value (encrypted settings, `secret` fields, datasource credentials) undecryptable after the next restart or on another node, invisibly at encrypt time. So one runner variable decided whether a security gate ran at all.

Runner variables are **inherited**. Vitest sets `TEST`, `VITEST`, `VITEST_MODE`, `VITEST_WORKER_ID` and `VITEST_POOL_ID` on its worker, and every process that worker spawns with `{ ...process.env }` receives them. Measured on this repo: a real `os serve` spawned that way booted with production auth and **test** crypto. `packages/cli/test/serve-node-env-production-default.e2e.test.ts` — a pin whose entire subject is *"unset `NODE_ENV` means production"* — ran that way for its whole life, and nothing said a word, because a gate that does not run prints nothing. It surfaced only incidentally, while closing the sibling `TEST` leak into better-auth's origin check one layer down.

**What changes for you.** A process that boots with `NODE_ENV=production`, no `OS_SECRET_KEY`/`OS_DEV_CRYPTO_KEY`, no persisted key file, no `OS_CRYPTO_AUTOKEY` — and a runner variable in its environment — now **refuses to start** instead of running on an ephemeral key. That is the documented fail-loud guarantee arriving where it was previously skipped, not a new restriction: supply the key the refusal names.

```
OS_SECRET_KEY=$(openssl rand -hex 32)
```

**What does not change.** In-process unit tests still get `test` posture — ephemeral key, disk never touched. The `VITEST` read is deleted rather than narrowed because vitest sets both variables on the same worker (`prepareVitest()`: `process.env.VITEST = "true"; process.env.NODE_ENV ??= "test";`, repeated as `NODE_ENV: process.env.NODE_ENV || "test"` in each worker's env). In-process the two spellings are indistinguishable; they differ only for an **inheriting child**, which is precisely the defect. `NODE_ENV` remains the one signal, and a deployment that declares itself a test deployment still gets test posture.

The whole class is now gated: `pnpm check:runner-env-posture` refuses `TEST`, `VITEST`/`VITEST_*` and `JEST_WORKER_ID` anywhere in product source, so the next author is told at authoring time rather than by an operator whose secrets stopped decrypting. `NODE_ENV` is deliberately not banned — it describes the deployment, and a deployment may declare itself a test deployment; a runner may not declare it on the deployment's behalf.
