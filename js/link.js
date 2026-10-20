/* ==========================================================================
   3D LABYRINTH - PHONE CONTROLLER LINK
   Phone (controller.html) -> TV / game over a WebRTC data channel.

   Browsers cannot discover each other on a LAN, so the two pages are
   introduced once through the free public PeerJS signalling server
   (0.peerjs.com) using the official PeerJS client (js/lib/peerjs.min.js,
   v1.5.5, MIT - see js/lib/peerjs.LICENSE.txt). Only the connection
   handshake passes through it; game data then flows directly between the
   devices. Use of this service was approved by the project owner on
   2026-10-20. STUN (Google) only helps the devices learn how to reach each
   other. PeerJS's default TURN relays are deliberately NOT used (they would
   carry game data through a third party), so iceServers is overridden.
   ========================================================================== */

export const LINK = {
  HOST: '0.peerjs.com',
  PREFIX: 'lab3d-v1-',                                   // namespaced ids on the shared public server
  ICE: [{ urls: 'stun:stun.l.google.com:19302' }],
  CONNECT_TIMEOUT_MS: 20000   // finding a direct route (incl. resolving the browsers' private .local names) can take a while
};

const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');

function makePeer(id) {
  if (typeof window.Peer !== 'function') throw new Error('Pairing library missing: reload the page');
  return new window.Peer(id, {
    host: LINK.HOST, port: 443, secure: true, path: '/', key: 'peerjs',
    config: { iceServers: LINK.ICE },  // STUN only: no TURN relay
    debug: 1
  });
}

/** Resolve when the PeerJS client has registered its id with the server (never wait forever). */
function whenOpen(peer, ms = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { cleanup(); reject(Object.assign(new Error('timeout'), { type: 'network' })); }, ms);
    const cleanup = () => { clearTimeout(t); peer.off('open', onOpen); peer.off('error', onErr); };
    const onErr = err => { cleanup(); reject(err); };
    const onOpen = () => { cleanup(); resolve(); };
    peer.on('open', onOpen);
    peer.on('error', onErr);
  });
}

const friendly = err => {
  if (!err) return 'Unknown pairing error';
  if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error') return 'Cannot reach the pairing service (internet needed for pairing)';
  if (err.type === 'browser-incompatible') return 'This browser cannot make direct connections (WebRTC missing)';
  return err.message || String(err);
};

/** Wire a DataConnection's events to the link callbacks. */
function bindConn(conn, onMessage, onStatus) {
  conn.on('open', () => onStatus('connected'));
  conn.on('data', m => { if (m && typeof m === 'object') onMessage(m); });
  conn.on('close', () => onStatus('lost'));
  conn.on('iceStateChanged', s => { if (s === 'failed') onStatus('failed'); else if (s === 'disconnected') onStatus('lost'); });
}

/**
 * TV / game side: registers a random 6-digit code and waits for a phone to call it.
 * 6 digits (900,000 codes, cryptographically random) so an active code can't practically be guessed.
 * A newer phone replaces an older one. onStatus: 'waiting' | 'phone' | 'connected' | 'lost' | 'failed'.
 */
export class TVLink {
  constructor({ onMessage, onStatus }) { this.onMessage = onMessage; this.onStatus = onStatus; this.peer = null; this.conn = null; this.code = null; }

  async start() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
      const peer = makePeer(LINK.PREFIX + code);
      try {
        await whenOpen(peer);
      } catch (err) {
        peer.destroy();
        if (err.type === 'unavailable-id') continue; // another game is using this code: pick another
        throw new Error(friendly(err));
      }
      this.peer = peer; this.code = code;
      peer.on('connection', conn => {
        if (this.conn) this.conn.close();
        this.conn = conn;
        this.onStatus('phone'); // a phone called this code; next comes the direct connection
        bindConn(conn, m => this.onMessage(m), s => { if (this.conn === conn) this.onStatus(s); });
      });
      peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); }); // keep the code registered
      peer.on('error', err => console.warn('[Link] TV:', err.type, err.message));
      this.onStatus('waiting');
      return code;
    }
    throw new Error('Could not get a free pairing code, try again');
  }

  send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }
  get connected() { return !!(this.conn && this.conn.open); }
  stop() { if (this.conn) this.conn.close(); if (this.peer) this.peer.destroy(); this.conn = this.peer = null; }
}

/** Phone side: calls the TV that registered `code`. onStatus: 'answered' | 'connected' | 'lost' | 'failed'. */
export class PadLink {
  constructor({ onMessage, onStatus }) { this.onMessage = onMessage; this.userStatus = onStatus; this.peer = null; this.conn = null; }

  async connect(code) {
    this.stop();
    const tvId = LINK.PREFIX + code;
    const peer = this.peer = makePeer(`${tvId}-pad-${rand(6)}`);
    try { await whenOpen(peer); } catch (err) { this.stop(); throw new Error(friendly(err)); }
    return new Promise((resolve, reject) => {
      let answered = false, settled = false;
      const done = (err) => {
        if (settled) return;
        settled = true; clearTimeout(t);
        if (err) { this.stop(); reject(err); } else resolve();
      };
      const noGame = () => new Error(`No game found with code ${code}. Check the code on the screen, and that the game there shows "Waiting for the phone".`);
      const noRoute = () => new Error('Found the game, but this phone and the screen could not connect directly. Check both are on the same Wi-Fi (phone not on mobile data, no VPN), and that it is not a guest network that blocks devices talking to each other.');
      const t = setTimeout(() => done(answered ? noRoute() : noGame()), LINK.CONNECT_TIMEOUT_MS);
      // The server says straight away when nobody is registered under that code
      peer.on('error', err => { if (err.type === 'peer-unavailable') done(noGame()); else if (!settled) done(new Error(friendly(err))); });
      const conn = this.conn = peer.connect(tvId, { reliable: true, serialization: 'json', label: 'pad' });
      bindConn(conn, m => this.onMessage(m), s => {
        if (this.conn !== conn) return;
        if (s === 'connected') done();
        if (s === 'failed' && !settled) { done(noRoute()); return; }
        if (settled) this.userStatus(s);
      });
      // ICE "checking" means the screen answered: we found the game, now finding a direct route
      conn.on('iceStateChanged', s => { if (s === 'checking' && !answered) { answered = true; this.userStatus('answered'); } });
    }).then(() => this.userStatus('connected'));
  }

  send(obj) { if (this.conn && this.conn.open) this.conn.send(obj); }
  stop() { if (this.conn) this.conn.close(); if (this.peer) this.peer.destroy(); this.conn = this.peer = null; }
}
