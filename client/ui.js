/**
 * The Activity's interface: five sections of saved items, with search, an
 * editor, and the actions that put an item on the clipboard.
 *
 * Everything a person typed is shown with `textContent`, never as HTML, and
 * bookmarklet code is only ever copied: it is not run or linked here.
 */

import {
  KINDS,
  KIND_LABELS,
  bookmarkletUrl,
  builtinValues,
  byPinnedThenRecent,
  expandMacro,
  macroFields,
  matches,
} from '../src/items.js';

/** The words each section uses. */
const SECTIONS = {
  clip: {
    one: 'clip',
    hint: 'Things you paste often. Copy one to put it back on your clipboard.',
    empty: 'No clips yet. Paste something above to keep it.',
  },
  note: {
    one: 'note',
    hint: 'Longer text you want to keep.',
    empty: 'No notes yet.',
  },
  snippet: {
    one: 'snippet',
    hint: 'Code and commands, each with a language label.',
    empty: 'No snippets yet.',
  },
  bookmarklet: {
    one: 'bookmarklet',
    hint: 'JavaScript you run from a browser bookmark. It is kept as text and never runs here.',
    empty: 'No bookmarklets yet.',
    editorHint:
      'Paste the JavaScript. “Copy as bookmark” gives you the address to save as a bookmark in your browser.',
  },
  macro: {
    one: 'macro',
    hint: 'Text with blanks to fill in each time you use it.',
    empty: 'No macros yet.',
    editorHint:
      'Write {{name}} where something changes, and you will be asked for it. {{date}}, {{time}} and {{datetime}} fill themselves in; so does {{user}} when you are signed in.',
  },
};

const TOAST_TIME = 2600;
const CONFIRM_TIME = 4000;

const $ = (id) => document.getElementById(id);

/** Create an element. Children are text or other elements, never HTML. */
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value === true) node.setAttribute(key, '');
    else if (value !== false && value !== null && value !== undefined) {
      node.setAttribute(key, value);
    }
  }
  node.append(...children.filter((child) => child !== null && child !== false));
  return node;
}

