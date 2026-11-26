// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The starter, installed for real: the package goes in through the
 * marketplace install door as an unmanaged copy with its sample data (the
 * starter path), its menu carries the four object entries (companies,
 * contacts, and the platform's tasks and notes), and uninstalling it removes
 * companies and contacts while every task and note stays.
 *
 * One boot of a host with nothing of its own, every phase in `beforeAll`; the
 * `it`s only read what the phases recorded. The task and the note are written
 * through the data route before the uninstall, so "they survive" is read off
 * rows that existed, not off an empty table. The menu and every read go
 * through the HTTP routes the Console uses.
 *
 * The install body is the build-shaped artifact: the normalized stack,
 * JSON-round-tripped. The starter carries no callable (no hook, function or
 * action handler), so there is nothing for the build's lowering to bind.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { defineStack, normalizeStackInput } from '@objectstack/spec';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import stack from '../objectstack.config.js';

const ROUTE = '/marketplace/install-local';
const PACKAGE_ID = 'com.example.starter';

/** A host that brings nothing of its own: whatever the menu shows, the install put there. */
const HOST = defineStack({
  manifest: {
    id: 'com.example.starter-test-host',
    namespace: 'sthost',
    version: '0.0.0',
    type: 'app',
    name: 'Starter test host',
  },
});

interface Answer { status: number; body: any }

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** The record a meta or data read answers, whatever envelope it wraps it in. */
function unwrap(answer: Answer): any {
  const body = answer.body?.data ?? answer.body;
  return body?.item ?? body;
}

/** The rows a data list answers, whatever envelope it wraps them in. */
function rows(answer: Answer): any[] {
  const body = answer.body?.data ?? answer.body;
  return Array.isArray(body) ? body : Array.isArray(body?.records) ? body.records : Array.isArray(body?.items) ? body.items : [];
}

function installBody(): Record<string, unknown> {
  const artifact = JSON.parse(JSON.stringify(normalizeStackInput(stack as never))) as Record<string, any>;
  return {
    manifest: { ...artifact, id: artifact.manifest.id, version: artifact.manifest.version },
    installMode: 'unmanaged',
    seedSampleData: true,
  };
}

describe('app-starter — installed as a starter, menu, uninstall', () => {
  let booted: VerifyStack;
  let storageDir: string;

  let install: Answer;
  let base: string | undefined;
  let app: Answer;
  let companies: Answer;
  let contacts: Answer;
  let task: Answer;
  let note: Answer;
  let uninstall: Answer;
  const after: Record<string, Answer> = {};

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'app-starter-install-'));
    booted = await bootStack(HOST, {
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    const token = await booted.signIn();
    const call = async (method: string, path: string, body?: unknown) => json(await booted.apiAs(token, method, path, body));

    install = await call('POST', ROUTE, installBody());
    // The copy is a writable package of its own, beside the package id.
    base = install.body?.data?.targetPackageId;

    app = await call('GET', '/meta/app/starter_app');
    companies = await call('GET', '/data/starter_company');
    contacts = await call('GET', '/data/starter_contact');

    task = await call('POST', '/data/sys_task', { title: 'Call Northwind about the renewal' });
    note = await call('POST', '/data/sys_note', { title: 'Northwind visit', body: 'Met the purchasing team.' });

    uninstall = await call('DELETE', `/packages/${base}`);

    after.company = await call('GET', '/meta/object/starter_company');
    after.contact = await call('GET', '/meta/object/starter_contact');
    after.app = await call('GET', '/meta/app/starter_app');
    after.task = await call('GET', `/data/sys_task/${unwrap(task)?.id}`);
    after.note = await call('GET', `/data/sys_note/${unwrap(note)?.id}`);
  }, 180_000);

  afterAll(async () => {
    await booted?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('installs as an unmanaged copy with its sample companies and contacts', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.installMode).toBe('unmanaged');
    expect(base).toBe(`${PACKAGE_ID}-copy`);
    expect(rows(companies).length, JSON.stringify(companies.body)).toBe(5);
    expect(rows(contacts).length, JSON.stringify(contacts.body)).toBe(6);
    const northwind = rows(companies).find((c) => c.name === 'Northwind Trading');
    const olivia = rows(contacts).find((c) => c.email === 'olivia@northwind.example');
    expect(olivia?.company).toBe(northwind?.id);
  });

  it('the menu carries companies, contacts, tasks and notes — tasks and notes are the platform objects', () => {
    expect(app.status, JSON.stringify(app.body)).toBe(200);
    const objectEntries = (unwrap(app)?.navigation ?? [])
      .filter((n: any) => n.type === 'object')
      .map((n: any) => n.objectName);
    expect(objectEntries).toEqual(['starter_company', 'starter_contact', 'sys_task', 'sys_note']);
    expect((stack.objects ?? []).map((o) => o.name).sort()).toEqual(['starter_company', 'starter_contact']);
  });

  it('precondition: a task and a note were written before the uninstall', () => {
    expect(task.status, JSON.stringify(task.body)).toBeLessThan(300);
    expect(note.status, JSON.stringify(note.body)).toBeLessThan(300);
    expect(unwrap(task)?.id).toBeTruthy();
    expect(unwrap(note)?.id).toBeTruthy();
  });

  it('uninstall removes companies, contacts and the app', () => {
    expect(uninstall.status, JSON.stringify(uninstall.body)).toBe(200);
    expect(after.company.status, JSON.stringify(after.company.body)).toBe(404);
    expect(after.contact.status, JSON.stringify(after.contact.body)).toBe(404);
    expect(after.app.status, JSON.stringify(after.app.body)).toBe(404);
  });

  it('uninstall leaves every task and note in place', () => {
    expect(after.task.status, JSON.stringify(after.task.body)).toBe(200);
    expect(unwrap(after.task)?.id).toBe(unwrap(task).id);
    expect(after.note.status, JSON.stringify(after.note.body)).toBe(200);
    expect(unwrap(after.note)?.id).toBe(unwrap(note).id);
  });
});
