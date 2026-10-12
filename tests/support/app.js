const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

// Runs server.js on a free port with its own database and stream list, so a
// test run never reads or writes data/dev.db or stream_URL.txt.
class App {
  async start() {
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radio-learning-e2e-'));
    this.dbPath = path.join(this.dir, 'test.db');
    this.streamsFile = path.join(this.dir, 'streams.txt');
    fs.writeFileSync(this.streamsFile, '');
    const port = await freePort();
    this.url = `http://localhost:${port}/`;

    this.server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, PORT: String(port), DB_PATH: this.dbPath, STREAMS_FILE: this.streamsFile },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    await new Promise((resolve, reject) => {
      let output = '';
      const onData = (chunk) => {
        output += chunk;
        if (output.includes('Listening')) resolve();
      };
      this.server.stdout.on('data', onData);
      this.server.stderr.on('data', onData);
      this.server.once('error', reject);
      this.server.once('exit', (code) => reject(new Error(`server.js exited with code ${code}\n${output}`)));
    });
    this.db = new Database(this.dbPath);
  }

  // The server reads the stream list on every request, so this applies on the next page load.
  useStream(url) {
    fs.writeFileSync(this.streamsFile, `${url}\n`);
  }

  useRealStream() {
    fs.copyFileSync(path.join(root, 'stream_URL.txt'), this.streamsFile);
  }

  clearRatings() {
    this.db.exec('DELETE FROM ratings');
  }

  async stop() {
    this.db?.close();
    if (this.server && this.server.exitCode === null) {
      const exited = new Promise((resolve) => this.server.once('exit', resolve));
      this.server.kill();
      await exited;
    }
    if (this.dir) fs.rmSync(this.dir, { recursive: true, force: true });
  }
}

module.exports = new App();
