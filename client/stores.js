/**
 * Where the Activity keeps items. Both stores have the same four methods, so
 * the interface does not care which one it was given.
 *
 *  - remoteStore: the Worker's API, per Discord account.
 *  - localStore: this browser only, for when there is no Discord sign-in.
 */

import { LIMITS, applyEdit, cleanItem } from '../src/items.js';

const STORAGE_KEY = 'scrov-bot.items.v1';

/** The Worker's API, called with the session token from sign-in. */
export function remoteStore(api, session) {
  async function call(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        response.status === 401
          ? 'Your session ended. Close the app and open it again.'
          : data.error ?? `The server answered ${response.status}.`,
      );
    }
    return data;
  }

  return {
    list: async () => (await call('/items')).items,
    create: async (input) =>
      (await call('/items', { method: 'POST', body: input })).item,
    update: async (id, patch) =>
      (
        await call(`/items/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: patch,
        })
      ).item,
    remove: async (id) => {
      await call(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}

/**
 * The browser's own storage, or a stand-in that lasts until the page closes
 * when the browser refuses access (private windows, some embedded frames).
 */
function openStorage() {
  try {
    const storage = window.localStorage;
    storage.getItem(STORAGE_KEY);
    return { storage, lasting: true };
  } catch {
    const memory = new Map();
    return {
      storage: {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => memory.set(key, value),
      },
      lasting: false,
    };
  }
}

/** Items kept in this browser, following the same rules as the server. */
export function localStore() {
  const { storage, lasting } = openStorage();

  const read = () => {
    try {
      const items = JSON.parse(storage.getItem(STORAGE_KEY) ?? '[]');
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  };

  const write = (items) => {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      throw new Error('This browser has no room left to save that.');
    }
  };

  return {
    /** False when items will be lost as soon as the page closes. */
    lasting,

    list: async () => read(),

    create: async (input) => {
      const { item, error } = cleanItem(input);
      if (error) throw new Error(error);
      const items = read();
      if (items.length >= LIMITS.items) {
        throw new Error(
          `You have reached the limit of ${LIMITS.items} saved items. Delete some to make room.`,
        );
      }
      const now = Date.now();
      const saved = {
        ...item,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      write([...items, saved]);
      return saved;
    },

    update: async (id, patch) => {
      const items = read();
      const current = items.find((item) => item.id === id);
      if (!current) throw new Error('That item no longer exists.');
      const { item, edited, error } = applyEdit(current, patch);
      if (error) throw new Error(error);
      if (edited) item.updatedAt = Date.now();
      write(items.map((other) => (other.id === id ? item : other)));
      return item;
    },

    remove: async (id) => {
      write(read().filter((item) => item.id !== id));
    },
  };
}
