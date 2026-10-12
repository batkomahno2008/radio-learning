const assert = require('node:assert/strict');
const path = require('node:path');
const { describe, it } = require('node:test');
const { loadConfig } = require('../../config');

const URL_OK = 'postgres://radio:s3cret-pass@db:5432/radio';
const load = (env = {}) => loadConfig({ DATABASE_URL: URL_OK, ...env });

describe('loadConfig', () => {
  it('uses the defaults', () => {
    const config = load();
    assert.equal(config.databaseUrl, URL_OK);
    assert.equal(config.host, '127.0.0.1');
    assert.equal(config.port, 3000);
    assert.equal(config.streamsFile, path.resolve(__dirname, '../../stream_URL.txt'));
    assert.equal(config.serveStatic, true);
    assert.equal(config.trustProxy, false);
  });

  it('reads the values from the environment', () => {
    const config = load({ HOST: '0.0.0.0', PORT: '8081', STREAMS_FILE: 'tests/fixtures/streams.txt', SERVE_STATIC: 'false', TRUST_PROXY: '1' });
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 8081);
    assert.equal(config.streamsFile, path.resolve('tests/fixtures/streams.txt'));
    assert.equal(config.serveStatic, false);
    assert.equal(config.trustProxy, 1);
  });

  it('accepts the postgresql:// scheme and port 0', () => {
    assert.equal(load({ DATABASE_URL: 'postgresql://u:p@h/d', PORT: '0' }).port, 0);
  });

  describe('DATABASE_URL', () => {
    for (const [name, value, text] of [
      ['is missing', undefined, /DATABASE_URL is not set/],
      ['is empty', '', /DATABASE_URL is not set/],
      ['is not a URL', 'not a url', /not a valid URL/],
      ['has another scheme', 'mysql://u:p@h/d', /must start with postgres/],
    ]) {
      it(`stops the start when it ${name}`, () => {
        assert.throws(() => loadConfig({ DATABASE_URL: value }), text);
      });
    }

    it('never shows the value, because it holds the password', () => {
      for (const value of ['mysql://radio:s3cret-pass@db/radio', 's3cret-pass']) {
        assert.throws(
          () => loadConfig({ DATABASE_URL: value }),
          (err) => !err.message.includes('s3cret-pass')
        );
      }
    });
  });

  describe('PORT', () => {
    for (const value of ['abc', '-1', '65536', '1.5', '3000 ']) {
      it(`stops the start for "${value}"`, () => assert.throws(() => load({ PORT: value }), /PORT must be a number/));
    }
    it('uses the default for an empty value', () => assert.equal(load({ PORT: '' }).port, 3000));
  });

  describe('SERVE_STATIC', () => {
    for (const [value, expected] of [['true', true], ['1', true], ['false', false], ['0', false], ['', true]]) {
      it(`reads "${value}" as ${expected}`, () => assert.equal(load({ SERVE_STATIC: value }).serveStatic, expected));
    }
    it('stops the start for another value', () => {
      assert.throws(() => load({ SERVE_STATIC: 'yes' }), /SERVE_STATIC must be true or false, not "yes"/);
    });
  });

  describe('TRUST_PROXY', () => {
    for (const [value, expected] of [[undefined, false], ['', false], ['false', false], ['true', true], ['0', 0], ['1', 1], ['2', 2], ['loopback, 10.0.0.0/8', 'loopback, 10.0.0.0/8']]) {
      it(`reads ${JSON.stringify(value)} as ${JSON.stringify(expected)}`, () => {
        assert.equal(load({ TRUST_PROXY: value }).trustProxy, expected);
      });
    }
    it('stops the start for a value that Express does not accept', () => {
      assert.throws(() => load({ TRUST_PROXY: 'yes' }), /TRUST_PROXY must be false, true, a number of hops or a list of addresses/);
    });
  });
});
