import { expect } from 'chai';
import { describe, it } from 'mocha';
import {
  LIMITS,
  MESSAGE_LIMIT,
  applyEdit,
  bookmarkletUrl,
  builtinValues,
  byPinnedThenRecent,
  cleanItem,
  expandMacro,
  macroFields,
  matches,
  toMessage,
} from '../src/items.js';

describe('Items', () => {
  describe('cleanItem', () => {
    it('fills in defaults for a new item', () => {
      const { item } = cleanItem({ kind: 'clip', body: 'hello\r\nworld' });
      expect(item).to.deep.equal({
        kind: 'clip',
        body: 'hello\nworld',
        title: 'hello',
        lang: '',
        pinned: false,
      });
    });

    it('tidies the title and keeps it when given', () => {
      const { item } = cleanItem({
        kind: 'note',
        title: '  two\n words ',
        body: 'text',
      });
      expect(item.title).to.equal('two words');
    });

    it('shortens a title taken from a long first line', () => {
      const { item } = cleanItem({ kind: 'note', body: 'x'.repeat(200) });
      expect(item.title).to.have.lengthOf(60);
      expect(item.title.endsWith('…')).to.equal(true);
    });

    it('refuses what cannot be saved', () => {
      const refused = [
        null,
        [],
        { kind: 'recipe', body: 'x' },
        { kind: 'clip', body: '   ' },
        { kind: 'clip' },
        { kind: 'clip', body: 'x'.repeat(LIMITS.body + 1) },
        { kind: 'clip', body: 'x', title: 'x'.repeat(LIMITS.title + 1) },
        { kind: 'clip', body: 'x', title: 5 },
        { kind: 'snippet', body: 'x', lang: 'not a label' },
        { kind: 'snippet', body: 'x', lang: 'x'.repeat(LIMITS.lang + 1) },
        { kind: 'clip', body: 'x', pinned: 'yes' },
      ];
      for (const input of refused) {
        expect(cleanItem(input), JSON.stringify(input)).to.have.property(
          'error',
        );
      }
    });

    it('checks only the given fields of an edit', () => {
      expect(cleanItem({ pinned: true }, { partial: true })).to.deep.equal({
        item: { pinned: true },
      });
      expect(cleanItem({ body: '' }, { partial: true })).to.have.property(
        'error',
      );
    });
  });

  describe('applyEdit', () => {
    const current = {
      id: '1',
      kind: 'snippet',
      title: 'Title',
      body: 'first line\nsecond',
      lang: 'js',
      pinned: false,
      createdAt: 1,
      updatedAt: 1,
    };

    it('does not count pinning as an edit', () => {
      const { item, edited } = applyEdit(current, { pinned: true });
      expect(item.pinned).to.equal(true);
      expect(edited).to.equal(false);
    });

    it('never changes the kind', () => {
      const { item } = applyEdit(current, { kind: 'macro', body: 'new' });
      expect(item.kind).to.equal('snippet');
      expect(item.body).to.equal('new');
    });

    it('falls back to the text when the title is emptied', () => {
      const { item, edited } = applyEdit(current, { title: '' });
      expect(item.title).to.equal('first line');
      expect(edited).to.equal(true);
    });

    it('passes on a refusal', () => {
      expect(applyEdit(current, { body: ' ' })).to.have.property('error');
    });
  });

  describe('searching and ordering', () => {
    const item = { title: 'Deploy', body: 'npx wrangler deploy', lang: 'bash' };

    it('matches the title, text or language, whatever the case', () => {
      expect(matches(item, 'WRANGLER')).to.equal(true);
      expect(matches(item, 'bash')).to.equal(true);
      expect(matches(item, '  ')).to.equal(true);
      expect(matches(item, 'python')).to.equal(false);
    });

    it('puts pinned items first, then the newest', () => {
      const items = [
        { id: 'old', pinned: false, updatedAt: 1 },
        { id: 'new', pinned: false, updatedAt: 3 },
        { id: 'pin', pinned: true, updatedAt: 2 },
      ];
      expect(
        items.sort(byPinnedThenRecent).map((each) => each.id),
      ).to.deep.equal(['pin', 'new', 'old']);
    });
  });

  describe('macros', () => {
    const now = new Date(Date.UTC(2026, 0, 5, 9, 7));

    it('gives UTC values to the Worker', () => {
      expect(builtinValues({ now, user: 'ada', utc: true })).to.deep.equal({
        date: '2026-01-05',
        time: '09:07 UTC',
        datetime: '2026-01-05 09:07 UTC',
        user: 'ada',
      });
    });

    it('leaves the user out when it is not known', () => {
      expect(builtinValues({ now, utc: true })).to.not.have.property('user');
    });

    it('lists the blanks that still need filling, once each, in order', () => {
      const body =
        'Hi {{ name }}, {{date}}: {{topic}} for {{name}} from {{user}}';
      expect(macroFields(body, { date: 'x' })).to.deep.equal([
        'name',
        'topic',
        'user',
      ]);
      expect(macroFields(body, { date: 'x', user: 'ada' })).to.deep.equal([
        'name',
        'topic',
      ]);
    });

    it('fills in what it has and leaves the rest as written', () => {
      expect(
        expandMacro('{{greeting}}, {{ name }}! {{missing}} {{toString}}', {
          greeting: 'Hello',
          name: 'Ada',
        }),
      ).to.equal('Hello, Ada! {{missing}} {{toString}}');
    });
  });

  describe('bookmarklets', () => {
    it('wraps code as an address a bookmark can hold', () => {
      const url = bookmarkletUrl("alert('hi') // done");
      expect(url.startsWith('javascript:')).to.equal(true);
      expect(decodeURIComponent(url.slice('javascript:'.length))).to.equal(
        "(function(){alert('hi') // done\n})();",
      );
    });

    it('leaves a ready-made address alone', () => {
      expect(bookmarkletUrl('  javascript:void(0) ')).to.equal(
        'javascript:void(0)',
      );
    });
  });

  describe('toMessage', () => {
    it('posts clips and notes as they are', () => {
      expect(toMessage({ kind: 'clip', body: 'plain' })).to.equal('plain');
    });

    it('puts snippets and bookmarklets in code blocks', () => {
      expect(
        toMessage({ kind: 'snippet', body: 'x = 1', lang: 'py' }),
      ).to.equal('```py\nx = 1\n```');
      expect(
        toMessage({ kind: 'bookmarklet', body: 'x()', lang: '' }),
      ).to.equal('```js\nx()\n```');
    });

    it('keeps text from closing its own code block', () => {
      const message = toMessage({ kind: 'snippet', body: 'a ``` b', lang: '' });
      expect(message.match(/```/g)).to.have.lengthOf(2);
    });

    it('fills in macros', () => {
      expect(
        toMessage({ kind: 'macro', body: 'On {{date}}' }, { date: 'today' }),
      ).to.equal('On today');
    });

    it('cuts everything to the length Discord accepts', () => {
      const long = 'x'.repeat(MESSAGE_LIMIT * 2);
      for (const kind of ['clip', 'note', 'macro', 'snippet', 'bookmarklet']) {
        const message = toMessage({ kind, body: long, lang: 'js' });
        expect(message, kind).to.have.lengthOf(MESSAGE_LIMIT);
      }
      expect(
        toMessage({ kind: 'snippet', body: long, lang: 'js' }).endsWith(
          '…\n```',
        ),
      ).to.equal(true);
    });
  });
});
