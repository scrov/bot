/**
 * The Durable Object that keeps one Discord user's saved items.
 *
 * There is one object per user, named by their Discord user id, each with its
 * own SQLite database. The Worker reaches it through the USER_STORE binding
 * and calls these methods directly.
 */

import { DurableObject } from 'cloudflare:workers';
import { ItemsDb } from './items-db.js';

export class UserStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.db = new ItemsDb(ctx.storage.sql);
  }

  list(options) {
    return this.db.list(options);
  }

  get(id) {
    return this.db.get(id);
  }

  create(input) {
    return this.db.create(input);
  }

  update(id, patch) {
    return this.db.update(id, patch);
  }

  remove(id) {
    return this.db.remove(id);
  }
}
