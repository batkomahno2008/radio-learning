const assert = require('node:assert/strict');
const { afterEach, describe, it } = require('node:test');
const request = require('supertest');
const { createApp } = require('../../app');
const { loadConfig } = require('../../config');
const { captureErrors, createTestApp, writeStreamsFile } = require('./helpers');

const SECRET = 'password=hunter2';

// A pool whose database is down. The error text holds data that must not leave the app.
const brokenPool = () => ({
  query: async () => {
    throw new Error(`connect ECONNREFUSED 10.0.0.5:5432 ${SECRET}`);
  },
});

describe('system endpoints', () => {
  const envs = [];
  const make = async (options) => {
    const env = await createTestApp(options);
    envs.push(env);
    return env;
  };
  afterEach(async () => {
    while (envs.length) await envs.pop().close();
  });

  describe('GET /api/health', () => {
    it('returns 200 {"status":"ok"}', async () => {
      const { api } = await make();
      const res = await api.get('/api/health').expect(200).expect('Content-Type', /json/);
      assert.deepEqual(res.body, { status: 'ok' });
    });

    it('does not use the database: it returns 200 when the database is down', async () => {
      const app = createApp({ pool: brokenPool(), streamsFile: writeStreamsFile() });
      const res = await request(app).get('/api/health').expect(200);
      assert.deepEqual(res.body, { status: 'ok' });
    });
  });

  describe('GET /api/ready', () => {
    it('returns 200 {"status":"ready"} with a working pool', async () => {
      const { api } = await make();
      const res = await api.get('/api/ready').expect(200).expect('Content-Type', /json/);
      assert.deepEqual(res.body, { status: 'ready' });
    });

    it('returns 503 {"status":"unavailable"} with a failing pool, and shows no detail', async () => {
      const app = createApp({ pool: brokenPool(), streamsFile: writeStreamsFile() });
      const lines = await captureErrors(async () => {
        const res = await request(app).get('/api/ready').expect(503).expect('Content-Type', /json/);
        assert.deepEqual(res.body, { status: 'unavailable' });
        assert.ok(!res.text.includes('ECONNREFUSED'));
        assert.ok(!res.text.includes(SECRET));
      });
      // The detail goes to the log only.
      assert.equal(lines.length, 1);
      assert.match(lines[0], /^Readiness check failed: connect ECONNREFUSED/);
    });

    it('follows the database: 200 first, then 503 when the pool starts to fail', async () => {
      const { api, pool } = await make();
      await api.get('/api/ready').expect(200);
      pool.query = brokenPool().query;
      await captureErrors(() => api.get('/api/ready').expect(503));
    });
  });

  describe('unknown paths', () => {
    it('returns a JSON 404 for an unknown /api path, with any method', async () => {
      const { api } = await make();
      for (const send of [
        () => api.get('/api/nope'),
        () => api.post('/api/nope').send({}),
        () => api.put('/api/ratings').send({}),
        () => api.delete('/api/streams'),
        () => api.post('/api/health').send({}),
        () => api.get('/api/ratings/extra'),
        () => api.get('/api'),
      ]) {
        const res = await send().expect(404).expect('Content-Type', /json/);
        assert.deepEqual(res.body, { error: 'not found' });
      }
    });

    it('returns 404 for a path outside /api when the app serves no static files', async () => {
      const { api } = await make({ serveStatic: false });
      await api.get('/').expect(404);
      await api.get('/vendor/hls/hls.min.js').expect(404);
      await api.get('/app.js').expect(404);
    });
  });

  describe('errors', () => {
    it('returns 500 JSON with no stack trace when a handler fails, and logs the cause', async () => {
      const { api, pool } = await make();
      pool.query = brokenPool().query;
      const lines = await captureErrors(async () => {
        for (const send of [
          () => api.get('/api/ratings').query({ client: 'alice', track: 'A - B' }),
          () => api.post('/api/ratings').send({ track: 'A - B', client: 'alice', value: 1 }),
          () => api.post('/api/ratings').send({ track: 'A - B', client: 'alice', value: 0 }),
        ]) {
          const res = await send().expect(500).expect('Content-Type', /json/);
          assert.deepEqual(res.body, { error: 'internal error' });
          // The body has no stack, no file path, no cause and no secret.
          assert.doesNotMatch(res.text, /ECONNREFUSED|node_modules|app\.js|\bat \w|\.js:\d/);
          assert.ok(!res.text.includes(SECRET));
        }
      });
      assert.equal(lines.length, 3);
      assert.match(lines[0], /^GET \/api\/ratings failed: Error: connect ECONNREFUSED/);
    });

    it('does not set X-Powered-By on an answer, an error or a 404', async () => {
      const { api, pool } = await make({ serveStatic: true });
      const answers = [
        await api.get('/api/health'),
        await api.get('/api/streams'),
        await api.get('/api/nope'),
        await api.get('/'),
        await api.get('/missing-file.txt'),
        await api.post('/api/ratings').send({}),
      ];
      pool.query = brokenPool().query;
      // The last answer is a 500 from a failing pool.
      await captureErrors(async () => {
        answers.push(await api.get('/api/ratings').query({ client: 'a', track: 'b' }).expect(500));
      });
      assert.equal(answers.length, 7);
      for (const res of answers) {
        assert.equal(res.headers['x-powered-by'], undefined, res.req.path);
      }
    });
  });

  describe('static files', () => {
    it('serves /, the client files and hls.js when serveStatic is true', async () => {
      const { api } = await make({ serveStatic: true });
      const index = await api.get('/').expect(200).expect('Content-Type', /html/);
      assert.match(index.text, /<script src="\/app\.js"><\/script>/);
      await api.get('/app.js').expect(200).expect('Content-Type', /javascript/);
      await api.get('/styles.css').expect(200).expect('Content-Type', /css/);
      const hls = await api.get('/vendor/hls/hls.min.js').expect(200).expect('Content-Type', /javascript/);
      assert.ok(hls.text.length > 100000, 'hls.min.js is the real library');
    });

    it('returns 404 for / and /vendor/hls/hls.min.js when serveStatic is false', async () => {
      const { api } = await make({ serveStatic: false });
      await api.get('/').expect(404);
      await api.get('/index.html').expect(404);
      await api.get('/vendor/hls/hls.min.js').expect(404);
    });

    it('serves the API with both settings', async () => {
      for (const serveStatic of [true, false]) {
        const { api } = await make({ serveStatic });
        await api.get('/api/health').expect(200);
        await api.get('/api/streams').expect(200);
      }
    });

    it('serves static files by default when serveStatic is not given', async () => {
      const app = createApp({ pool: brokenPool(), streamsFile: writeStreamsFile() });
      await request(app).get('/').expect(200);
    });
  });

  describe('trust proxy', () => {
    // A body that is not JSON makes the error handler log "<method> <path> from <req.ip>".
    const clientIpSeenByApp = async (env, headers) => {
      const lines = await captureErrors(async () => {
        await env.api.post('/api/ratings').set('Content-Type', 'application/json').set(headers).send('{').expect(400);
      });
      assert.equal(lines.length, 1);
      return lines[0].match(/^POST \/api\/ratings from (\S+): 400/)[1];
    };

    it('uses the socket address when trust proxy is off', async () => {
      const env = await make();
      assert.match(await clientIpSeenByApp(env, { 'X-Forwarded-For': '203.0.113.7' }), /^(::ffff:)?127\.0\.0\.1$|^::1$/);
    });

    it('uses the client address from X-Forwarded-For with TRUST_PROXY=1', async () => {
      // server.js does the same: loadConfig() reads TRUST_PROXY, then app.set().
      const { trustProxy } = loadConfig({ DATABASE_URL: 'postgres://u:p@h/d', TRUST_PROXY: '1' });
      const env = await make({ trustProxy });
      assert.equal(await clientIpSeenByApp(env, { 'X-Forwarded-For': '203.0.113.7' }), '203.0.113.7');
    });

    it('trusts one hop only: a false address on the left has no effect', async () => {
      const env = await make({ trustProxy: 1 });
      const ip = await clientIpSeenByApp(env, { 'X-Forwarded-For': '198.51.100.9, 203.0.113.7' });
      assert.equal(ip, '203.0.113.7');
    });
  });
});
