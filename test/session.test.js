import { expect } from 'chai';
import { describe, it } from 'mocha';
import { SESSION_TTL, createSession, verifySession } from '../src/session.js';

describe('Sessions', () => {
  const secret = 'client-secret';
  const now = 1_800_000_000_000;

  it('gives back the user a token was made for', async () => {
    const token = await createSession(secret, '1234567890', { now });
    expect(token).to.match(/^v1\.1234567890\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(await verifySession(secret, token, { now })).to.equal('1234567890');
  });

  it('expires', async () => {
    const token = await createSession(secret, '1', { now });
    const justBefore = now + SESSION_TTL * 1000 - 1000;
    expect(await verifySession(secret, token, { now: justBefore })).to.equal(
      '1',
    );
    expect(
      await verifySession(secret, token, { now: now + SESSION_TTL * 1000 }),
    ).to.equal(null);
  });

  it('refuses a token signed with another secret', async () => {
    const token = await createSession('other secret', '1', { now });
    expect(await verifySession(secret, token, { now })).to.equal(null);
  });

  it('refuses a token changed after signing', async () => {
    const token = await createSession(secret, '1', { now });
    const [version, , expiry, signature] = token.split('.');
    const forged = [
      [version, '2', expiry, signature].join('.'),
      [version, '1', String(Number(expiry) + 1), signature].join('.'),
      [version, '1', expiry, `${signature.slice(0, -1)}A`].join('.'),
    ];
    for (const each of forged) {
      expect(await verifySession(secret, each, { now }), each).to.equal(null);
    }
  });

  it('refuses anything that is not a token', async () => {
    const junk = ['', 'v1', 'v1.1.2', 'v2.1.2.abc', 'a.b.c.d', 'v1.x.2.abc', 5];
    for (const each of junk) {
      expect(await verifySession(secret, each, { now }), String(each)).to.equal(
        null,
      );
    }
    const token = await createSession(secret, '1', { now });
    expect(await verifySession(undefined, token, { now })).to.equal(null);
  });

  it('only signs Discord user ids', async () => {
    let failure = null;
    try {
      await createSession(secret, '1.999999999999', { now });
    } catch (error) {
      failure = error;
    }
    expect(failure).to.be.an('error');
  });
});
