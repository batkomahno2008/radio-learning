const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { captureErrors, createTestApp } = require('./helpers');

const TRACK = 'Artist - Title';

describe('POST /api/ratings', () => {
  let env;
  beforeEach(async () => {
    env = await createTestApp();
  });
  afterEach(() => env.close());

  const post = (body) => env.api.post('/api/ratings').send(body);
  const summary = async (client, track = TRACK) => {
    const res = await env.api.get('/api/ratings').query({ client, track }).expect(200);
    return res.body[track];
  };

  describe('changes a rating', () => {
    it('saves a thumbs up and returns the new summary', async () => {
      const res = await post({ track: TRACK, client: 'alice', value: 1 }).expect(200).expect('Content-Type', /json/);
      assert.deepEqual(res.body, { up: 1, down: 0, mine: 1 });
      assert.deepEqual(await summary('alice'), { up: 1, down: 0, mine: 1 });
    });

    it('saves a thumbs down', async () => {
      const res = await post({ track: TRACK, client: 'alice', value: -1 }).expect(200);
      assert.deepEqual(res.body, { up: 0, down: 1, mine: -1 });
    });

    it('switches a thumbs up to a thumbs down and keeps one row for the client', async () => {
      await post({ track: TRACK, client: 'alice', value: 1 }).expect(200);
      const res = await post({ track: TRACK, client: 'alice', value: -1 }).expect(200);
      assert.deepEqual(res.body, { up: 0, down: 1, mine: -1 });
      const { rows } = await env.pool.query('SELECT value FROM ratings WHERE client = $1', ['alice']);
      assert.deepEqual(rows.map((row) => row.value), [-1]);
    });

    it('does not count a vote twice when the same value comes again', async () => {
      await post({ track: TRACK, client: 'alice', value: 1 }).expect(200);
      const res = await post({ track: TRACK, client: 'alice', value: 1 }).expect(200);
      assert.deepEqual(res.body, { up: 1, down: 0, mine: 1 });
    });

    it('clears a rating with value 0 and deletes the row', async () => {
      await post({ track: TRACK, client: 'alice', value: -1 }).expect(200);
      const res = await post({ track: TRACK, client: 'alice', value: 0 }).expect(200);
      assert.deepEqual(res.body, { up: 0, down: 0, mine: 0 });
      const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM ratings');
      assert.equal(rows[0].n, 0);
    });

    it('accepts a clear when the client has no rating', async () => {
      const res = await post({ track: TRACK, client: 'alice', value: 0 }).expect(200);
      assert.deepEqual(res.body, { up: 0, down: 0, mine: 0 });
    });

    it('keeps the ratings of different tracks apart', async () => {
      await post({ track: 'One - A', client: 'alice', value: 1 }).expect(200);
      await post({ track: 'Two - B', client: 'alice', value: -1 }).expect(200);
      assert.deepEqual(await summary('alice', 'One - A'), { up: 1, down: 0, mine: 1 });
      assert.deepEqual(await summary('alice', 'Two - B'), { up: 0, down: 1, mine: -1 });
    });

    it('stores a track name that holds SQL text as data', async () => {
      const track = `x'); DROP TABLE ratings; --`;
      await post({ track, client: 'alice', value: 1 }).expect(200);
      assert.deepEqual(await summary('alice', track), { up: 1, down: 0, mine: 1 });
    });

    it('accepts the longest track (500) and the longest client (100)', async () => {
      const track = 't'.repeat(500);
      const res = await post({ track, client: 'c'.repeat(100), value: 1 }).expect(200);
      assert.deepEqual(res.body, { up: 1, down: 0, mine: 1 });
    });
  });

  describe('totals across clients', () => {
    it('adds the votes of two clients and gives each client its own "mine"', async () => {
      await post({ track: TRACK, client: 'alice', value: 1 }).expect(200);
      const bob = await post({ track: TRACK, client: 'bob', value: 1 }).expect(200);
      assert.deepEqual(bob.body, { up: 2, down: 0, mine: 1 });
      assert.deepEqual(await summary('alice'), { up: 2, down: 0, mine: 1 });

      const carol = await post({ track: TRACK, client: 'carol', value: -1 }).expect(200);
      assert.deepEqual(carol.body, { up: 2, down: 1, mine: -1 });
    });

    it('does not change the rating of another client when one client switches or clears', async () => {
      await post({ track: TRACK, client: 'alice', value: 1 }).expect(200);
      await post({ track: TRACK, client: 'bob', value: 1 }).expect(200);
      await post({ track: TRACK, client: 'alice', value: -1 }).expect(200);
      assert.deepEqual(await summary('bob'), { up: 1, down: 1, mine: 1 });
      await post({ track: TRACK, client: 'alice', value: 0 }).expect(200);
      assert.deepEqual(await summary('bob'), { up: 1, down: 0, mine: 1 });
      assert.deepEqual(await summary('alice'), { up: 1, down: 0, mine: 0 });
    });

    it('counts all votes when requests come at the same time', async () => {
      const clients = Array.from({ length: 10 }, (_, i) => `client-${i}`);
      await Promise.all(clients.map((client, i) => post({ track: TRACK, client, value: i % 2 ? -1 : 1 }).expect(200)));
      assert.deepEqual(await summary('client-0'), { up: 5, down: 5, mine: 1 });
    });
  });

  describe('validation', () => {
    const expectBad = async (req) => {
      const res = await req.expect(400).expect('Content-Type', /json/);
      assert.deepEqual(res.body, { error: 'track, client and a value of 1, 0 or -1 are required' });
      // A bad request must not write a row.
      const { rows } = await env.pool.query('SELECT count(*)::int AS n FROM ratings');
      assert.equal(rows[0].n, 0);
    };

    for (const value of [2, -2, 0.5, '1', '', null, true, [1], {}]) {
      it(`returns 400 for the value ${JSON.stringify(value)}`, () =>
        expectBad(post({ track: TRACK, client: 'alice', value })));
    }
    it('returns 400 without a value', () => expectBad(post({ track: TRACK, client: 'alice' })));
    it('returns 400 without a track', () => expectBad(post({ client: 'alice', value: 1 })));
    it('returns 400 with an empty track', () => expectBad(post({ track: '', client: 'alice', value: 1 })));
    it('returns 400 with a track that is not a string', () => expectBad(post({ track: ['a'], client: 'alice', value: 1 })));
    it('returns 400 with a track of 501 characters', () =>
      expectBad(post({ track: 't'.repeat(501), client: 'alice', value: 1 })));
    it('returns 400 without a client', () => expectBad(post({ track: TRACK, value: 1 })));
    it('returns 400 with an empty client', () => expectBad(post({ track: TRACK, client: '', value: 1 })));
    it('returns 400 with a client of 101 characters', () =>
      expectBad(post({ track: TRACK, client: 'c'.repeat(101), value: 1 })));
    it('returns 400 for an empty JSON object', () => expectBad(post({})));
    it('returns 400 for a body with another content type', () =>
      expectBad(env.api.post('/api/ratings').set('Content-Type', 'text/plain').send('track=a&client=b&value=1')));
    it('returns 400 for a request with no body', () => expectBad(env.api.post('/api/ratings')));
  });

  describe('body limits', () => {
    it('returns 400 JSON for a body that is not valid JSON, and shows no stack trace', async () => {
      const lines = await captureErrors(async () => {
        const res = await env.api
          .post('/api/ratings')
          .set('Content-Type', 'application/json')
          .send('{"track": "A - B", ')
          .expect(400)
          .expect('Content-Type', /json/);
        assert.deepEqual(res.body, { error: 'Bad Request' });
        assert.doesNotMatch(res.text, /SyntaxError|node_modules|\bat \w/);
      });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /^POST \/api\/ratings from \S+: 400 entity\.parse\.failed$/);
    });

    it('returns 400 JSON for a JSON body that is not an object (the parser is strict)', async () => {
      await captureErrors(async () => {
        for (const text of ['null', '"text"', '42']) {
          const res = await env.api.post('/api/ratings').set('Content-Type', 'application/json').send(text).expect(400);
          assert.deepEqual(res.body, { error: 'Bad Request' });
        }
      });
    });

    it('returns 413 JSON for a body above the 100 kB limit of express.json()', async () => {
      const lines = await captureErrors(async () => {
        const res = await post({ track: 't'.repeat(200 * 1024), client: 'alice', value: 1 })
          .expect(413)
          .expect('Content-Type', /json/);
        assert.deepEqual(res.body, { error: 'Payload Too Large' });
      });
      assert.equal(lines.length, 1);
      assert.match(lines[0], /413 entity\.too\.large$/);
    });

    it('accepts a body just below the limit and then returns 400 for the track length', async () => {
      // 90 kB passes the body parser. The track rule (500 characters) then applies.
      await post({ track: 't'.repeat(90 * 1024), client: 'alice', value: 1 }).expect(400);
    });

    it('returns 415 JSON for a body with an unknown charset', async () => {
      const res = await env.api
        .post('/api/ratings')
        .set('Content-Type', 'application/json; charset=nonsense')
        .send('{}')
        .expect(415)
        .expect('Content-Type', /json/);
      assert.deepEqual(res.body, { error: 'Unsupported Media Type' });
    });
  });
});
