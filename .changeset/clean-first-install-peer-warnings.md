---
"create-objectstack": patch
"@objectstack/cli": patch
---

**First-run polish:** a brand-new scaffold's very first `pnpm install` no longer reports two unmet peer dependencies (#10326).

Reproduced on a clean scaffold from published `create-objectstack@17.1.0` — no lockfile, `node_modules` removed, nothing configured by the user — and again on the second scaffold path, `objectstack init`. Both printed the same two:

```
✕ unmet peer better-call
  Installed: 1.4.0
  Wanted:
    1.3.7:
      @better-auth/scim@1.7.0-rc.1

✕ unmet peer better-sqlite3
  Installed: 13.0.3
  Wanted:
    ^12.0.0:
      better-auth@1.7.1
```

Nothing was broken — but it is the first screen a newcomer sees, and there is nothing they did to cause it or can do about it.

**`better-sqlite3`: the pin is right and the upstream range is stale — so it is widened, not corrected.** better-auth 1.7.1 declares `better-sqlite3` as an **optional** peer at `^12.0.0`, and it governs exactly one configuration: a raw better-sqlite3 `Database` handed to better-auth's `database` option, which its Kysely dialect then drives. ObjectStack never takes that path — `AuthManager.createDatabaseConfig()` returns `createObjectQLAdapterFactory(dataEngine)`, and every `better-sqlite3` use under `plugin-auth` is knex's `client: 'better-sqlite3'` beneath ObjectQL. Measured anyway on the configuration the range *does* govern: better-auth 1.7.1 with `database: new Database(':memory:')`, running `getMigrations().runMigrations()`, `signUpEmail`, `signInEmail` and adapter `findOne`/`update`/`delete`, is green on **better-sqlite3 13.0.3** and byte-for-byte equivalent on **12.11.1**. The same probe with `Database.prototype.prepare` neutered fails, so that green is the driver's and not an unexercised path. Pinning our own `^13.0.3` declarations back to `^12` would downgrade a native module across the platform to satisfy a range measurement shows is simply behind.

**`@better-auth/scim`: the rc pin stays, and one `better-call` copy is the correct tree.** `npm view @better-auth/scim dist-tags` reads `latest: '1.7.1'`, but stable 1.7.x ships the rc.2 whole-model rewrite, so adopting it is a separate migration rather than a version bump; the exact `1.7.0-rc.1` pin is deliberate. The rc peers an exact `better-call@1.3.7` while better-auth 1.7.1 depends on `1.4.0` — and a better-auth plugin has to share the **host's** better-call instance, so the single 1.4.0 copy every install already resolves is right, not a skew to repair. This declaration retires together with the rc pin.

**What changed, and what deliberately did not.** Both remedies are pnpm `peerDependencyRules.allowedVersions` entries, scoped `<declaring package>><peer>` so each widens exactly one declaration. They ship *inside* the scaffold — the bundled `pnpm-workspace.yaml` template and the one `objectstack init` renders — because a block in this repo's own workspace file does not travel with published packages. `allowedVersions` changes what pnpm **reports**, never what it resolves: measured on both scaffold paths, the lockfile is byte-identical with and without it (0 lines of diff), and no dependency version, range or resolution moved anywhere. This repo's own resolutions are untouched.
