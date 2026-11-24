// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Session-less HTML for the actionable-link confirm/result pages (ADR-0043).
 *
 * Deliberately tiny and dependency-free: these pages are reached from an
 * email or IM message by a bearer with no session, so they must not assume
 * the Console bundle, auth state, or client-side i18n. Static bilingual
 * (EN / 中文) copy keeps them readable for the demo audience without a
 * locale negotiation step.
 *
 * The GET page NEVER mutates — the decision happens only on the POST form
 * submit (mail-gateway link prefetchers must not approve requests).
 */

import type { ApprovalRequestRow, ApprovalActionKind } from '@objectstack/spec/contracts';

function esc(s: unknown): string {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  body{font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;
       background:#f6f7f9;color:#1a202c;margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;max-width:440px;width:calc(100% - 32px);
        padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  h1{font-size:18px;margin:0 0 4px}
  .sub{color:#64748b;font-size:13px;margin:0 0 20px}
  .row{display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:14px}
  .row b{font-weight:600;text-align:right}
  .k{color:#64748b}
  .actions{margin-top:22px;display:flex;gap:10px}
  button{flex:1;padding:10px 16px;border-radius:8px;border:1px solid transparent;font-size:15px;font-weight:600;cursor:pointer}
  .approve{background:#059669;color:#fff}
  .reject{background:#fff;color:#dc2626;border-color:#fca5a5}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:600;margin-bottom:14px}
  .ok{background:#ecfdf5;color:#047857}.warn{background:#fffbeb;color:#b45309}.err{background:#fef2f2;color:#b91c1c}
  a{color:#2563eb;text-decoration:none}
  .foot{margin-top:18px;font-size:12px;color:#94a3b8}
  label{display:block;margin-top:18px;font-size:14px;font-weight:600}
  textarea{display:block;box-sizing:border-box;width:100%;min-height:88px;margin-top:6px;padding:8px 10px;
           border:1px solid #cbd5e1;border-radius:8px;font:inherit;resize:vertical}
  .refusal{margin:14px 0 0;padding:8px 12px;border-radius:8px;background:#fef2f2;color:#b91c1c;font-size:14px}
</style></head><body><div class="card">${body}</div></body></html>`;
}

/**
 * The request summary both pages show.
 *
 * [#23594] The record is named by its id, never by its title. A subject title
 * is served only to a reader who may read the field it comes from, narrowed by
 * that reader's field-level security exactly as the payload snapshot is
 * (#10749). These pages have no reader to narrow for: the bearer carries a
 * token, not a session, and the token chain reads the request under the system
 * context, which field-level security does not narrow. So no subject field is
 * shown here — the record is named by the object's label and the record's id.
 *
 * [#26181, 2026-10-27] The notification surfaces were re-ruled (ruling A′):
 * an approval notification is rendered for one named recipient, so it names
 * the record by its title as that recipient may read it, else its id
 * (`ApprovalService.subjectNamesFor`). These pages keep the id: the reason
 * above, no reader to narrow for, still holds here.
 */
function summaryRows(req: ApprovalRequestRow): string {
  const rows: Array<[string, string]> = [
    ['Process · 流程', req.process_label || req.process_name],
    ['Step · 步骤', req.step_label || req.current_step || '—'],
    ['Record · 记录', req.record_id],
    ['Object · 对象', req.object_label || req.object_name],
    ['Requester · 申请人', req.submitter_name || req.submitter_id || '—'],
  ];
  return rows.map(([k, v]) => `<div class="row"><span class="k">${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
}

/**
 * The refusal a reject link's confirm page shows when its form came back with
 * no reason. A reject carries its reason on every door (`ApprovalService.decide`);
 * this door asks the approver for one on the page instead of recording a fixed
 * text, and a blank one leaves the link live so the approver can try again.
 */
export const REJECT_REASON_REQUIRED_COPY = 'Enter a reason to reject this request. · 驳回需填写驳回理由。';

/**
 * GET page: summary + a POST form. Rendering only — no mutation.
 *
 * A reject form carries a required `comment` field, the reason the decision
 * records (`redeemActionToken`); an approve form carries none and keeps its
 * one button. `refusal: 'reason_required'` is the same page answered again
 * after a reject form came back with a blank reason.
 */
export function renderConfirmPage(input: {
  request: ApprovalRequestRow;
  action: Extract<ApprovalActionKind, 'approve' | 'reject'>;
  approverId: string;
  token: string;
  actPath: string;
  refusal?: 'reason_required';
}): string {
  const approving = input.action === 'approve';
  const verb = approving ? 'Approve · 通过' : 'Reject · 驳回';
  const tokenField = `<input type="hidden" name="token" value="${esc(input.token)}">`;
  const button = `<button type="submit" class="${approving ? 'approve' : 'reject'}">${verb}</button>`;
  const form = approving
    ? `<form method="post" action="${esc(input.actPath)}" class="actions">
      ${tokenField}
      ${button}
    </form>`
    : `<form method="post" action="${esc(input.actPath)}">
      ${tokenField}
      <label for="comment">Reason for rejecting · 驳回理由</label>
      <textarea id="comment" name="comment" required></textarea>
      ${input.refusal === 'reason_required' ? `<p class="refusal" role="alert">${esc(REJECT_REASON_REQUIRED_COPY)}</p>` : ''}
      <div class="actions">${button}</div>
    </form>`;
  return shell(`${verb} — Approval`, `
    <h1>${approving ? '✅ Approve this request?' : '⛔ Reject this request?'}</h1>
    <p class="sub">${approving ? '确认通过该审批请求？' : '确认驳回该审批请求？'}
      Acting as · 操作身份：<b>${esc(input.approverId)}</b></p>
    ${summaryRows(input.request)}
    ${form}
    <p class="foot">This link is single-use and expires automatically. · 此链接一次有效，过期自动失效。</p>`);
}

const RESULT_COPY: Record<string, { cls: string; title: string; body: string }> = {
  approved:     { cls: 'ok',   title: '✅ Approved · 已通过',  body: 'The decision was recorded. · 审批结果已记录。' },
  rejected:     { cls: 'ok',   title: '⛔ Rejected · 已驳回',  body: 'The decision was recorded. · 审批结果已记录。' },
  invalid:      { cls: 'err',  title: 'Invalid link · 链接无效', body: 'This link is not recognized. · 无法识别该链接。' },
  expired:      { cls: 'warn', title: 'Link expired · 链接已过期', body: 'Ask the requester to send a new reminder. · 请让申请人重新发送催办。' },
  consumed:     { cls: 'warn', title: 'Already used · 链接已使用', body: 'This link was already used once. · 该链接已被使用过。' },
  not_pending:  { cls: 'warn', title: 'Already decided · 请求已处理', body: 'This request is no longer pending. · 该请求已不在待审批状态。' },
  not_approver: { cls: 'warn', title: 'No longer your approval · 已不在你名下', body: 'This approval was handed to someone else. · 该审批已转由他人处理。' },
};

/** The Console's approvals inbox route, relative to the Console's mount. */
export const APPROVALS_INBOX_PATH = '/system/approvals';

/**
 * Terminal page for every redemption outcome (and stale GETs).
 *
 * [#34862] `inboxHref` is the Console's inbox as the caller links it: under
 * the Console's mount (`consolePageLink`), which this page cannot know. It
 * defaults to the bare route.
 */
export function renderResultPage(
  kind: keyof typeof RESULT_COPY,
  request?: ApprovalRequestRow,
  inboxHref: string = APPROVALS_INBOX_PATH,
): string {
  const copy = RESULT_COPY[kind] ?? RESULT_COPY.invalid;
  return shell(copy.title, `
    <span class="badge ${copy.cls}">${esc(copy.title)}</span>
    ${request ? summaryRows(request) : ''}
    <p>${esc(copy.body)}</p>
    <p class="foot"><a href="${esc(inboxHref)}">Open the Approvals Inbox · 打开审批中心</a></p>`);
}
