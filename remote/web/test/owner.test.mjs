// PROTOCOL section 8 helpers: the approval-request check (signed by the device) and the strings this browser signs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import * as P from '../protocol.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

async function makeDevice() {
  const kp = await P.generateKeyPair();
  const spki = await P.exportSpki(kp.publicKey);
  return { kp, id: await P.idFromSpki(spki), publicKey: P.bytesToB64(spki), name: 'Home PC' };
}

async function request(dev, over = {}) {
  const m = {
    type: 'approval-request', deviceId: dev.id, approvalId: P.randomSessionId(), kind: 'pair',
    subject: { id: P.randomSessionId(), name: 'School PC', fingerprint: '1234-ABCD-5678-EF90' },
    expiresAt: Date.now() + 60000, ...over,
  };
  const s = m.subject;
  m.signature = over.signature ?? await P.signText(dev.kp.privateKey, P.approvalRequestText(m.approvalId, m.kind, s.id, s.fingerprint, m.expiresAt, s.name));
  return m;
}

test('a request signed by a paired device is shown', async () => {
  const dev = await makeDevice();
  const m = await request(dev);
  assert.equal(await P.checkApprovalRequest(m, [dev]), dev);
  assert.equal(await P.checkApprovalRequest(await request(dev, { kind: 'session' }), [dev]), dev);
});

test('the server cannot change who is asking, or send requests for devices we never paired', async () => {
  const dev = await makeDevice();
  const other = await makeDevice();
  const m = await request(dev);
  assert.equal(await P.checkApprovalRequest({ ...m, subject: { ...m.subject, name: 'Your phone' } }, [dev]), null);
  assert.equal(await P.checkApprovalRequest({ ...m, subject: { ...m.subject, fingerprint: '0000-0000-0000-0000' } }, [dev]), null);
  assert.equal(await P.checkApprovalRequest({ ...m, kind: 'session' }, [dev]), null);
  assert.equal(await P.checkApprovalRequest(await request(other), [dev]), null);     // unknown device
  assert.equal(await P.checkApprovalRequest(m, [{ ...dev, temporary: true }]), null); // an "Allow once" device can't ask
  const forged = await request(dev, { signature: await P.signText(other.kp.privateKey, 'x') });
  assert.equal(await P.checkApprovalRequest(forged, [dev]), null);
});

test('expired, far-future and malformed requests are dropped', async () => {
  const dev = await makeDevice();
  assert.equal(await P.checkApprovalRequest(await request(dev, { expiresAt: Date.now() - 1 }), [dev]), null);
  assert.equal(await P.checkApprovalRequest(await request(dev, { expiresAt: Date.now() + 3600000 }), [dev]), null);
  assert.equal(await P.checkApprovalRequest(await request(dev, { kind: 'shell' }), [dev]), null);
  assert.equal(await P.checkApprovalRequest(await request(dev, { approvalId: 'short' }), [dev]), null);
  assert.equal(await P.checkApprovalRequest(null, [dev]), null);
});

test('signed strings match the agent (IdentityUtil)', () => {
  assert.equal(P.approveText('D', 'A', 'pair', 'once'), 'grc-approve:D:A:pair:once');
  assert.equal(P.codeRequestText('D', 'R', 5), 'grc-code-request:D:R:5');
  assert.equal(P.approvalRequestText('A', 'session', 'S', 'F', 9, 'N:x'), 'grc-approval:A:session:S:F:9:N:x');
  assert.deepEqual(P.APPROVAL_CHOICES.pair.map((c) => c.value), ['deny', 'once', 'trust']);
  assert.deepEqual(P.APPROVAL_CHOICES.session.map((c) => c.value), ['deny', 'view', 'control']);
});
