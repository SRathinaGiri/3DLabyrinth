/* ==========================================================================
   3D LABYRINTH - PHONE CONTROLLER LINK
   Phone (controller.html) -> TV / game over a WebRTC data channel.

   Browsers cannot discover each other on a LAN, so the two pages are
   introduced once through the free public PeerJS signalling server
   (0.peerjs.com), using its plain WebSocket protocol (no PeerJS library).
   Only the connection handshake passes through it; game data then flows
   directly between the devices. Use of this service was approved by the
   project owner on 2026-10-20. STUN (Google) only helps the devices learn
   how to reach each other and never sees game data.
   ========================================================================== */

export const LINK = {
  HOST: '0.peerjs.com',
  KEY: 'peerjs',
  PREFIX: 'lab3d-v1-',                                   // namespaced ids on the shared public server
  ICE: [{ urls: 'stun:stun.l.google.com:19302' }],
  CONNECT_TIMEOUT_MS: 12000
};

const rand = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => (b % 36).toString(36)).join('');

/** Minimal client for the PeerJS signalling server: register an id, relay OFFER / ANSWER / CANDIDATE. */
class Signal {
  constructor(id, onMessage) { this.id = id; this.onMessage = onMessage; this.ws = null; this.hb = null; }

  open() {
    return new Promise((resolve, reject) => {
      const url = `wss://${LINK.HOST}/peerjs?key=${LINK.KEY}&id=${encodeURIComponent(this.id)}&token=${rand(10)}&version=1.5.4`;
      let settled = false;
      const ws = this.ws = new WebSocket(url);
      ws.onmessage = e => {
        let m; try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.type === 'OPEN') { settled = true; resolve(); }
        else if (m.type === 'ID-TAKEN') { settled = true; reject(new Error('ID-TAKEN')); }
        else if (m.type === 'ERROR' && !settled) { settled = true; reject(new Error((m.payload && m.payload.msg) || 'Pairing server error')); }
        else this.onMessage(m);
      };
      ws.onerror = () => { if (!settled) { settled = true; reject(new Error('Cannot reach the pairing service (internet needed for pairing)')); } };
      ws.onclose = () => clearInterval(this.hb);
      this.hb = setInterval(() => { if (ws.readyState === 1) ws.send(JSON.stringify({ type: 'HEARTBEAT' })); }, 5000);
    });
  }

  send(type, dst, payload) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ type, dst, payload })); }

  close() { clearInterval(this.hb); if (this.ws) { try { this.ws.close(); } catch (_) { /* already closed */ } } this.ws = null; }
}

/** Shared WebRTC plumbing: one reliable data channel carrying small JSON messages. */
class Peer {
  constructor(signal, remoteId, onMessage, onState) {
    this.signal = signal; this.remoteId = remoteId; this.onMessage = onMessage; this.onState = onState;
    this.pc = new RTCPeerConnection({ iceServers: LINK.ICE });
    this.dc = null; this.pending = [];
    this.pc.onicecandidate = e => { if (e.candidate) signal.send('CANDIDATE', remoteId, { candidate: e.candidate.toJSON() }); };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'failed' || s === 'closed' || s === 'disconnected') this.onState('lost');
    };
  }

  bind(dc) {
    this.dc = dc;
    dc.onopen = () => this.onState('connected');
    dc.onclose = () => this.onState('lost');
    dc.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } this.onMessage(m); };
  }

  async addCandidate(c) {
    if (!this.pc.remoteDescription) { this.pending.push(c); return; }
    try { await this.pc.addIceCandidate(c); } catch (err) { console.warn('[Link] candidate:', err.message); }
  }

  async flush() { for (const c of this.pending.splice(0)) await this.addCandidate(c); }

  send(obj) { if (this.dc && this.dc.readyState === 'open') this.dc.send(JSON.stringify(obj)); }

  close() { try { this.dc && this.dc.close(); } catch (_) { /* closed */ } try { this.pc.close(); } catch (_) { /* closed */ } }
}

