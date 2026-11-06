// This browser's controller identity: ECDSA P-256 key pair, private key non-extractable, kept in IndexedDB.
import * as P from './protocol.js';
import { kvGet, kvSet } from './store.js';

export async function loadIdentity() {
  let kp = await kvGet('keypair');
  if (!kp || !kp.privateKey || !kp.publicKey) {
    kp = await P.generateKeyPair();
    await kvSet('keypair', kp);
  }
  const spki = await P.exportSpki(kp.publicKey);
  return {
    privateKey: kp.privateKey,
    spki,
    publicKeyB64: P.bytesToB64(spki),
    id: await P.idFromSpki(spki),
    fingerprint: await P.fingerprintFromSpki(spki),
    sign: (text) => P.signText(kp.privateKey, text),
  };
}

export async function getName() {
  return (await kvGet('name')) || P.defaultDeviceName(navigator.userAgent);
}
export async function setName(name) {
  await kvSet('name', name);
}
