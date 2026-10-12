const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { createTestApp } = require('./helpers');

const vote = (env, track, client, value) => env.api.post('/api/ratings').send({ track, client, value }).expect(200);
const tracksOf = (count) => Array.from({ length: count }, (_, i) => `Artist - Title ${i + 1}`);

describe('GET /api/ratings', () => {
  let env;
  beforeEach(async () => {
    env = await createTestApp();
  });
  afterEach(() => env.close());

  describe('validation', () => {
    const expectBad = async (query) => {
      const res = await env.api.get('/api/ratings').query(query).expect(400).expect('Content-Type', /json/);
      assert.deepEqual(res.body, { error: 'client and 1 to 20 tracks are required' });
    };

    it('returns 400 without a client', () => expectBad({ track: 'A - B' }));
    it('returns 400 with an empty client', () => expectBad({ client: '', track: 'A - B' }));
    it('returns 400 with a client of 101 characters', () => expectBad({ client: 'c'.repeat(101), track: 'A - B' }));
    it('returns 400 with two client params', () => expectBad({ client: ['a', 'b'], track: 'A - B' }));
    it('returns 400 without a track', () => expectBad({ client: 'alice' }));
    it('returns 400 with an empty track', () => expectBad({ client: 'alice', track: '' }));
    it('returns 400 with 21 tracks', () => expectBad({ client: 'alice', track: tracksOf(21) }));
    it('returns 400 with a track of 501 characters', () => expectBad({ client: 'alice', track: 't'.repeat(501) }));
    it('returns 400 when one track of many is not valid', () =>
      expectBad({ client: 'alice', track: ['A - B', 'x'.repeat(501), 'C - D'] }));
    it('returns 400 with no parameters at all', () => expectBad({}));

    it('accepts 20 tracks, a track of 500 characters and a client of 100 characters', async () => {
      const long = 't'.repeat(500);
      const res = await env.api.get('/api/ratings').query({ client: 'c'.repeat(100), track: [...tracksOf(19), long] });
      assert.equal(res.status, 200);
      assert.equal(Object.keys(res.body).length, 20);
      assert.deepEqual(res.body[long], { up: 0, down: 0, mine: 0 });
    });
  });

  describe('answers', () => {
    it('returns zeros for a track that nobody rated', async () => {
      const res = await env.api.get('/api/ratings').query({ client: 'alice', track: 'A - B' }).expect(200);
      assert.deepEqual(res.body, { 'A - B': { up: 0, down: 0, mine: 0 } });
    });

    it('returns { up, down, mine } for each track of a batch', async () => {
      const [one, two, three, four] = ['One - Song', 'Two - Song', 'Three - Song', 'Four - Song'];
      await vote(env, one, 'alice', 1);
      await vote(env, one, 'bob', 1);
      await vote(env, one, 'carol', -1);
      await vote(env, two, 'alice', -1);
      await vote(env, two, 'bob', -1);
      await vote(env, three, 'bob', 1);

      const res = await env.api
        .get('/api/ratings')
        .query({ client: 'alice', track: [one, two, three, four] })
        .expect(200);
      assert.deepEqual(res.body, {
        [one]: { up: 2, down: 1, mine: 1 },
        [two]: { up: 0, down: 2, mine: -1 },
        [three]: { up: 1, down: 0, mine: 0 },
        [four]: { up: 0, down: 0, mine: 0 },
      });
    });

    it('returns the same totals but a different "mine" for each client', async () => {
      await vote(env, 'A - B', 'alice', 1);
      await vote(env, 'A - B', 'bob', -1);
      const query = (client) => env.api.get('/api/ratings').query({ client, track: 'A - B' }).expect(200);
      assert.deepEqual((await query('alice')).body, { 'A - B': { up: 1, down: 1, mine: 1 } });
      assert.deepEqual((await query('bob')).body, { 'A - B': { up: 1, down: 1, mine: -1 } });
      assert.deepEqual((await query('carol')).body, { 'A - B': { up: 1, down: 1, mine: 0 } });
    });

    it('returns one entry when the same track is in the request twice', async () => {
      await vote(env, 'A - B', 'alice', 1);
      const res = await env.api.get('/api/ratings').query({ client: 'alice', track: ['A - B', 'A - B'] }).expect(200);
      assert.deepEqual(res.body, { 'A - B': { up: 1, down: 0, mine: 1 } });
    });

    it('treats a track name as data: Unicode, quotes, commas, braces and SQL text', async () => {
      const names = [
        '中文 - 歌曲',
        `It's - "Quoted", {Braced}`,
        'Back\\slash - Title',
        `x'; DROP TABLE ratings; --`,
        'A - B',
      ];
      for (const name of names) await vote(env, name, 'alice', 1);
      const res = await env.api.get('/api/ratings').query({ client: 'alice', track: names }).expect(200);
      assert.deepEqual(Object.keys(res.body).sort(), [...names].sort());
      for (const name of names) assert.deepEqual(res.body[name], { up: 1, down: 0, mine: 1 }, name);
    });

    it('matches a track name exactly, with case and spaces', async () => {
      await vote(env, 'Artist - Title', 'alice', 1);
      const res = await env.api
        .get('/api/ratings')
        .query({ client: 'alice', track: ['artist - title', 'Artist - Title ', 'Artist - Title'] })
        .expect(200);
      assert.deepEqual(res.body, {
        'artist - title': { up: 0, down: 0, mine: 0 },
        'Artist - Title ': { up: 0, down: 0, mine: 0 },
        'Artist - Title': { up: 1, down: 0, mine: 1 },
      });
    });
  });
});
