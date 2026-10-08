# Studio task benchmark — score sheet (template)

Copy this file to `baselines/YYYY-MM-DD-OBJECTSTACKSHA8-OBJECTUISHA8.md` (a baseline) or to the
session folder (a human session), then fill it in. Rules: [SCORING.md](./SCORING.md).

## Run

| field | value |
|---|---|
| date (UTC) | |
| run type | agent / human session (participant code only — no names) |
| objectstack commit booted | |
| objectui commit (`.objectui-sha`, and the console stamp) | |
| boot line | |
| browser / viewport | |
| author identity | |
| end-user identity | |
| setup time (boot → signed in) | |

## Headline

```text
completed _/8 · total _ s · _ red errors · _ failed writes · _ code-shaped entries · _ dead ends
```

## Per step

| # | step | result (`completed` / `dead-end` / `not-reached`) | time (s) | red errors | failed writes | code-shaped | oracle evidence |
|---|---|---|---|---|---|---|---|
| 1 | package Repair Center | | | | | | |
| 2 | object Repair Ticket + 5 fields | | | | | | |
| 3 | group the form | | | | | | |
| 4 | validation: due date required when Done | | | | | | |
| 5 | automation: notify technician when Done | | | | | | |
| 6 | app with navigation | | | | | | |
| 7 | publish | | | | | | |
| 8 | end user: create, move to Done, notification arrives | | | | | | |

## Red errors (verbatim)

| n | step | verbatim text | where shown | class | card |
|---|---|---|---|---|---|
| | | | | | |

## Failed writes

| n | step | method · path | status · code | card |
|---|---|---|---|---|
| | | | | |

## Code-shaped entries

| n | step | field | kind (`json` / `cel` / `machine-name`) | card |
|---|---|---|---|---|
| | | | | |

## Dead ends

| n | step | what could not be done in the console | the code path that would finish it | card |
|---|---|---|---|---|
| | | | | |

## Warnings and notes

Non-red observations worth keeping (amber warnings, confusing copy, slow screens). Not scored.
