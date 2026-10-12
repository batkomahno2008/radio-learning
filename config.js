const path = require('node:path');

// Reads and checks all environment variables of the app. Other modules get their
// settings from here and do not read process.env. Messages never show the value
// of DATABASE_URL, because it holds the database password.
function loadConfig(env = process.env) {
  return {
    databaseUrl: databaseUrl(env.DATABASE_URL),
    host: env.HOST || '127.0.0.1',
    port: port(env.PORT),
    streamsFile: path.resolve(env.STREAMS_FILE || path.join(__dirname, 'stream_URL.txt')),
    serveStatic: flag('SERVE_STATIC', env.SERVE_STATIC, true),
    trustProxy: trustProxy(env.TRUST_PROXY),
  };
}

function databaseUrl(value) {
  if (!value) {
    throw new Error('DATABASE_URL is not set. Set it to postgres://user:password@host:5432/database.');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL. Use postgres://user:password@host:5432/database.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL must start with postgres:// or postgresql://.');
  }
  return value;
}

function port(value) {
  if (value === undefined || value === '') return 3000;
  const number = Number(value);
  if (!/^\d+$/.test(value) || number > 65535) throw new Error(`PORT must be a number from 0 to 65535, not "${value}".`);
  return number;
}

function flag(name, value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true or false, not "${value}".`);
}

// The Express "trust proxy" setting: false, true, a number of proxy hops (1 for one
// NGINX), or a list of trusted addresses such as "loopback, 10.0.0.0/8".
function trustProxy(value) {
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

module.exports = { loadConfig };
