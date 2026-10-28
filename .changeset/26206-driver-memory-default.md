---
'@objectstack/driver-memory': patch
---

fix(driver-memory)!: retire the legacy `default` export, which a CommonJS `require()` could not reach as its types described

The package entry exported a legacy `{ id, version, onEnable }` object as its `default`. It is not a kernel plugin (the kernel contract is `init` / `start` / `destroy`), and the CommonJS build could only put it on `require('@objectstack/driver-memory').default`, while the published declarations said `export default` (`@arethetypeswrong/cli` reported `FalseExportDefault`). It leaves the published entry. Every named export stays. Nothing in this repository imported the default, and no example, scaffold template, doc page or skill names the package as a string entry of a stack's `plugins` array.

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (runtime-export-retired @objectstack/driver-memory#default) One runtime object leaves a published package entry; no key of any metadata schema, no object definition and no stored shape is added, removed, renamed or re-shaped, so there is nothing for `objectstack migrate meta` to rewrite and no tombstone. A TypeScript consumer meets the break at its own import, and the line below names the door to use instead. -->

**BREAKING** (a runtime export is removed). It ships as `patch` because the metadata protocol does not move. There is no staged window.

- FROM `default` TO `new DriverPlugin(new InMemoryDriver(), 'memory')` from `@objectstack/runtime`, or `new InMemoryDriver()` handed to whatever registers your drivers.

A stack config that names `'@objectstack/driver-memory'` as a string entry of `plugins` loaded that object and registered an `InMemoryDriver` through it. After this change that entry loads the module without a default and registers no driver, so put `new DriverPlugin(new InMemoryDriver(), 'memory')` in the `plugins` array instead.
