import { expect } from 'chai';
import { describe, it, beforeEach } from 'mocha';
import { ItemsDb } from '../src/items-db.js';
import { LIMITS } from '../src/items.js';
import { sqliteSql } from './helpers.js';

describe('ItemsDb', () => {
  let db;
  let clock;

  beforeEach(() => {
    clock = 1000;
    let next = 0;
    db = new ItemsDb(sqliteSql(), {
      now: () => (clock += 10),
      newId: () => `id-${(next += 1)}`,
    });
  });

  it('saves an item and reads it back', () => {
    const { item } = db.create({
      kind: 'snippet',
      title: 'Greet',
      body: 'print("hi")',
      lang: 'python',
    });
    expect(item).to.deep.equal({
      id: 'id-1',
      kind: 'snippet',
      title: 'Greet',
      body: 'print("hi")',
      lang: 'python',
      pinned: false,
      createdAt: 1010,
      updatedAt: 1010,
    });
    expect(db.get('id-1')).to.deep.equal(item);
    expect(db.get('nope')).to.equal(null);
  });

  it('can be opened again on the same database', () => {
    const sql = sqliteSql();
    new ItemsDb(sql).create({ kind: 'clip', body: 'kept' });
    expect(new ItemsDb(sql).list()).to.have.lengthOf(1);
  });

  it('refuses an invalid item with a reason', () => {
    expect(db.create({ kind: 'clip', body: '' })).to.include({ status: 400 });
    expect(db.count()).to.equal(0);
  });

  it('lists pinned items first, then the most recently changed', () => {
    db.create({ kind: 'clip', body: 'first' });
    db.create({ kind: 'clip', body: 'second' });
    db.create({ kind: 'clip', body: 'third' });
    db.update('id-1', { pinned: true });
    expect(db.list().map((item) => item.body)).to.deep.equal([
      'first',
      'third',
      'second',
    ]);
  });

  it('filters by kind and by text, and limits the count', () => {
    db.create({ kind: 'clip', body: 'alpha' });
    db.create({ kind: 'note', title: 'Alpha plan', body: 'details' });
    db.create({ kind: 'note', body: 'beta' });
    expect(db.list({ kind: 'note' })).to.have.lengthOf(2);
    expect(db.list({ query: 'ALPHA' })).to.have.lengthOf(2);
    expect(db.list({ kind: 'note', query: 'alpha' })).to.have.lengthOf(1);
    expect(db.list({ limit: 1 })).to.have.lengthOf(1);
  });

  it('treats search text literally', () => {
    db.create({ kind: 'clip', body: '100% sure' });
    db.create({ kind: 'clip', body: 'under_score' });
    db.create({ kind: 'clip', body: 'plain' });
    expect(db.list({ query: '%' })).to.have.lengthOf(1);
    expect(db.list({ query: '_' })).to.have.lengthOf(1);
  });

  it('changes an item and moves its date only for a real edit', () => {
    db.create({ kind: 'note', title: 'Old', body: 'text' });
    const pinned = db.update('id-1', { pinned: true }).item;
    expect(pinned.pinned).to.equal(true);
    expect(pinned.updatedAt).to.equal(1010);

    const edited = db.update('id-1', { title: 'New', kind: 'macro' }).item;
    expect(edited.title).to.equal('New');
    expect(edited.kind).to.equal('note');
    expect(edited.updatedAt).to.be.above(1010);
    expect(edited.createdAt).to.equal(1010);
  });

  it('reports a missing or invalid edit', () => {
    expect(db.update('nope', { title: 'x' })).to.include({ status: 404 });
    db.create({ kind: 'note', body: 'text' });
    expect(db.update('id-1', { body: ' ' })).to.include({ status: 400 });
    expect(db.get('id-1').body).to.equal('text');
  });

  it('deletes an item once', () => {
    db.create({ kind: 'clip', body: 'gone' });
    expect(db.remove('id-1')).to.equal(true);
    expect(db.remove('id-1')).to.equal(false);
    expect(db.list()).to.deep.equal([]);
  });

  it('stops at the limit', function () {
    this.timeout(10000);
    for (let index = 0; index < LIMITS.items; index += 1) {
      db.create({ kind: 'clip', body: `clip ${index}` });
    }
    expect(db.create({ kind: 'clip', body: 'one more' })).to.include({
      status: 409,
    });
    expect(db.list()).to.have.lengthOf(LIMITS.items);
  });
});
