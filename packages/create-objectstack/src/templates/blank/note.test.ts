import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import config from './objectstack.config';
import { Note } from './src/objects';

// Boots THIS app (its objects, its plugins, the services it requires) on the
// real ObjectStack engine, in this process, with an in-memory database and no
// server port, then asserts on what the engine does. Nothing is mocked: a
// write through `stack.hooks.run` takes the same path as a write over the REST
// API, through validation, the permission checks and every hook the app binds.
//
// The same handle runs a flow (`stack.flows.run`), an action
// (`stack.actions.run`), a validation pass without writing (`stack.validate`),
// seeds fixtures (`stack.seed`) and reads rows as a given user (`stack.rows`).
// The README of `@objectstack/verify` (in node_modules) documents each one.
//
// The object is addressed as `Note.name`, never as a typed-out string:
// scaffolding renamed it to carry this project's namespace, and adding your
// own objects works the same way.
describe('notes', () => {
  let stack: VerifyStack;
  let author: string;

  beforeAll(async () => {
    stack = await bootStack(config);
    // The development admin the stack seeds: a bearer token to act as.
    author = await stack.signIn();
  });

  afterAll(async () => {
    await stack?.stop();
  });

  it('cannot be saved without a title', async () => {
    // `title` is declared `required` in src/objects/note.object.ts, and the
    // engine refuses the write with its own error, naming the field.
    await expect(
      stack.hooks.run(Note.name, 'insert', { body: 'Agenda for Monday' }, { as: author }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'title', code: 'required' }],
    });

    // The same note with a title is saved, so the refusal above was the
    // missing title and nothing else.
    const note = await stack.hooks.run(
      Note.name,
      'insert',
      { title: 'Weekly sync', body: 'Agenda for Monday' },
      { as: author },
    );
    expect(note.title).toBe('Weekly sync');
  });
});