/** When an item last changed: the time if today, otherwise the date. */
function formatWhen(time) {
  const then = new Date(time);
  const now = new Date();
  if (then.toDateString() === now.toDateString()) {
    return then.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return then.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: then.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

/** Put text on the clipboard. Returns whether it worked. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Embedded frames are often refused the clipboard API. Copying a
    // selection is older but still allowed there.
  }
  const area = h('textarea', { class: 'visually-hidden', readonly: true });
  area.value = text;
  // Inside an open dialog, or the dialog makes it unreachable.
  (document.querySelector('dialog[open]') ?? document.body).append(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

export function createApp() {
  let store = null;
  let userName = '';
  let items = [];
  let kind = KINDS[0];
  let query = '';
  /** The item in the editor, or null while writing a new one. */
  let editing = null;
  /** The macro in the fill-in dialog, with the values that need no asking. */
  let running = null;
  let toastTimer;

  // -- Feedback -------------------------------------------------------------

  function toast(message, { failed = false } = {}) {
    const node = $('toast');
    node.textContent = message;
    node.classList.toggle('failed', failed);
    node.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
      () => {
        node.hidden = true;
      },
      failed ? TOAST_TIME * 2 : TOAST_TIME,
    );
  }

  async function copy(text, done = 'Copied.') {
    if (await copyText(text)) toast(done);
    else {
      toast('Copying was blocked. Open the item and copy the text by hand.', {
        failed: true,
      });
    }
  }

  /** Run something that talks to the store, reporting a failure. */
  async function attempt(action) {
    try {
      await action();
      return true;
    } catch (error) {
      toast(error.message, { failed: true });
      return false;
    }
  }

  // -- Rendering ------------------------------------------------------------

  function renderNav() {
    $('kinds').replaceChildren(
      ...KINDS.map((name) =>
        h(
          'button',
          {
            type: 'button',
            'aria-current': name === kind ? 'page' : null,
            onclick: () => show(name),
          },
          KIND_LABELS[name],
          h(
            'span',
            { class: 'count' },
            String(items.filter((item) => item.kind === name).length),
          ),
        ),
      ),
    );
  }

  function actionButton(label, onclick, className = '') {
    return h('button', { type: 'button', class: className, onclick }, label);
  }

  /** Delete asks once more, on the same button, before it does anything. */
  function deleteButton(item) {
    let timer;
    const button = actionButton('Delete', async () => {
      if (!button.classList.contains('danger')) {
        button.classList.add('danger');
        button.textContent = 'Really delete?';
        timer = setTimeout(() => {
          button.classList.remove('danger');
          button.textContent = 'Delete';
        }, CONFIRM_TIME);
        return;
      }
      clearTimeout(timer);
      await attempt(async () => {
        await store.remove(item.id);
        items = items.filter((other) => other.id !== item.id);
        render();
        toast('Deleted.');
      });
    });
    return button;
  }

  function itemActions(item) {
    const actions = [];
    if (item.kind === 'macro') {
      actions.push(
        actionButton('Fill in and copy', () => run(item), 'primary'),
        actionButton('Copy template', () => copy(item.body)),
      );
    } else if (item.kind === 'bookmarklet') {
      actions.push(
        actionButton(
          'Copy as bookmark',
          () =>
            copy(
              bookmarkletUrl(item.body),
              'Copied. Paste it as the address of a new bookmark.',
            ),
          'primary',
        ),
        actionButton('Copy code', () => copy(item.body)),
      );
    } else {
      actions.push(actionButton('Copy', () => copy(item.body), 'primary'));
    }
    actions.push(
      h('span', { class: 'spacer' }),
      h(
        'button',
        {
          type: 'button',
          'aria-pressed': String(item.pinned),
          onclick: () => change(item, { pinned: !item.pinned }),
        },
        item.pinned ? 'Pinned' : 'Pin',
      ),
      actionButton('Edit', () => openEditor(item)),
      deleteButton(item),
    );
    return actions;
  }

  function renderItem(item) {
    const meta = [item.lang, formatWhen(item.updatedAt)]
      .filter(Boolean)
      .join(' · ');
    return h(
      'li',
      { class: `item ${item.kind}${item.pinned ? ' pinned' : ''}` },
      h(
        'div',
        { class: 'item-head' },
        h('span', { class: 'item-title' }, item.title),
        h('span', { class: 'item-meta' }, meta),
      ),
      h('pre', { class: 'item-body' }, item.body),
      h('div', { class: 'item-actions' }, ...itemActions(item)),
    );
  }

  function render() {
    const section = SECTIONS[kind];
    renderNav();
    $('heading').textContent = KIND_LABELS[kind];
    $('new').textContent = `New ${section.one}`;
    $('hint').textContent = section.hint;
    $('capture').hidden = kind !== 'clip';

    const inSection = items.filter((item) => item.kind === kind);
    const shown = inSection
      .filter((item) => matches(item, query))
      .sort(byPinnedThenRecent);
    $('items').replaceChildren(...shown.map(renderItem));

    const empty = $('empty');
    empty.hidden = shown.length > 0;
    empty.textContent = inSection.length
      ? `Nothing in ${KIND_LABELS[kind]} matches “${query.trim()}”.`
      : section.empty;
  }

  function show(name) {
    kind = name;
    query = '';
    $('search').value = '';
    render();
  }

  // -- Changing items -------------------------------------------------------

  const replace = (saved) => {
    items = items.map((item) => (item.id === saved.id ? saved : item));
  };

  function change(item, patch) {
    return attempt(async () => {
      replace(await store.update(item.id, patch));
      render();
    });
  }

  function openEditor(item) {
    editing = item;
    const section = SECTIONS[kind];
    const form = $('editor-form');
    form.reset();
    $('editor-title').textContent = `${item ? 'Edit' : 'New'} ${section.one}`;
    form.elements.title.value = item?.title ?? '';
    form.elements.title.placeholder =
      'Leave empty to use the first line of the text';
    form.elements.lang.value = item?.lang ?? '';
    form.elements.body.value = item?.body ?? '';
    $('editor-lang').hidden = kind !== 'snippet';
    $('editor-hint').textContent = section.editorHint ?? '';
    $('editor-hint').hidden = !section.editorHint;
    $('editor-error').hidden = true;
    $('editor').showModal();
    (item ? form.elements.body : form.elements.title).focus();
  }

  async function saveEditor(event) {
    event.preventDefault();
    const form = $('editor-form');
    const input = {
      title: form.elements.title.value,
      body: form.elements.body.value,
      ...(kind === 'snippet' ? { lang: form.elements.lang.value.trim() } : {}),
    };
    try {
      if (editing) replace(await store.update(editing.id, input));
      else items = [...items, await store.create({ kind, ...input })];
    } catch (error) {
      // Shown in the dialog, so the text they typed stays in front of them.
      $('editor-error').textContent = error.message;
      $('editor-error').hidden = false;
      return;
    }
    $('editor').close();
    render();
    toast('Saved.');
  }

  // -- Macros ---------------------------------------------------------------

  function fillRunner() {
    const values = { ...running.values };
    for (const input of $('runner-fields').querySelectorAll('input')) {
      // An empty box leaves the blank visible in the result.
      if (input.value !== '') values[input.name] = input.value;
    }
    $('runner-output').value = expandMacro(running.item.body, values);
  }

  function run(item) {
    const values = builtinValues({ user: userName });
    const fields = macroFields(item.body, values);
    if (!fields.length) {
      return copy(expandMacro(item.body, values), 'Filled in and copied.');
    }
    running = { item, values };
    $('runner-title').textContent = item.title;
    $('runner-fields').replaceChildren(
      ...fields.map((name) =>
        h(
          'label',
          {},
          h('span', {}, name),
          h('input', { name, autocomplete: 'off', oninput: fillRunner }),
        ),
      ),
    );
    fillRunner();
    $('runner').showModal();
    $('runner-fields').querySelector('input').focus();
    return undefined;
  }

  // -- Wiring ---------------------------------------------------------------

  async function saveCapture(event) {
    event.preventDefault();
    const area = $('capture-text');
    if (!area.value.trim()) return;
    const saved = await attempt(async () => {
      items = [
        ...items,
        await store.create({ kind: 'clip', body: area.value }),
      ];
    });
    if (!saved) return;
    area.value = '';
    render();
    toast('Saved.');
  }

  function wire() {
    $('search').addEventListener('input', (event) => {
      query = event.target.value;
      render();
    });
    $('new').addEventListener('click', () => openEditor(null));

    $('editor-form').addEventListener('submit', saveEditor);
    $('editor-cancel').addEventListener('click', () => $('editor').close());

    $('runner-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      await copy($('runner-output').value, 'Filled in and copied.');
      $('runner').close();
    });
    $('runner-close').addEventListener('click', () => $('runner').close());

    $('capture').addEventListener('submit', saveCapture);
    $('capture-text').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        $('capture').requestSubmit();
      }
    });
    if (navigator.clipboard?.readText) {
      const paste = $('capture-paste');
      paste.hidden = false;
      paste.addEventListener('click', async () => {
        try {
          // Shown first, not saved straight away: they see what they keep.
          $('capture-text').value = await navigator.clipboard.readText();
          $('capture-text').focus();
        } catch {
          toast(
            'The clipboard could not be read here. Paste into the box instead.',
            { failed: true },
          );
        }
      });
    }

    // "/" searches and "n" starts a new item, unless they are being typed.
    document.addEventListener('keydown', (event) => {
      const typing = event.target.closest?.('input, textarea, dialog');
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === '/') {
        event.preventDefault();
        $('search').focus();
      } else if (event.key === 'n' && store) {
        event.preventDefault();
        openEditor(null);
      }
    });
  }

  /** Nothing can be saved until it is known where items are kept. */
  function setReady(ready) {
    $('new').disabled = !ready;
    $('capture-text').disabled = !ready;
  }

  wire();
  setReady(false);
  render();

  return {
    /** Begin working with a store, once it is known where items are kept. */
    async start(nextStore, { message, name = '' }) {
      store = nextStore;
      userName = name;
      setReady(true);
      $('status').textContent = message;
      try {
        items = await store.list();
      } catch (error) {
        $('status').textContent =
          `Your items could not be loaded: ${error.message}`;
      }
      render();
    },
  };
}
