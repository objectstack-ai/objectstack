---
"@objectstack/runtime": minor
"@objectstack/cli": minor
---

feat(cli,runtime): `OS_ARTIFACT_URL` — boot a stack from a published artifact by reference (#8368)

`objectstack start` / `serve` can now be pointed at an artifact **by reference**
with a single environment variable, so a fixed runtime image plus one env var is
a running app. Upgrading the app becomes an env change and a restart rather than
an image rebuild — the runtime image and the app artifact become two independent
release axes.

```bash
OS_ARTIFACT_URL=https://cdn.example.com/hotcrm-2.2.2.json                    # fetched at boot
OS_ARTIFACT_URL=file:///srv/app/objectstack.json                            # read directly
OS_ARTIFACT_URL='https://cdn.example.com/hotcrm-2.2.2.json#sha256=<64 hex>'  # content-verified
```

**One variable, not two.** The optional integrity pin is SRI-style and lives
inside the URL **fragment**; there is deliberately no companion
`OS_ARTIFACT_SHA256`. A fragment is client-side by standard and is never sent to
the server, so the pin travels with the reference — one value to copy, one value
to rotate — without changing anything the artifact host sees. A second variable
would make "URL updated, hash not" a reachable state; this shape makes it
unspellable.

**Precedence.** `--artifact` > `OS_ARTIFACT_URL` > `OS_ARTIFACT_PATH` >
`<cwd>/dist/objectstack.json`. Beating `OS_ARTIFACT_PATH` matters in practice:
the official runtime image sets it to `/srv/app/objectstack.json`, so on a
container carrying no app it is always set and always points at a file that does
not exist. `OS_ARTIFACT_URL` also wins over an `objectstack.config.ts` in the
working directory — naming a published artifact is an explicit instruction, and
a deployed app must not depend on which directory the process is standing in.

**What it refuses, and how loudly:**

- **No pin → no verification.** A fetch or read failure fails the boot loudly so
  container orchestration retries. There is no cache-fallback on this path: with
  no pin there is nothing to authenticate a cached copy with.
- **Pin present → verified before boot.** A mismatch refuses and names the
  **expected and the actual** digest, so a republished artifact is
  distinguishable from a substituted one. A fetch failure may fall back to a
  locally cached copy, but only one whose bytes still hash to the pin — the
  cache is re-hashed on every read, so the filename is never the authority — and
  it says so with a loud warning.
- **`engines.protocol` is validated against the runtime** at reference
  resolution, before anything connects, and an incompatible artifact refuses
  with both ways out named (repoint the reference, or run a matching image).
- **Migration policy.** Safe migrations run at boot; a destructive change (the
  `os migrate apply --allow-destructive` class) refuses the boot with an
  operator message naming every change. Never skipped in silence. This applies
  to the artifact-pinned boot only — every other boot keeps the standing
  production policy, under which the schema is never auto-altered.

**Secrets.** The reference may be a pre-signed URL, i.e. the credential *is* the
URL. Nothing downstream of resolution ever sees it: remote bytes are
materialised to a local file under `<home>/artifacts` and the boot continues
against that path, so the URL reaches neither the banner, nor the metadata
service's artifact-source record, nor any log line. Every message this path
produces — including messages originating inside `fetch`, which routinely carry
the whole URL — is scrubbed of userinfo and query material. Userinfo is moved
into an `Authorization: Basic` header, both because `fetch` refuses to construct
a request from a URL carrying credentials and because a credential in the
request line lands in the artifact host's access log.

Materialising the fetched bytes is also what makes the pin mean anything: the
bytes that were hashed are the bytes that boot, and the artifact is fetched
exactly once.

Not included, by design: `OS_PACKAGE_REF` registry resolution, signature
enforcement and entitlements; multi-tenant fleet / hostname routing. Fetching
and booting an artifact is open-framework mechanism — walled tenancy postures
remain entitled through `@objectstack/organizations` regardless of how the
artifact arrives.
