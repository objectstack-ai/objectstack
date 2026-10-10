// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { StorageNameMapping } from '@objectstack/spec/system';
import { ObjectSchema, checkManagedApiMethodAffordances } from '@objectstack/spec/data';
import { SysCommentReaction } from './index.js';

/**
 * The declaration of `sys_comment_reaction` (#22566, ruling A amended on
 * #22505), held to the properties the rest of its contract rests on.
 *
 * Each assertion names the mechanism that reads the property, because each is
 * a place a later "tidy-up" silently moves the object out from under a rule
 * that lives in another package:
 *
 *  - the own-record delete floor (plugin-security `owner_only_deletes`) keys on
 *    the engine-stamped `created_by` and yields on no `sharingModel` here;
 *  - the read gate and the create gate (`comment-access-hooks.ts`) read
 *    `comment_id`;
 *  - the reader's grouping reads `(comment_id, emoji, user_id)`, which the
 *    unique index makes one row.
 */
describe('sys_comment_reaction declaration', () => {
  it('is a canonical sys_ system object whose name is its table', () => {
    expect(SysCommentReaction.name).toBe('sys_comment_reaction');
    expect(StorageNameMapping.resolveTableName(SysCommentReaction)).toBe('sys_comment_reaction');
    expect(SysCommentReaction.isSystem).toBe(true);
    expect((SysCommentReaction as any).namespace).toBeUndefined();
    expect((SysCommentReaction as any).tableName).toBeUndefined();
  });

  it('parses as an object schema', () => {
    expect(ObjectSchema.safeParse(SysCommentReaction).success).toBe(true);
  });

  it('declares the triple a reader groups by, and the reactor as a user', () => {
    const f = SysCommentReaction.fields as Record<string, any>;
    expect(f.comment_id).toMatchObject({ type: 'text', required: true, maxLength: 255 });
    expect(f.emoji).toMatchObject({ type: 'text', required: true });
    expect(f.user_id).toMatchObject({ type: 'lookup', reference: 'sys_user', required: true });
  });

  it('keys comment_id as an id column, never a reference with delete behaviour', () => {
    // A cascade would delete other members' reactions under the comment
    // author's own authority, which the own-record floor refuses; a required
    // set_null escalates to restrict. Either would stop an author deleting
    // their own comment once someone reacted.
    const f = SysCommentReaction.fields as Record<string, any>;
    expect(f.comment_id.reference).toBeUndefined();
    expect(f.comment_id.deleteBehavior).toBeUndefined();
  });

  it('holds (comment_id, emoji, user_id) unique, with the scope spelled out', () => {
    expect(SysCommentReaction.indexes).toEqual([
      { fields: ['comment_id', 'emoji', 'user_id'], unique: 'organization' },
    ]);
  });

  it('leaves the own-record floor in force: no sharing model, audit columns injected', () => {
    // `owner_only_deletes` survives every sharing model but `controlled_by_parent`
    // and the write model a `public_read_write` OWD replaces only on update; an
    // absent model is the one the floor was written for. `created_by` is the
    // floor's key, injected unless the object opts its audit columns out.
    expect((SysCommentReaction as any).sharingModel).toBeUndefined();
    expect((SysCommentReaction as any).systemFields?.audit).not.toBe(false);
  });

  it('offers create, read and delete over the data API — never update', () => {
    expect(SysCommentReaction.enable?.apiMethods).toEqual(['get', 'list', 'create', 'delete']);
    expect((SysCommentReaction as any).userActions).toMatchObject({ edit: false, import: false });
    // The registry strips an advertised verb the managed bucket does not
    // afford; nothing advertised here may be stripped.
    expect(checkManagedApiMethodAffordances(SysCommentReaction)).toEqual([]);
  });

  it('is no feed target and mirrors no activity', () => {
    expect(SysCommentReaction.enable).toMatchObject({ feeds: false, activities: false, trackHistory: false });
  });
});
