---
---

ci(release): unblock the two gates that fail every `chore: version packages` PR (#4894)

Both failures on #4422 were the gates themselves, not the release PR's content,
and both recur on every release PR.

**`Check Changeset` was structurally unsatisfiable for the release PR.** The
gate counts changesets a PR *adds* (`git diff --diff-filter=A` against the base)
— the right question for an ordinary PR, and the fix #3373 landed after a global
`find | wc -l` proved unable to ever go red in RC mode. But the Changesets
release PR is the *consuming* side: it applies pending changesets into versions
and CHANGELOGs and adds none, by construction. Nobody labels a bot-authored PR
`skip-changeset`, so the release sat blocked on a check that could only be red.
`changeset-release/main` is now exempt at the job level, pinned to the bot author
as well as the branch name so a hand-pushed branch of that name cannot borrow the
exemption.

**`Scaffold E2E` skewed the protocol major against itself during an RC window.**
The install step already falls back to `latest` when the repo's version is not
yet published (`@objectstack/cli@^17.0.0-rc.2` → ETARGET → retry as `latest`).
That fallback rewrote the generated project's dependencies but not its manifest,
and the template stamps the repo's protocol major (`engines: { protocol: '^17' }`,
written at version time by `sync-template-versions.mjs`) while `latest` still
pointed at 16.x. The ADR-0087 D1 handshake then correctly refused to boot the
artifact — the gate working, on a skew the step had introduced:

```
✗ package 'e2e-app' targets protocol ^17 (engines.protocol) but this runtime is
  protocol 16.0.0
```

The fallback now re-stamps `engines.protocol` to the major actually installed,
read off `node_modules/@objectstack/spec` (`PROTOCOL_VERSION` is kept in lockstep
with that package's own major, asserted by `protocol-version.test.ts`), and logs
a `::notice` so the run's true protocol is visible rather than silently rewritten.
It is confined to the fallback branch: on the normal path the project installs
the repo's own version, the majors agree by construction, and a template stamping
the wrong major must still fail — which is what `template-consistency.test.ts` is
for. Re-stamping happens before `npm run build`, so the artifact and the Docker
image (already pinned to the resolved CLI version by the same reasoning) stay in
step.

CI configuration only; releases nothing.
