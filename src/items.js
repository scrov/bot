/**
 * Saved items: what they are, how they are validated, and how they are turned
 * into text. Shared by the Worker and the Activity's front end, so it must not
 * use anything that only one of them has.
 */

/** Kinds of saved item, in the order the app lists them. */
export const KINDS = ['clip', 'note', 'snippet', 'bookmarklet', 'macro'];

/** Section name for each kind. */
export const KIND_LABELS = {
  clip: 'Clipboard',
  note: 'Notebook',
  snippet: 'Snippets',
  bookmarklet: 'Bookmarklets',
  macro: 'Macros',
};

export const LIMITS = {
  /** Longest title, in characters. */
  title: 100,
  /** Longest body, in characters. */
  body: 20000,
  /** Longest snippet language label. */
  lang: 30,
  /** Most items one person can keep. */
  items: 500,
};

/** Discord rejects messages longer than this. */
export const MESSAGE_LIMIT = 2000;

const LANG_PATTERN = /^[A-Za-z0-9+#._-]*$/;

/** A title for an item that was saved without one: its first line of text. */
export function titleFromBody(body) {
  const line =
    body
      .split('\n')
      .map((text) => text.trim())
      .find(Boolean) ?? '';
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
}

/**
 * Check and tidy what a person typed. Returns `{ item }` holding only the
 * fields that were given and are valid, or `{ error }` with a sentence that
 * can be shown to them.
 *
 * With `partial`, missing fields are left out (an edit); without it, `kind`
 * and `body` are required and the rest get defaults (a new item).
 */
export function cleanItem(input, { partial = false } = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Expected an item.' };
  }
  const item = {};

  if (input.kind !== undefined || !partial) {
    if (!KINDS.includes(input.kind)) {
      return { error: `The kind must be one of: ${KINDS.join(', ')}.` };
    }
    item.kind = input.kind;
  }

  if (input.body !== undefined || !partial) {
    if (typeof input.body !== 'string' || input.body.trim() === '') {
      return { error: 'There is nothing to save: the text is empty.' };
    }
    const body = input.body.replace(/\r\n?/g, '\n');
    if (body.length > LIMITS.body) {
      return {
        error: `The text is ${body.length} characters long; the limit is ${LIMITS.body}.`,
      };
    }
    item.body = body;
  }

  if (input.title !== undefined || !partial) {
    if (input.title !== undefined && typeof input.title !== 'string') {
      return { error: 'The title must be text.' };
    }
    const title = (input.title ?? '').replace(/\s+/g, ' ').trim();
    if (title.length > LIMITS.title) {
      return {
        error: `The title is ${title.length} characters long; the limit is ${LIMITS.title}.`,
      };
    }
    // An edit that clears the title falls back to the text, like a new item.
    item.title = title || (item.body ? titleFromBody(item.body) : title);
  }

  if (input.lang !== undefined || !partial) {
    const lang = input.lang ?? '';
    if (
      typeof lang !== 'string' ||
      lang.length > LIMITS.lang ||
      !LANG_PATTERN.test(lang)
    ) {
      return {
        error: 'The language must be a short label such as js, python or c++.',
      };
    }
    item.lang = lang;
  }

  if (input.pinned !== undefined || !partial) {
    if (input.pinned !== undefined && typeof input.pinned !== 'boolean') {
      return { error: 'Pinned must be true or false.' };
    }
    item.pinned = input.pinned ?? false;
  }

  return { item };
}

/**
 * Apply an edit to a saved item. The kind never changes, and an emptied title
 * falls back to the text. Returns `{ item, edited }`, where `edited` says
 * whether the content changed (pinning alone does not count), or `{ error }`.
 */
export function applyEdit(current, patch) {
  const { item, error } = cleanItem(
    { ...patch, kind: undefined },
    { partial: true },
  );
  if (error) return { error };
  const next = { ...current, ...item };
  if (!next.title) next.title = titleFromBody(next.body);
  const edited = ['title', 'body', 'lang'].some(
    (field) => next[field] !== current[field],
  );
  return { item: next, edited };
}

/** Whether an item's title, text or language contains the search text. */
export function matches(item, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [item.title, item.body, item.lang].some((text) =>
    text.toLowerCase().includes(needle),
  );
}

/** Pinned items first, then the most recently changed. */
export function byPinnedThenRecent(a, b) {
  return Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt;
}

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

const PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

const pad = (number) => String(number).padStart(2, '0');

/**
 * Values for the placeholders that fill themselves in: `date`, `time`,
 * `datetime` and, when the person's name is known, `user`. `utc` is for the
 * Worker, which has no idea of the reader's time zone; the front end uses
 * local time.
 */
export function builtinValues({
  now = new Date(),
  user = '',
  utc = false,
} = {}) {
  const part = (local, universal) => (utc ? universal : local).call(now);
  const date = [
    part(now.getFullYear, now.getUTCFullYear),
    pad(part(now.getMonth, now.getUTCMonth) + 1),
    pad(part(now.getDate, now.getUTCDate)),
  ].join('-');
  const time = [
    pad(part(now.getHours, now.getUTCHours)),
    pad(part(now.getMinutes, now.getUTCMinutes)),
  ].join(':');
  return {
    date,
    time: utc ? `${time} UTC` : time,
    datetime: utc ? `${date} ${time} UTC` : `${date} ${time}`,
    ...(user ? { user } : {}),
  };
}

/**
 * The placeholders a macro still needs someone to fill in: those it uses that
 * `values` has nothing for, in the order they first appear.
 */
export function macroFields(body, values = {}) {
  const fields = [];
  for (const [, name] of body.matchAll(PLACEHOLDER)) {
    if (!Object.hasOwn(values, name) && !fields.includes(name)) {
      fields.push(name);
    }
  }
  return fields;
}

/**
 * Fill in a macro. Placeholders with no value are left as they were written,
 * so a half-filled macro still shows what is missing.
 */
export function expandMacro(body, values = {}) {
  return body.replace(PLACEHOLDER, (whole, name) =>
    Object.hasOwn(values, name) ? String(values[name]) : whole,
  );
}

// ---------------------------------------------------------------------------
// Bookmarklets
// ---------------------------------------------------------------------------

/**
 * The `javascript:` address to save as a browser bookmark. Code that already
 * is one is returned unchanged.
 */
export function bookmarkletUrl(code) {
  const source = code.trim();
  if (/^javascript:/i.test(source)) return source;
  // The line break keeps a trailing `//` comment from swallowing the wrapper.
  return `javascript:${encodeURIComponent(`(function(){${source}\n})();`)}`;
}

// ---------------------------------------------------------------------------
// Discord messages
// ---------------------------------------------------------------------------

/** Shorten text to fit, marking the cut. */
function truncate(text, limit) {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

function codeBlock(text, lang, limit) {
  // A zero-width space stops the text from closing the block early.
  const safe = text.replaceAll('```', '`​``');
  const open = `\`\`\`${lang}\n`;
  const close = '\n```';
  return open + truncate(safe, limit - open.length - close.length) + close;
}

/**
 * An item as the text of a Discord message. Snippets and bookmarklets go in a
 * code block, macros are filled in, and everything is cut to Discord's limit.
 */
export function toMessage(item, values = {}) {
  switch (item.kind) {
    case 'snippet':
      return codeBlock(item.body, item.lang, MESSAGE_LIMIT);
    case 'bookmarklet':
      return codeBlock(item.body, 'js', MESSAGE_LIMIT);
    case 'macro':
      return truncate(expandMacro(item.body, values), MESSAGE_LIMIT);
    default:
      return truncate(item.body, MESSAGE_LIMIT);
  }
}
