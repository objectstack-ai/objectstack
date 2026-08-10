---
'@objectstack/cli': minor
---

**BREAKING (`os cloud login --json` stdout wire shape):** it is now an NDJSON
stream, one compact JSON document per line, and it emits a verification-URL
record it never used to emit at all (#6730).

`os cloud login --json` passed `silent: true` into the device flow and nothing
else. Formally that was impeccable — stdout carried exactly one JSON document
and `JSON.parse(<entire stdout>)` read it. Measured against a live RFC 8628
endpoint, the whole of stdout for an interactive `--json --no-browser` run was:

```
{
  "success": true,
  "email": "user@example.com",
  "userId": "usr_…",
  "url": "https://cloud.objectos.ai"
}
```

The verification URL appeared nowhere — not on stdout, not on stderr. `silent`
suppressed the human-readable print and put nothing in its place, so the one
thing device flow exists to give a script (the URL, while there is still time to
act on it) was withheld from the only caller that cannot ask a human for it. A
consumer received a well-formed document describing an authorization it had no
way to trigger.

`os cloud login --json` is now a **newline-delimited JSON stream**: one compact
document per line, on every path — the device-authorization record, the
`--email`/`--password` result, the already-logged-in notice, and the
`{"success":false,"error":"…"}` failure record alike. The device record is
field-identical to the one `os login --json` emits (#6531), so one consumer
reads both commands.

This is the second and last of the CLI's **declared exceptions** to "`--json`
means exactly one JSON document on stdout" (#6217) — `os login` is the other,
and they are now the same exception rather than two answers to one question.
Both are declared rather than silent: the `--json` flag's `--help` text says so,
and so do the CLI reference page (`os cloud login --json` is NDJSON) and the
cloud publish flow on the deployment page. **Parse this command's stdout line by
line.**

### What breaks, and what to change

Unlike `os login`, whose device-flow output was unparseable in any shape and so
had no consumers to break, `os cloud login --json` worked today. If you consume
it:

- **Interactive/device-flow runs now emit two lines instead of one.**
  `JSON.parse(<entire stdout>)` throws on the second document. Read the stream a
  line at a time and act on the record you care about — the device record is the
  one carrying `verification_uri`, the result the one carrying `success`.
- **Unattended runs are the safest migration and were already correct.**
  `os cloud login --email … --password …` never enters the device flow and still
  emits exactly one record; the only change there is that it is compact rather
  than 2-space indented, which `JSON.parse` reads identically.
- **Exit codes are unchanged**: `1` on a login failure, `0` otherwise.

### Why `minor` and not `patch`

Deliberately not the `patch` #6531/PR #6727 took. That bump rested on "nothing
that previously worked stops working", which was true there — the output was
unreadable before. It is false here: a single-document reader of
`os cloud login --json` works today and stops working on the device-flow path.
The bump follows the wire shape, not the size of the diff.

`major` is not the alternative: every publishable package versions in lockstep,
so during the launch window a breaking change ships as `minor` by convention and
`scripts/check-changeset-no-major.mjs` enforces it. `minor` is therefore the
highest bump this change can carry, and the disclosure above — not the number —
is what has to do the work of warning a consumer.

<!-- adr-0087: not-required (no-migration-prescription) what changes is one CLI command's stdout STREAM shape. No authorable key, no exported symbol and no stored value moves: `packages/spec` is untouched, no metadata schema gains or loses a key, and nothing an app authored or persisted becomes invalid or unparseable — so `objectstack migrate meta` has nothing to convert and neither `spec-changes.json` nor the generated upgrade guide has anything to carry. The consumer action prescribed above is rewriting a SCRIPT that reads this command's stdout (parse line by line instead of one `JSON.parse`), which is a channel the ADR-0087 ledger does not serve at all; the channels that do reach those readers are this changeset's own CHANGELOG text, the `--json` `--help` line, and the CLI reference page — all three shipped with this change. -->

