import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import config from './objectstack.config';
import { Company, Contact } from './src/objects';
import * as apps from './src/apps';

// Boots THIS app (its objects, its plugins, the services it requires) on the
// real ObjectStack engine, in this process, with an in-memory database and no
// server port, then asserts on what the engine does. Nothing is mocked: a
// write through `stack.hooks.run` takes the same path as a write over the REST
// API, through validation, the permission checks and every hook the app binds,
// and `stack.apiAs` calls the same HTTP routes the Console calls.
//
// The same handle runs a flow (`stack.flows.run`), an action
// (`stack.actions.run`), a validation pass without writing (`stack.validate`),
// seeds fixtures (`stack.seed`) and reads rows as a given user (`stack.rows`).
// The README of `@objectstack/verify` (in node_modules) documents each one.
//
// Objects and the app are addressed by the definitions they are imported as
// (`Company.name`), never by a typed-out string: scaffolding renamed them to
// carry this project's namespace, and adding your own works the same way.
describe('the starter: companies and contacts, with tasks and notes in the menu', () => {
  let stack: VerifyStack;
  let admin: string;

  beforeAll(async () => {
    stack = await bootStack(config);
    // The development admin the stack seeds: a bearer token to act as.
    admin = await stack.signIn();
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('a company cannot be saved without a name', async () => {
    // `name` is declared `required` in src/objects/company.object.ts, and the
    // engine refuses the write with its own error, naming the field.
    await expect(
      stack.hooks.run(Company.name, 'insert', { type: 'customer' }, { as: admin }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'name', code: 'required' }],
    });

    // The same company with a name is saved, so the refusal above was the
    // missing name and nothing else.
    const company = await stack.hooks.run(
      Company.name,
      'insert',
      { name: 'Northwind Trading', type: 'customer' },
      { as: admin },
    );
    expect(company.name).toBe('Northwind Trading');
  });

  it('a contact belongs to a company', async () => {
    const company = await stack.hooks.run(Company.name, 'insert', { name: 'Blue Harbor' }, { as: admin });
    const contact = await stack.hooks.run(
      Contact.name,
      'insert',
      { name: 'Sophia Martin', company: company.id },
      { as: admin },
    );
    expect(contact.company).toBe(company.id);
  });

  it('the menu lists companies, contacts, tasks and notes', async () => {
    // Read the app the way the Console does, from the booted stack. Tasks and
    // notes are the platform's own objects, not this project's.
    const app = Object.values(apps)[0];
    const res = await stack.apiAs(admin, 'GET', `/meta/app/${app.name}`);
    expect(res.status).toBe(200);
    // The answer wraps the app as `item`, inside a `data` envelope or without one.
    const body = await res.json();
    const envelope = body?.data ?? body;
    const served = envelope?.item ?? envelope;
    const entries = (served?.navigation ?? []).map((n: { objectName?: string }) => n.objectName);
    expect(entries).toEqual([Company.name, Contact.name, 'sys_task', 'sys_note']);
  });
});
