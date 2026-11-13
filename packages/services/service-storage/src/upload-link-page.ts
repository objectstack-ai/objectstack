// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { randomBytes } from 'node:crypto';
import type { IHttpResponse } from '@objectstack/spec/contracts';
import type { UploadLinkView } from './record-file-access.js';
import { formatUploadLinkExpiry, type UploadLinkCopy } from './upload-link-copy.js';
import { UPLOAD_LINK_FORM_HEADER, UPLOAD_LINK_FORM_HEADER_VALUE } from './upload-link-wire.js';

/**
 * [#30892] The page an upload link opens: one file picker that sends the
 * chosen file back to the same link. Opened by the person the link was made
 * for, signed in (the route refuses any other request before this page is
 * built), so it is a page, not an API.
 *
 * What it does not do, by design:
 *
 *  - It names no record, field, user or organization. Only the user the link
 *    was made for can open it, but the page still says only that a file is
 *    wanted and until when: what the link is for is the agent's to say.
 *  - It loads nothing. Script and style are inline, admitted by a per-response
 *    nonce in the Content-Security-Policy; every other source is `'none'`,
 *    and the one request it makes is the `PUT` to its own address
 *    (`connect-src 'self'`), carrying the session cookie the route asks for
 *    (`credentials: 'same-origin'`). No form posts, no framing, no base URL.
 *  - It is never cached, never indexed and never sends a referrer, so the
 *    token in its address stays in the address bar.
 *
 * A used, expired or unknown link gets one page, the same for all three
 * (`404`), so the answer says nothing about which.
 *
 * [#32712] Every sentence is the request's language's (`upload-link-copy.ts`,
 * chosen by the doors): the page's own copy, its `<html lang>` and direction,
 * the expiry written in that language, and the status lines its script
 * writes. An upload's refusal is shown as the answer's `userMessage`, which
 * the `PUT` door composes in the same language; an answer without one shows
 * the page's own "the upload failed".
 *
 * [#32747] A link to a multi-file field takes several files in its one
 * submit: the picker takes `multiple`, the page says how many the link takes
 * (up to the cap for a record, exactly the count asked for a record not yet
 * created), and the files go in one `PUT` as a form (`file0` … `fileN-1` and
 * `count`, `upload-link-wire.ts`). A single-file link sends the file as the
 * request body, as before.
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

function shell(copy: UploadLinkCopy, title: string, body: string, nonce: string, script = ''): string {
  return (
    `<!doctype html><html lang="${escapeHtml(copy.lang)}" dir="${copy.dir}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">' +
    `<title>${escapeHtml(title)}</title><style nonce="${nonce}">${STYLE}</style></head>` +
    `<body><main>${body}</main>${script}</body></html>`
  );
}

/**
 * The script: send the picked file to this page's own address, once. `text`
 * is the page's status lines in its language, and the number of files the
 * link takes (`min`, `max`), as a JSON literal. [#32747] More than one file
 * goes as one form: `file0` … `fileN-1`, each named URI-encoded, and `count`,
 * marked by {@link UPLOAD_LINK_FORM_HEADER}.
 */
