---
---

chore(scripts): watch npm for the stable release that retires a prerelease pin (#5024)

`pnpm-workspace.yaml` pins the better-auth family to `1.7.0-rc.2` (scim to
`1.7.0-rc.1`) and promises, in a comment, to "revert to a stable `^1.7.x` line
the moment one ships". #3002 and #3653 are both gated on that event and nothing
watched for it — the promise had no producer.

`scripts/check-prerelease-pin-watch.mjs` is that producer, run nightly by
`.github/workflows/prerelease-pin-watch.yml`. Its watch list is derived from the
pins themselves (every override whose target is a prerelease), so it cannot drift
from the file it polices and it retires itself when the last prerelease pin goes
stable. The trigger is semver — a version with no prerelease segment at or above
the pinned base — never the `latest` dist-tag, which today still sits on 1.6.26
while the 1.7 line publishes release candidates. Tooling only; no runtime or
authorable surface changes.
