const assert = require('node:assert/strict');
const fs = require('node:fs');
const { afterEach, beforeEach, describe, it } = require('node:test');
const { createTestApp } = require('./helpers');

describe('GET /api/streams', () => {
  let env;
  beforeEach(async () => {
    env = await createTestApp();
  });
  afterEach(() => env.close());

  it('parses bare URLs, "Name | URL" lines, comments, blank lines and non-HTTP lines', async () => {
    const res = await env.api.get('/api/streams').expect(200).expect('Content-Type', /json/);
    assert.deepEqual(res.body, [
      // A bare URL gets its host name as the name.
      { name: 'one.test', url: 'https://one.test/live.m3u8' },
      { name: 'Station Two', url: 'https://two.test/hls/live.m3u8' },
      // Spaces around the name and the URL are removed. Plain HTTP is allowed.
      { name: 'Station Four', url: 'http://four.test:8000/stream' },
      // An empty name gets the host name.
      { name: 'five.test', url: 'https://five.test/live.m3u8' },
    ]);
  });

  it('skips lines that start with # even when they hold a URL', async () => {
    fs.writeFileSync(env.streamsFile, '# https://hidden.test/live\nhttps://shown.test/live\n');
    const res = await env.api.get('/api/streams').expect(200);
    assert.deepEqual(res.body, [{ name: 'shown.test', url: 'https://shown.test/live' }]);
  });

  it('accepts the scheme in upper case and a "|" inside the URL', async () => {
    fs.writeFileSync(env.streamsFile, 'HTTPS://Upper.test/live\nName | https://pipe.test/a|b\n');
    const res = await env.api.get('/api/streams').expect(200);
    assert.deepEqual(res.body, [
      { name: 'upper.test', url: 'HTTPS://Upper.test/live' },
      // Only the first "|" splits the name from the URL.
      { name: 'Name', url: 'https://pipe.test/a|b' },
    ]);
  });

  it('returns an empty list for an empty file and for a file with no valid line', async () => {
    fs.writeFileSync(env.streamsFile, '');
    assert.deepEqual((await env.api.get('/api/streams').expect(200)).body, []);
    fs.writeFileSync(env.streamsFile, '# only a comment\nftp://x.test/y\n');
    assert.deepEqual((await env.api.get('/api/streams').expect(200)).body, []);
  });

  it('reads the file again on each request', async () => {
    assert.equal((await env.api.get('/api/streams')).body.length, 4);
    fs.writeFileSync(env.streamsFile, 'https://new.test/live\n');
    const res = await env.api.get('/api/streams').expect(200);
    assert.deepEqual(res.body, [{ name: 'new.test', url: 'https://new.test/live' }]);
  });

  it('returns 500 with a JSON error when the file is missing', async () => {
    fs.rmSync(env.streamsFile);
    const res = await env.api.get('/api/streams').expect(500).expect('Content-Type', /json/);
    assert.deepEqual(res.body, { error: 'stream list is unavailable' });
    // The answer must not show the path of the file.
    assert.ok(!res.text.includes(env.streamsFile));
  });
});
