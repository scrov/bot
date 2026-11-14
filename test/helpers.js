/**
 * Stand-ins for the parts of the Workers runtime the tests need.
 */

import { DatabaseSync } from 'node:sqlite';
import { ItemsDb } from '../src/items-db.js';

/**
 * Node's SQLite behind the interface of a Durable Object's `ctx.storage.sql`,
 * as far as ItemsDb uses it.
 */
export function sqliteSql() {
  const database = new DatabaseSync(':memory:');
  return {
    exec(query, ...bindings) {
      const statement = database.prepare(query);
      if (/^\s*select/i.test(query)) {
        const rows = statement.all(...bindings);
        return { toArray: () => rows, rowsWritten: 0 };
      }
      const { changes } = statement.run(...bindings);
      return { toArray: () => [], rowsWritten: Number(changes) };
    },
  };
}

/**
 * A USER_STORE binding: one in-memory ItemsDb per name, reached through
 * `idFromName` and `get` like the real one, with promises for results.
 */
export function fakeUserStore() {
  const stores = new Map();
  return {
    idFromName: (name) => name,
    get(name) {
      if (!stores.has(name)) stores.set(name, new ItemsDb(sqliteSql()));
      const db = stores.get(name);
      return {
        list: async (options) => db.list(options),
        get: async (id) => db.get(id),
        create: async (input) => db.create(input),
        update: async (id, patch) => db.update(id, patch),
        remove: async (id) => db.remove(id),
      };
    },
  };
}