/**
 * TV / game side: registers a random 4-digit code and waits for a phone to call it.
 * A newer phone replaces an older one. onStatus: 'waiting' | 'connected' | 'lost' | 'error:<msg>'.
 */
export class TVLink {
  constructor({ onMessage, onStatus }) { this.onMessage = onMessage; this.onStatus = onStatus; this.peer = null; this.signal = null; this.code = null; }

  async start() {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = String(Math.floor(1000 + Math.random() * 9000));
      const signal = new Signal(LINK.PREFIX + code, m => this.handle(m));
      try {
        await signal.open();
        this.signal = signal; this.code = code;
        this.onStatus('waiting');
        return code;
      } catch (err) {
        signal.close();
        if (err.message !== 'ID-TAKEN') throw err; // another game is using this code: pick another
      }
    }
    throw new Error('Could not get a free pairing code, try again');
  }

  async handle(m) {
    if (m.type === 'OFFER' && m.payload && m.payload.sdp) {
      if (this.peer) this.peer.close();
      const peer = this.peer = new Peer(this.signal, m.src, msg => this.onMessage(msg), s => { if (this.peer === peer) this.onStatus(s); });
      peer.pc.ondatachannel = e => peer.bind(e.channel);
      await peer.pc.setRemoteDescription(m.payload.sdp);
      await peer.flush();
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.signal.send('ANSWER', m.src, { sdp: { type: answer.type, sdp: answer.sdp } });
    } else if (m.type === 'CANDIDATE' && this.peer && m.src === this.peer.remoteId && m.payload) {
      await this.peer.addCandidate(m.payload.candidate);
    }
  }

  send(obj) { if (this.peer) this.peer.send(obj); }
  get connected() { return !!(this.peer && this.peer.dc && this.peer.dc.readyState === 'open'); }
  stop() { if (this.peer) this.peer.close(); if (this.signal) this.signal.close(); this.peer = this.signal = null; }
}

/** Phone side: calls the TV that registered `code`. */
export class PadLink {
  constructor({ onMessage, onStatus }) { this.onMessage = onMessage; this.userStatus = onStatus; this.peer = null; this.signal = null; this.resolveOpen = null; }

  status(s) {
    if (s === 'connected' && this.resolveOpen) { this.resolveOpen(); this.resolveOpen = null; }
    this.userStatus(s);
  }

  async connect(code) {
    this.stop();
    const tvId = LINK.PREFIX + code;
    const signal = this.signal = new Signal(`${tvId}-pad-${rand(6)}`, m => this.handle(m));
    await signal.open();
    const peer = this.peer = new Peer(signal, tvId, msg => this.onMessage(msg), s => { if (this.peer === peer) this.status(s); });
    peer.bind(peer.pc.createDataChannel('pad'));
    const offer = await peer.pc.createOffer();
    await peer.pc.setLocalDescription(offer);
    signal.send('OFFER', tvId, { sdp: { type: offer.type, sdp: offer.sdp } });
    // No answer in time = no game is showing that code (or it was mistyped)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.resolveOpen = null; reject(new Error(`No game found with code ${code}. Check the code on the TV.`)); }, LINK.CONNECT_TIMEOUT_MS);
      this.resolveOpen = () => { clearTimeout(t); resolve(); };
    });
  }

  async handle(m) {
    if (!this.peer || m.src !== this.peer.remoteId) return;
    if (m.type === 'ANSWER' && m.payload && m.payload.sdp) {
      await this.peer.pc.setRemoteDescription(m.payload.sdp);
      await this.peer.flush();
    } else if (m.type === 'CANDIDATE' && m.payload) {
      await this.peer.addCandidate(m.payload.candidate);
    }
  }

  send(obj) { if (this.peer) this.peer.send(obj); }
  stop() { if (this.peer) this.peer.close(); if (this.signal) this.signal.close(); this.peer = this.signal = null; }
}
