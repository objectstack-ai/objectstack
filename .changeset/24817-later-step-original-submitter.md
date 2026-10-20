---
'@objectstack/plugin-approvals': patch
---

fix(plugin-approvals): every step of a multi-step approval names the person who submitted the run, not the previous step's approver

Clause-②: no

- **What was wrong.** This corrects the unreleased later-step submitter that PR #24527 introduced (an approval decision resumes its flow as the person who decided, `.changeset/24321-resume-as-decider.md`). Because the nodes after a decision now run as the decider, an approval step that opened after another step's decision recorded that decider as its `submitter_id`. On every later step the "I Submitted" list showed the request to the previous approver, recall and resubmit admitted the previous approver and refused the real submitter, and every notice meant for the submitter (`approval.returned`, `approval.request_info`, `approval.sla_breached`, `approval.approved`, `approval.rejected`) went to the previous approver.
- **Now.** Every step of a run records the user who triggered the run as its `submitter_id`, and as the actor of the step's `submit` timeline entry, whoever decided the steps before it. That holds on both `runAs` postures, after any number of decisions by different people, and on a step that a decision node reaches by routing around another. A run whose trigger resolved no user (a schedule, a write that carried no user) opens its later steps with no submitter, as it opens its first one.
- **Unchanged.** The decider still runs the nodes after their decision: their identity, permissions and attribution, as the resume-as-decider change ships them. The first step of every run, and every single-step approval, are unchanged. Compared with the last release nothing moves: later steps named the run's submitter there too, so recall and resubmit on a later step go back to the person they reached before.
- **`ApprovalService.openNodeRequest`.** A caller that passes `submitterId: null` now opens the request with no submitter. Before, `null` fell back to the calling context's user, the same as leaving `submitterId` out, which still falls back.
