const http = require('node:http');
const { loadConfig } = require('./config');
const { createPool, migrate, waitForDatabase } = require('./db');
const { createApp } = require('./app');

// NGINX keeps idle upstream connections open for 60 s by default. Node must keep
// them open longer, or NGINX can send a request on a connection that Node closes
// at that moment (a 502). headersTimeout must be above keepAliveTimeout.
const KEEP_ALIVE_TIMEOUT_MS = 65000;
const HEADERS_TIMEOUT_MS = 66000;
// Time limit for open requests after SIGTERM. By default, Compose sends SIGKILL
// 10 s after SIGTERM and Kubernetes 30 s after it.
const SHUTDOWN_TIMEOUT_MS = 10000;

async function start() {
  const config = loadConfig();
  const pool = createPool(config);
  let server;
  try {
    await waitForDatabase(pool);
    await migrate(pool);
    const app = createApp({ pool, streamsFile: config.streamsFile, serveStatic: config.serveStatic });
    app.set('trust proxy', config.trustProxy);
    server = http.createServer(app);
    server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
    server.headersTimeout = HEADERS_TIMEOUT_MS;
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, config.host, resolve);
    });
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }

  const { address, port } = server.address();
  // Keep the "Listening on" text: people and scripts look for it (audit N19).
  console.log(`Listening on http://${address.includes(':') ? `[${address}]` : address}:${port}`);

  // After close(), Node keeps a keep-alive connection open when its last request
  // ends. So during shutdown, each answer tells the client to close the connection,
  // and each connection closes as soon as it is idle.
  let closing = false;
  const open = new Set();
  server.on('request', (req, res) => {
    open.add(res);
    if (closing) res.setHeader('Connection', 'close');
    res.on('close', () => {
      open.delete(res);
      if (closing) setImmediate(() => server.closeIdleConnections());
    });
  });

  // Stop new connections, let open requests finish, close the pool, then exit 0.
  function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`${signal} received. Closing the server.`);
    setTimeout(() => {
      console.error(`Open requests did not finish in ${SHUTDOWN_TIMEOUT_MS / 1000} s. Exit now.`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
    for (const res of open) if (!res.headersSent) res.setHeader('Connection', 'close');
    // With no open server and no pool, nothing keeps Node busy, so it exits with code 0.
    server.close(() => {
      pool.end().then(
        () => console.log('Server and database pool closed.'),
        (err) => {
          console.error(`Cannot close the database pool: ${err.message}`);
          process.exitCode = 1;
        }
      );
    });
    server.closeIdleConnections();
  }
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error(`Cannot start: ${err.message}`);
  process.exit(1);
});
