---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(console): a screen-flow step the run already left is never submitted again

Clause-②: no
Metadata-protocol: none

The console's screen-flow dialog no longer resends a step after the run has moved on. Before, a resume could finish on the server while its answer was lost on the way back: a gateway timed out, or the connection dropped. The dialog then kept the step with Next still active. The next press sent that step's values to the screen the run was now on, and the user saw the engine's English refusal, which names the fields. A two-step quote wizard showed this failure after the quote had already been created.

Before it offers a retry, the dialog now reads the run's paused screen again (`GET /api/v1/automation/FLOW/runs/RUN/screen`). This happens when no answer arrives, and on every failure the dialog would treat as retryable:

- If the run waits on another screen, the dialog shows that screen with a plain notice: "Your previous submission went through. The flow has moved on to this step."
- If the run waits on no screen (`404`), Next is withdrawn and a plain notice asks the user to check the record before trying again.
- If the run still waits on the same screen, or the read gives no usable answer, the retry and the refusal's sentence stay as before.

Both notices come from the console catalog (`flowRunner.alreadySubmitted` and `flowRunner.noLongerWaiting`) in every shipped locale. The engine's refusal is unchanged. Nothing to migrate.
