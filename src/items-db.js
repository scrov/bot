/**
 * One person's saved items in SQLite.
 *
 * Written against the SQL interface of a Durable Object's storage
 * (`ctx.storage.sql`): `exec(query, ...bindings)` returning a cursor with
 * `toArray()` and `rowsWritten`. Nothing here depends on the Workers runtime,
 * so the tests run it on Node's own SQLite.
 */

import { LIMITS, applyEdit, cleanItem } from './items.js';

const COLUMNS = 'id, kind, title, body, lang, pinned, created_at, updated_at';

const fromRow = (row) => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  lang: row.lang,
  pinned: Boolean(row.pinned),
  createdAt: Number(row.created_at),
  updatedAt: Number(row.updated_at),
});

/** Make text match itself in a LIKE pattern. */
const likePattern = (text) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export class ItemsDb {
  /**
   * @param sql The storage's SQL interface.
   * @param options.now Clock, in milliseconds; replaced in tests.
   * @param options.newId Identifier source; replaced in tests.
   */
  constructor(sql, { now = Date.now, newId = () => crypto.randomUUID() } = {}) {
    this.sql = sql;
    this.now = now;
    this.newId = newId;
    sql.exec(
      `CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        lang TEXT NOT NULL DEFAULT '',
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )`,
    );
    sql.exec(
      'CREATE INDEX IF NOT EXISTS items_by_kind ON items (kind, pinned DESC, updated_at DESC)',
    );
  }

  /**
   * Items, pinned first and then most recently changed.
   * @param options.kind Only this kind.
   * @param options.query Only items whose title or text contains this.
   * @param options.limit At most this many.
   */
  list({ kind, query, limit = LIMITS.items } = {}) {
    const where = [];
    const bindings = [];
    if (kind) {
      where.push('kind = ?');
      bindings.push(kind);
    }
    if (query && query.trim()) {
      where.push("(title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\')");
      const pattern = likePattern(query.trim());
      bindings.push(pattern, pattern);
    }
    const size = Math.max(
      1,
      Math.min(Number(limit) || LIMITS.items, LIMITS.items),
    );
    return this.sql
      .exec(
        `SELECT ${COLUMNS} FROM items
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY pinned DESC, updated_at DESC, id
         LIMIT ?`,
        ...bindings,
        size,
      )
      .toArray()
      .map(fromRow);
  }

  /** The item with this id, or null. */
  get(id) {
    const rows = this.sql
      .exec(`SELECT ${COLUMNS} FROM items WHERE id = ?`, String(id))
      .toArray();
    return rows.length ? fromRow(rows[0]) : null;
  }

  count() {
    return Number(
      this.sql.exec('SELECT COUNT(*) AS total FROM items').toArray()[0].total,
    );
  }

  /** Save a new item. Returns `{ item }`, or `{ error, status }`. */
  create(input) {
    const { item, error } = cleanItem(input);
    if (error) return { error, status: 400 };
    if (this.count() >= LIMITS.items) {
      return {
        error: `You have reached the limit of ${LIMITS.items} saved items. Delete some to make room.`,
        status: 409,
      };
    }
    const id = this.newId();
    const time = this.now();
    this.sql.exec(
      `INSERT INTO items (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      item.kind,
      item.title,
      item.body,
      item.lang,
      item.pinned ? 1 : 0,
      time,
      time,
    );
    return { item: this.get(id) };
  }

  /**
   * Change an item's title, text, language or pin. Its kind stays as it is.
   * Returns `{ item }`, or `{ error, status }`.
   */
  update(id, patch) {
    const current = this.get(id);
    if (!current) return { error: 'That item no longer exists.', status: 404 };
    const { item: next, edited, error } = applyEdit(current, patch);
    if (error) return { error, status: 400 };
    // Pinning is not an edit: it must not reorder the list by itself.
    this.sql.exec(
      'UPDATE items SET title = ?, body = ?, lang = ?, pinned = ?, updated_at = ? WHERE id = ?',
      next.title,
      next.body,
      next.lang,
      next.pinned ? 1 : 0,
      edited ? this.now() : current.updatedAt,
      current.id,
    );
    return { item: this.get(current.id) };
  }

  /** Delete an item. Returns whether there was one. */
  remove(id) {
    return (
      this.sql.exec('DELETE FROM items WHERE id = ?', String(id)).rowsWritten >
      0
    );
  }
}
