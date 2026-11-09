// Checks the live server: connects as a throwaway controller (never paired, so it can do nothing) and prints the ICE
// servers it is given, i.e. whether TURN (and Cloudflare TURN for browsers) is configured.  node check-live.cjs [url]
'use strict';
const crypto = require('crypto');
const WebSocket = require('ws');
const rs = require('./remote-server');
const url = process.argv[2] || 'wss://all-in-one-editor.onrender.com/remote/ws';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const der = publicKey.export({ type: 'spki', format: 'der' });
const ws = new WebSocket(url);
const done = (msg) => { console.log(msg); ws.close(); process.exit(0); };
setTimeout(() => done('timeout'), 20000);
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'challenge') {
    const signature = crypto.sign('sha256', Buffer.from(`grc-auth:controller:${m.nonce}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
    ws.send(JSON.stringify({ type: 'hello', role: 'controller', publicKey: der.toString('base64'), name: 'live-check', signature }));
  } else if (m.type === 'ready') {
    done(JSON.stringify((m.iceServers || []).map((s) => ({ urls: s.urls, hasCredential: !!s.credential }))));
  } else if (m.type === 'error') done('error ' + JSON.stringify(m));
});
ws.on('error', (e) => done('ws error ' + e.message));
