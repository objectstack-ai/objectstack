---
"@objectstack/cli": patch
---

fix(cli): `objectstack serve` resolves the enterprise multi-org runtime from the app, not from the framework (cloud#1013)

Any self-hosted deployment that requested a walled tenancy posture
(`OS_TENANCY_POSTURE=group` or `isolated`, or `OS_MULTI_ORG_ENABLED=1`) refused
to boot:

```
✖ FATAL: tenancy posture 'isolated' was requested but @objectstack/organizations
  could not be loaded, so the organization wall is INACTIVE. Refusing to boot.
  cause: Cannot find package '@objectstack/organizations' imported from …/packages/cli/src/commands/serve.ts
```

…however the package was installed. `serve` loaded it with a **bare**
`import('@objectstack/organizations')`, and Node ESM resolves a bare specifier
against the **importer's own realpath** — the CLI's, inside the framework
workspace it is linked out of. `@objectstack/organizations` ships in the cloud
distribution and lives in the *served app's* `node_modules`, so that import
could never succeed and declaring the dependency in the app changed nothing. The
only way past the ADR-0093 D5 fail-fast was `OS_ALLOW_DEGRADED_TENANCY=1`, i.e.
booting with the organization wall inactive — exactly the state D5 exists to
prevent.

The load now goes through the same host-app resolver `serve` already used for
the AI service packages (`createHostImporter`, extracted to
`src/utils/import-from-host.ts`): resolve from the host app's root, import the
resolved path, and fall back to the CLI's own resolution only for the
framework-owned packages the CLI itself depends on. **Declare
`@objectstack/organizations` in your app's `package.json`** and a walled posture
boots.

Two smaller changes ride along:

- A package the host resolves but that **throws while it loads** now propagates
  its real error instead of being re-imported bare and reported as
  `MODULE_NOT_FOUND` — a broken package used to be misreported as a missing one
  (silently skipped for optional services, or a fatal telling the operator to
  install what was already installed).
- The D5 fatal now names *the app* as the place the package has to go.
