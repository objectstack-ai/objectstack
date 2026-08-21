---
"@objectstack/plugin-hono-server": patch
---

docs(plugin-hono-server): boot the kernel with the method it actually ships (#9870)

`packages/plugins/plugin-hono-server/README.md` is in the package's `files` array
with `private` unset, so it is the page npm renders. Its Usage block ended:

```ts
const kernel = new ObjectKernel();
kernel.use(new HonoServerPlugin({ port: 3000, /* … */ }));
await kernel.start();
```

Measured against the built type surface: `ObjectKernel` (re-exported by
`@objectstack/runtime` from `@objectstack/core`) declares `bootstrap()` and
`shutdown()` and has **no** `start` member. A reader copying the block gets a
compile error on its last line.

The line reads plausibly because the `IKernel` *interface* in
`@objectstack/types` does declare `start()` — but the concrete class the fence
constructs does not implement that name, and eight sibling READMEs
(`objectql`, `rest`, `runtime`, `service-cache`, `service-job`,
`service-automation`, `service-package`, `service-cluster-redis`) all spell the
same step `await kernel.bootstrap()`. Fixed to match.

Found by the call-site widening in the same PR, not by hand: the receiver is
never import-bound, so before that widening this call site was one of the 262
`check:published-readme-exports` could not read.
