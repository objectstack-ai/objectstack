---
'@objectstack/cli': minor
---

`os environments list | show | create | bind | switch` run on the `os cloud login` session

Clause-②: yes (widening)

The documented hosted flow is `os cloud login`, then `os environments create`. The five
`os environments` subcommands read only `~/.objectstack/credentials.json` (the `os login`
session), so with only `~/.objectstack/cloud.json` they exited 1 with
`Authentication required` before sending any request, while `os login --help` sends hosted
users to `os cloud login`.

All five now choose their session in one shared resolver:

- With no `--url` / `OS_CLOUD_URL`, they use the `os login` session when there is one, which
  is the same behaviour as before. Otherwise they use the `os cloud login` session and the URL
  it recorded.
- With a `--url`, they use the session whose file names that server, `credentials.json` first.
  When neither file names it, they use `credentials.json`'s session as before. The cloud token
  is never sent to a URL other than its own.
- The active environment sent with each request comes from the chosen session's file.
  `os environments switch` and `create --activate` no longer write a cloud environment id into
  `credentials.json` when they ran on the cloud session.

With no session at all, the `Authentication required` message now names `os cloud login` as
well as `os login`. `os package publish` is unchanged: it still reads only `cloud.json`.
