# Studio task benchmark — sessions with real low-code authors

A protocol for **3–5 moderated sessions** in which a real low-code author runs
[the same scenario](./SCENARIO.md), thinking aloud, scored on [the same sheet](./SCORESHEET.md)
by [the same rules](./SCORING.md). The agent baseline says what the product allows; these
sessions say how long it takes a person and where a person gets lost. The maintainer recruits
the participants; everything they need is on this page.

## Participants

- **Who:** people who build business apps in a low-code tool today (Salesforce admin, Airtable,
  Power Apps, a similar product). Not ObjectStack developers, not anyone who has used Studio
  before — a second session with the same person measures memory, not the product.
- **How many:** 3 minimum, 5 maximum. Five sessions find most of the problems a task like this
  has; past five, the same problems repeat.
- **Recorded as** a participant code (`P1`…`P5`) only. No names, employers or faces go into the
  repository.

## Before the session (moderator, ~20 min)

1. Boot a **fresh** environment exactly as in SCENARIO.md → *Environment*, one per participant —
   never reuse a database another participant has touched. Record both SHAs on the sheet.
2. Mint the end-user identity (SCENARIO.md → *Environment*) and keep its password ready for step 8.
3. Sign the participant's browser in as the admin, open `/_console/`, and stop there. Start
   screen and audio recording only with the participant's consent.
4. Have the **task card** below printed or on a second screen. The participant may re-read it at
   any time.
5. Open the browser's network log (or a HAR recorder) on the moderator side, to count failed
   writes afterwards.

## Task card (read to the participant, and leave it with them)

> You run the repair desk of a building-maintenance company. Using this tool and **without
> writing any code**, build a small app for repair tickets:
>
> 1. Create a package called **Repair Center**.
> 2. Add a **Repair Ticket** with: a name; a status that can be *New*, *In Progress* or *Done*;
>    a due date; a problem description (longer text); and the technician responsible (one of the
>    system's users).
> 3. Arrange the ticket form into sections.
> 4. Make sure nobody can mark a ticket *Done* without a due date.
> 5. When a ticket becomes *Done*, the technician should get a notification.
> 6. Give people an app where they can find the tickets.
> 7. Make it live.
> 8. Then sign in as the end user we give you, create a ticket, mark it *Done*, and check that
>    the notification arrived.
>
> Please think aloud the whole time — say what you are looking for, what you expect to happen,
> and what surprises you. There are no wrong answers: we are testing the tool, not you.

The card deliberately uses **no product vocabulary** — not "object", "picklist", "lookup",
"flow", "validation rule" or "publish". Whether the author finds those concepts from task words
is part of what is measured. ⛔ Do not translate the card into product terms when a participant
is stuck.

## During the session (45 min cap)

- **Moderator speech is limited to:** reading the card; "please keep talking"; "what are you
  looking for?"; "what did you expect?". Never point at the screen, name a menu, or confirm that
  something worked.
- **Assist only to unblock**, and only after 3 minutes without progress on a step, or when the
  participant asks to give up on it. An assist is a **dead end for that step** in this session's
  sheet, with what the participant tried and what the assist was. Then let them continue — later
  steps are still worth measuring.
- **Time-box:** 45 minutes for steps 1–8. Steps not reached are `not-reached`, not failures.
- **Observer notes** (a second person if available), timestamped, per step: hesitations over
  ~20 s, wrong turns, words the participant used for things the product names differently, every
  red message read aloud or ignored.

## Scoring after the session

Fill in one [SCORESHEET.md](./SCORESHEET.md) per participant from the recording, the observer
notes and the network log:

- **Time** per step, from the recording — first gesture towards the step to the moment the
  result is in place; confirm completion server-side afterwards with each step's oracle
  (SCENARIO.md), never only from what the screen showed.
- **Red errors**, **failed writes**, **code-shaped entries**, **dead ends** — exactly as
  SCORING.md defines them. An assist counts as a dead end.
- Add two session-only columns under *Warnings and notes*: **vocabulary misses** (the
  participant's word → the product's word) and **SEQ**, a one-question ease rating the
  participant gives after each step (1 = very difficult … 7 = very easy).

## After all sessions

- One summary next to the agent baseline in [`baselines/`](./baselines/): median and range of
  total time, completion rate per step, the red errors and dead ends that hit **two or more**
  participants, and the five most frequent vocabulary misses.
- Each problem two or more participants hit, that has no card yet, goes to the reviewing seat to
  file — the same cross-reference rule as an agent run.
- Delete the recordings when the summary is written, unless the participant agreed to longer
  retention.

## Kit checklist

- [ ] fresh environment per participant, both SHAs recorded
- [ ] end-user identity minted, password at hand
- [ ] task card printed / on a second screen
- [ ] recording consent obtained
- [ ] network log or HAR recorder running
- [ ] one blank SCORESHEET.md per participant
- [ ] observer briefed on the "assist only to unblock" rule
