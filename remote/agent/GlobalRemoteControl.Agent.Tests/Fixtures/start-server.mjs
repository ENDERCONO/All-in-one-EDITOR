// Starts the real signaling server (remote/server/remote-server.js) on a free local port for end-to-end tests.
//   node start-server.mjs <repo root>
// Prints "PORT <n>" once listening; exits when stdin closes.
import { createRequire } from 'node:module';
import path from 'node:path';

const root = process.argv[2];
const require = createRequire(path.join(root, 'package.json'));
const http = require('http');
const express = require('express');
const rs = require(path.join(root, 'remote', 'server', 'remote-server.js'));

const app = express();
const server = http.createServer(app);
const handle = rs.attach(app, server);
server.listen(0, '127.0.0.1', () => console.log('PORT ' + server.address().port));
const stop = () => { handle.close(); server.closeAllConnections?.(); server.close(); process.exit(0); };
process.stdin.on('end', stop);
process.stdin.on('close', stop);
process.stdin.resume();