function uploadScript(text: string): string {
  return [
    '(function(){',
    `var T=${text};`,
    'var input=document.getElementById("file"),button=document.getElementById("send"),status=document.getElementById("status");',
    'function picked(){return input.files?input.files.length:0;}',
    'input.addEventListener("change",function(){var n=picked();var fits=n>=T.min&&n<=T.max;',
    'button.disabled=!n||!fits;status.textContent=n&&!fits?T.pickCount:"";});',
    'button.addEventListener("click",function(){',
    'var n=picked();if(!n||n<T.min||n>T.max)return;var files=input.files;',
    'button.disabled=true;input.disabled=true;status.textContent=T.uploading;',
    'var request;',
    'if(T.max>1){var form=new FormData();form.append("count",String(n));',
    'for(var i=0;i<n;i++){form.append("file"+i,files[i],encodeURIComponent(files[i].name));}',
    `request={method:"PUT",credentials:"same-origin",cache:"no-store",headers:${JSON.stringify({ [UPLOAD_LINK_FORM_HEADER]: UPLOAD_LINK_FORM_HEADER_VALUE })},body:form};}`,
    'else{var file=files[0];request={method:"PUT",credentials:"same-origin",cache:"no-store",',
    'headers:{"content-type":file.type||"application/octet-stream","x-file-name":encodeURIComponent(file.name)},body:file};}',
    'fetch(location.pathname,request)',
    '.then(function(r){return r.json().catch(function(){return null;}).then(function(b){return{ok:r.ok,body:b};});})',
    '.then(function(r){',
    // [#32734] "Attached" only on the answer that says where the file landed:
    // a success naming the stored file. Anything else is the refusal it carries.
    'if(r.ok&&r.body&&r.body.success===true&&r.body.data&&r.body.data.fileId){status.textContent=n>1?T.attachedSeveral:T.attached;return;}',
    // [#32712] The refusal as the door wrote it for a person, in this page's
    // language; an answer that carries none gets the page's own sentence.
    'var u=r.body&&r.body.error&&r.body.error.userMessage;status.textContent=typeof u==="string"&&u?u:T.failed;})',
    '.catch(function(){status.textContent=T.connectionLost;});',
    '});',
    '})();',
  ].join('');
}

/**
 * A JSON literal safe inside an inline script: no character in it can close
 * the element or open markup, whatever a translation contains.
 */
function scriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** A fresh CSP nonce per response. */
function newNonce(): string {
  return randomBytes(16).toString('base64');
}

/** The picker page for a usable link, in `copy`'s language. */
export function sendUploadLinkPage(res: IHttpResponse, view: UploadLinkView, copy: UploadLinkCopy): void {
  const nonce = newNonce();
  // [#32747] How many files the link takes.
  const files = view.files;
  const several = files.max > 1;
  const wanted = !several
    ? copy.wanted(view.target === 'attachments' ? 'attachments' : 'field')
    : files.min === files.max
      ? copy.wantedExactly(files.min)
      : copy.wantedSeveral(files.max);
  const body =
    `<h1>${escapeHtml(copy.pageTitle)}</h1>` +
    `<p>${escapeHtml(wanted)} ${escapeHtml(copy.once)}</p>` +
    `<p class="muted">${escapeHtml(copy.expires(formatUploadLinkExpiry(copy, view.expiresAt)))}</p>` +
    `<label for="file">${escapeHtml(several ? copy.filesLabel : copy.fileLabel)}</label>` +
    `<input id="file" type="file"${several ? ' multiple' : ''}>` +
    `<button id="send" type="button" disabled>${escapeHtml(copy.send)}</button>` +
    '<p id="status" role="status" aria-live="polite"></p>';
  const text = scriptLiteral({
    uploading: copy.uploading,
    // [#32686] A link that names no record attaches nothing: the file waits
    // for the record the assistant creates.
    attached: view.newRecord === true ? copy.received : copy.attached,
    attachedSeveral: view.newRecord === true ? copy.receivedSeveral : copy.attachedSeveral,
    min: files.min,
    max: files.max,
    pickCount: copy.pickCount(files.min, files.max),
    failed: copy.failed,
    connectionLost: copy.connectionLost,
  });
  pageHeaders(res, nonce)
    .status(200)
    .send(shell(copy, copy.pageTitle, body, nonce, `<script nonce="${nonce}">${uploadScript(text)}</script>`));
}

/** The one page a used, expired or unknown link gets, in `copy`'s language. */
export function sendUnusableUploadLinkPage(res: IHttpResponse, status: number, copy: UploadLinkCopy): void {
  const nonce = newNonce();
  const body = `<h1>${escapeHtml(copy.unusableHeading)}</h1><p>${escapeHtml(copy.unusable)}</p>`;
  pageHeaders(res, nonce).status(status).send(shell(copy, copy.unusableTitle, body, nonce));
}
