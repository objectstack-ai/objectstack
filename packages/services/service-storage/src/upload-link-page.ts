// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomBytes } from 'node:crypto';
import type { IHttpResponse } from '@objectstack/spec/contracts';
import type { UploadLinkView } from './record-file-access.js';
import { UPLOAD_LINK_UNUSABLE_MESSAGE } from './upload-link-wire.js';

/**
 * [#30892] The page an upload link opens: one file picker that sends the
 * chosen file back to the same link. Opened by the person the link was made
 * for — on a phone, often — so it is a page, not an API.
 *
 * What it does not do, by design:
 *
 *  - It names no record, field, user or organization. The link's holder is
 *    the person who asked for it, but a link travels (a forwarded message, a
 *    screenshot), so the page says only that a file is wanted and until when.
 *  - It loads nothing. Script and style are inline, admitted by a per-response
 *    nonce in the Content-Security-Policy; every other source is `'none'`,
 *    and the one request it makes is the `PUT` to its own address
 *    (`connect-src 'self'`). No form posts, no framing, no base URL.
 *  - It is never cached, never indexed and never sends a referrer, so the
 *    token in its address stays in the address bar.
 *
 * A used, expired or unknown link gets one page, the same for all three
 * (`404`), so the answer says nothing about which.
 */

/** The response headers every upload-link page carries. */
function pageHeaders(res: IHttpResponse, nonce: string): IHttpResponse {
  const csp =
    `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; ` +
    "form-action 'none'; frame-ancestors 'none'; base-uri 'none'";
  return res
    .header('content-type', 'text/html; charset=utf-8')
    .header('content-security-policy', csp)
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('x-robots-tag', 'noindex, nofollow')
    .header('x-content-type-options', 'nosniff')
    .header('x-frame-options', 'DENY');
}

const STYLE = [
  'body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:24px 16px;color:#1f2328;background:#fff}',
  'main{max-width:28rem;margin:0 auto}',
  'h1{font-size:1.25rem;margin:0 0 .75rem}',
  'p{line-height:1.5;margin:.5rem 0}',
  'label{display:block;margin:1.25rem 0 .5rem;font-weight:600}',
  'input[type=file]{display:block;width:100%;font-size:1rem}',
  'button{margin-top:1rem;font-size:1rem;padding:.6rem 1.2rem;border-radius:6px;border:1px solid #1f6feb;background:#1f6feb;color:#fff}',
  'button[disabled]{opacity:.5}',
  '#status{margin-top:1rem;min-height:1.5em}',
  '.muted{color:#59636e;font-size:.9rem}',
  '@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}.muted{color:#9198a1}}',
].join('');

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function shell(title: string, body: string, nonce: string, script = ''): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    `<title>${escapeHtml(title)}</title><style nonce="${nonce}">${STYLE}</style></head>` +
    `<body><main>${body}</main>${script}</body></html>`
  );
}

/** The script: send the picked file to this page's own address, once. */
const UPLOAD_SCRIPT = [
  '(function(){',
  'var input=document.getElementById("file"),button=document.getElementById("send"),status=document.getElementById("status");',
  'input.addEventListener("change",function(){button.disabled=!input.files||!input.files.length;});',
  'button.addEventListener("click",function(){',
  'var file=input.files&&input.files[0];if(!file)return;',
  'button.disabled=true;input.disabled=true;status.textContent="Uploading\\u2026";',
  'fetch(location.pathname,{method:"PUT",credentials:"omit",cache:"no-store",',
  'headers:{"content-type":file.type||"application/octet-stream","x-file-name":encodeURIComponent(file.name)},body:file})',
  '.then(function(r){return r.json().catch(function(){return null;}).then(function(b){return{ok:r.ok,body:b};});})',
  '.then(function(r){',
  'if(r.ok){status.textContent="Done. The file was attached; you can close this page.";return;}',
  'var m=r.body&&r.body.error&&r.body.error.message;status.textContent=m||"The upload failed.";})',
  '.catch(function(){status.textContent="The upload failed: the connection was lost. Ask for a new link if this one no longer works.";});',
  '});',
  '})();',
].join('');

/** A fresh CSP nonce per response. */
function newNonce(): string {
  return randomBytes(16).toString('base64');
}

/** The picker page for a usable link. */
export function sendUploadLinkPage(res: IHttpResponse, view: UploadLinkView): void {
  const nonce = newNonce();
  const until = new Date(view.expiresAt).toUTCString();
  const what = view.target === 'attachments' ? 'attached to a record' : 'put in a file field of a record';
  const body =
    '<h1>Upload a file</h1>' +
    `<p>A file was asked for, to be ${escapeHtml(what)}. Pick one and send it. ` +
    'This link works once.</p>' +
    `<p class="muted">It stops working at ${escapeHtml(until)}.</p>` +
    '<label for="file">File</label><input id="file" type="file">' +
    '<button id="send" type="button" disabled>Send</button>' +
    '<p id="status" role="status" aria-live="polite"></p>';
  pageHeaders(res, nonce)
    .status(200)
    .send(shell('Upload a file', body, nonce, `<script nonce="${nonce}">${UPLOAD_SCRIPT}</script>`));
}

/** The one page a used, expired or unknown link gets. */
export function sendUnusableUploadLinkPage(res: IHttpResponse, status: number): void {
  const nonce = newNonce();
  const body = `<h1>This link cannot be used</h1><p>${escapeHtml(UPLOAD_LINK_UNUSABLE_MESSAGE)}</p>`;
  pageHeaders(res, nonce).status(status).send(shell('Upload link', body, nonce));
}
