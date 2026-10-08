# Studio task benchmark — the fixed scenario

**Build a repair-ticket app with no code.** One script, run unchanged every release, so the
numbers compare. ⛔ Do not reword, reorder or extend a step between runs: a changed script is a
new benchmark and its first run is a new baseline, recorded as such in [`baselines/`](./baselines/).

Scoring rules live in [SCORING.md](./SCORING.md); the sheet a run fills in is
[SCORESHEET.md](./SCORESHEET.md); the human-author protocol is [USER-SESSIONS.md](./USER-SESSIONS.md).

## Environment (every run)

| what | value |
|---|---|
| app | `examples/app-showcase`, a **fresh** boot — empty database, nothing left from an earlier run |
| boot | `OS_PORT=PORT pnpm -C ABS/examples/app-showcase exec objectstack dev --ui --seed-admin -p PORT -d file:/tmp/RUN/data.db` (the dogfood-verification §0 line; `OS_PORT` exported, not only `-p`) |
| console | the vendored build at the `.objectui-sha` pin (`pnpm objectui:build`), served at `/_console/` — **never** an objectui HEAD dev server: the benchmark measures what users get |
| author | the seeded platform admin `admin@objectos.ai` / `admin123`, signed in through the form |
| end user | a second identity minted by admin create (`POST /api/v1/auth/admin/create-user`, then `change-password`), or by invite + sign-up — a stock showcase refuses self-registration |
| browser | Chromium at 1440×900 |

Record both SHAs before step 1: `git rev-parse HEAD` of the objectstack tree you booted, and the
contents of `.objectui-sha` (cross-check `packages/console/dist/.objectui-sha` — `os dev` refuses
to mount a console whose stamp differs).

## The rules of the run

- **No code.** The author works only in the console. A step that can be finished only by
  writing a file, calling an API by hand, or running a CLI command is a **dead end** for that
  step (SCORING.md). Typing JSON, CEL or a machine name into a console field is allowed but
  **counted** — it is the thing the benchmark exists to drive to zero.
- **The clock.** A step starts when the author begins it (first click towards it) and stops when
  its result is **verified server-side** with the oracle in the table below — a REST read of the
  draft, the published metadata or the record, never the UI alone. A step the author abandons
  stops the clock at abandonment and is scored as a dead end.
- **Errors.** Every red banner, red toast or red inline error box the author sees is logged with
  its verbatim text, the step, and whether the author caused it (a wrong input) or the product
  showed it on a valid intermediate state. Every 4xx/5xx answer to a draft write or a publish
  write is logged with method, path, status and error code (read from the browser's network log).
- **No retries off the clock.** Re-doing a step after an error is part of that step's time.

## The steps

Machine names below are what a run *expects the console to derive*; the author never has to type
them. If the console makes the author type one, that is a counted machine-name entry.

| # | step | what "done" means | server-side oracle |
|---|---|---|---|
| 1 | Create package **Repair Center** | a writable package exists, owned by the author's org | `GET /api/v1/packages` lists it (read the id the console derived) |
| 2 | Object **Repair Ticket** with fields **Name** (text), **Status** (picklist: New / In Progress / Done), **Due Date** (date), **Problem Description** (long text), **Technician** (lookup → user) | the object draft carries all five fields with those types and the three picklist options | the object's draft read back through the drafts API, or (after step 7) `GET /api/v1/meta/object/OBJECT` |
| 3 | **Group the form** — at least two sections (e.g. *Ticket* with Name / Status / Due Date / Technician, *Details* with Problem Description) | the object's form layout declares the sections | the form view/layout draft read back |
| 4 | Validation **"Due date required when Done"** | a validation rule that refuses `status = Done` with an empty due date, with a readable message | the rule in the object draft; after step 7, a forged create with `status=done` and no due date answers 4xx with the rule's message |
| 5 | Automation **"Notify the technician when Done"** | a record-triggered flow on Repair Ticket, firing when Status becomes Done, whose notify step addresses the Technician field | the flow draft read back: trigger object, condition, notify recipients |
| 6 | An **app with navigation** — an app *Repair Center* whose nav reaches the Repair Ticket list | an app definition with a nav item for the object | the app draft read back; after step 7 `GET /api/v1/meta/app` lists it |
| 7 | **Publish** | every draft from steps 2–6 is live | `GET /api/v1/meta/object/OBJECT`, the flow, the app — all answer with the published shape |
| 8 | **As the end user**: open the app, create a ticket (assign the Technician), move it to **Done**, see the notification arrive | the record exists in status Done; the technician has an inbox message for it | `GET /api/v1/data/OBJECT/ID`; a `sys_inbox_message` row whose recipient is the technician (read as the technician) |

Step 8's notification is the end-to-end proof that steps 4–7 composed: the validation must let a
ticket with a due date through, the flow must fire on the status change, and the recipient must
resolve from the lookup. The end user assigns **themselves** as the Technician, so the notification
lands in the inbox of the person driving step 8.

The script deliberately names **no access step**. A low-code author expects a published app to
work for its users; if the end user is refused, the author grants access where they find it, and
the run scores it as rework (SCORING.md, *Rework the script does not name*) with the refusal
classed `missing-step`. ⛔ Do not add the grant to the script to make step 8 pass.

## What a run hands back

One filled [SCORESHEET.md](./SCORESHEET.md) copy, committed under [`baselines/`](./baselines/)
when it is a baseline (the first run of a release), named
`YYYY-MM-DD-OBJECTSTACKSHA8-OBJECTUISHA8.md`. Every red banner and dead end in it carries a card
reference — an existing card, or one filed by the seat that reviews the run.
