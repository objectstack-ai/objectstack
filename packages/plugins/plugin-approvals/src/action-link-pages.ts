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
 * shown here — the record is named the way the approval notification names it,
 * by the object's label and the record's id.
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

/** GET page: summary + a POST form. Rendering only — no mutation. */
export function renderConfirmPage(input: {
  request: ApprovalRequestRow;
  action: Extract<ApprovalActionKind, 'approve' | 'reject'>;
  approverId: string;
  token: string;
  actPath: string;
}): string {
  const approving = input.action === 'approve';
  const verb = approving ? 'Approve · 通过' : 'Reject · 拒绝';
  return shell(`${verb} — Approval`, `
    <h1>${approving ? '✅ Approve this request?' : '⛔ Reject this request?'}</h1>
    <p class="sub">${approving ? '确认通过该审批请求？' : '确认拒绝该审批请求？'}
      Acting as · 操作身份：<b>${esc(input.approverId)}</b></p>
    ${summaryRows(input.request)}
    <form method="post" action="${esc(input.actPath)}" class="actions">
      <input type="hidden" name="token" value="${esc(input.token)}">
      <button type="submit" class="${approving ? 'approve' : 'reject'}">${verb}</button>
    </form>
    <p class="foot">This link is single-use and expires automatically. · 此链接一次有效，过期自动失效。</p>`);
}

const RESULT_COPY: Record<string, { cls: string; title: string; body: string }> = {
  approved:     { cls: 'ok',   title: '✅ Approved · 已通过',  body: 'The decision was recorded. · 审批结果已记录。' },
  rejected:     { cls: 'ok',   title: '⛔ Rejected · 已拒绝',  body: 'The decision was recorded. · 审批结果已记录。' },
  invalid:      { cls: 'err',  title: 'Invalid link · 链接无效', body: 'This link is not recognized. · 无法识别该链接。' },
  expired:      { cls: 'warn', title: 'Link expired · 链接已过期', body: 'Ask the requester to send a new reminder. · 请让申请人重新发送催办。' },
  consumed:     { cls: 'warn', title: 'Already used · 链接已使用', body: 'This link was already used once. · 该链接已被使用过。' },
  not_pending:  { cls: 'warn', title: 'Already decided · 请求已处理', body: 'This request is no longer pending. · 该请求已不在待审批状态。' },
  not_approver: { cls: 'warn', title: 'No longer your approval · 已不在你名下', body: 'This approval was handed to someone else. · 该审批已转由他人处理。' },
};

/** Terminal page for every redemption outcome (and stale GETs). */
export function renderResultPage(kind: keyof typeof RESULT_COPY, request?: ApprovalRequestRow): string {
  const copy = RESULT_COPY[kind] ?? RESULT_COPY.invalid;
  return shell(copy.title, `
    <span class="badge ${copy.cls}">${esc(copy.title)}</span>
    ${request ? summaryRows(request) : ''}
    <p>${esc(copy.body)}</p>
    <p class="foot"><a href="/system/approvals">Open the Approvals Inbox · 打开审批中心</a></p>`);
}
