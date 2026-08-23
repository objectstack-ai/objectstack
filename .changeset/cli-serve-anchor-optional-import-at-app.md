---
"@objectstack/cli": patch
---

fix(cli): `os serve` resolves app-declared optional service packages from the app, not the CWD (#11185)

`serve` takes its config as an **argument**, so `objectstack serve /srv/app/objectstack.config.ts`
is a supported invocation and the app being served need not be the directory the operator
stood in. Every host-anchored optional load nevertheless used `process.cwd()` as its
resolution base, so with that invocation the CLI read the wrong `package.json`: a package the
app really does declare, and really does carry in its own `node_modules`, came back
`undeclared`, fell through to the framework-side fallback, and boot died —

```
Cannot find package '@objectstack/service-cluster': the host app does not declare it.
  host app: /tmp/os-neutral-cwd-jXHXdF        ← the CWD, not the app
  (fallback resolution also failed: Cannot find package '@objectstack/service-cluster'
   imported from …/packages/types/dist/node.mjs)
```

Measured on the released EE 4.1.0 image as `OS_CLUSTER_DRIVER=redis` ⇒ migrate exits 1 ⇒ the
whole stack cannot start. This is the same class as cloud#1013 and #10645 with the base wrong
for a different reason: those fixed the **importer** at these load sites (bare `import()` →
`importFromHost`); this fixes the **base** that importer is handed.

`serve` now resolves the config path and the app root in one call (`anchorServedApp`), so the
anchor cannot be written too late or left out by a future author — the absolute config path
every later line needs is produced by the same call that sets it. Every host-anchored load in
the file defaults to that root, which is what generalises the repair to the next app-declared
optional service rather than fixing this one instance. The alternative route — declaring
`@objectstack/service-cluster*` in `packages/cli`'s own manifest — was rejected: it would make
the open-core CLI take a published dependency on packages it never imports, still leave every
third-party or future optional service broken, and change nothing for an app whose config is
addressed by path.

The adopted root is the config's directory **only when that directory holds a `package.json`**,
and the CWD otherwise. `readHostDeclaration` reads a manifest — reachability is deliberately
not the contract (#4719) — so a directory with no manifest declares nothing and anchoring
there could only turn a working boot into an `undeclared` refusal. No layout that resolves
today resolves differently after this.

The #4719 declaration gate is untouched: a package present in the app's `node_modules` but
absent from its `package.json` is still refused. The refusal's remedy (`host app: …`) now
names the app being served instead of an unrelated directory the operator happened to be in.
