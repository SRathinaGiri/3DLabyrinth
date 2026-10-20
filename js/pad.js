/* ==========================================================================
   3D LABYRINTH - PHONE CONTROLLER PAGE (controller.html)
   Reads the phone's tilt (gyro, or a drag in the circle) and streams it to
   the game on the TV / glasses screen through link.js, ~30 times a second.
   ========================================================================== */

import { ControlsHandler } from './controls.js';
import { PadLink } from './link.js';

const $ = id => document.getElementById(id);
const SEND_HZ = 30;

const controls = new ControlsHandler();
controls.bindDragJoystick($('tiltZone'), $('joystick'));
controls.onAction = a => { if (['pause', 'confirm', 'view', 'restart'].includes(a)) press(a); }; // a keyboard on the phone, rarely

let connected = false, lastSend = 0, lastTime = 0;

const link = new PadLink({
  onMessage: m => { if (m && m.t === 'state') showState(m); },
  onStatus: s => {
    if (s === 'answered') setStatus('✅ Found the game · connecting directly over Wi-Fi…');
    if (s === 'connected') { connected = true; showPad(true); setStatus(''); }
    if (s === 'lost' || s === 'failed') { connected = false; showPad(false); setStatus('⚠ Lost the connection. Enter the code again.'); }
  }
});

function setStatus(text) { $('padStatus').textContent = text; }

function showPad(on) {
  $('pairCard').classList.toggle('hidden', on);
  $('padCard').classList.toggle('hidden', !on);
}

function press(b) {
  if (!connected) return;
  link.send({ t: 'btn', b });
  if (navigator.vibrate) { try { navigator.vibrate(15); } catch (_) { /* unsupported */ } }
}

function showState(m) {
  const names = { MENU: 'Menu', COUNTDOWN: 'Get ready', PLAYING: 'Playing', PAUSED: 'Paused', COMPLETE: 'Level clear!', FAILED: "Time's up" };
  const parts = [`Level ${m.lv}`, names[m.s] || m.s];
  if (m.balls) parts.push(`${m.home}/${m.balls} home`);
  if (m.left !== null && m.left !== undefined && m.s === 'PLAYING') parts.push(`⏳ ${Math.floor(m.left / 60)}:${String(m.left % 60).padStart(2, '0')}`);
  parts.push(`❤ ${m.lives}`);
  $('tvStatus').textContent = parts.join(' · ');
  $('panelHint').textContent = m.panel ? `On screen: ${m.panel}. Use ◀ ▶ and OK.` : (m.s === 'MENU' ? 'Press OK to start.' : '');
}

async function connect() {
  const code = $('codeInput').value.trim();
  if (!/^\d{4}$/.test(code)) { setStatus('Enter the 4-digit code shown on the TV.'); return; }
  $('connectBtn').disabled = true;
  setStatus('⏳ Connecting…');
  // Inside the tap: motion permission (iOS), keep the screen on, and stop the screen rotating while tilting
  const gyroOk = await controls.enableGyro();
  $('gyroHint').textContent = gyroOk ? 'Tilt the phone to tilt the board (or drag in the circle)' : 'No motion sensor: drag in the circle to tilt';
  controls.requestWakeLock();
  // Best effort and never awaited: some browsers never settle the full-screen promise, and the
  // connection must not wait on it (the phone's own rotation lock also works)
  const fs = document.fullscreenEnabled && !document.fullscreenElement ? document.documentElement.requestFullscreen({ navigationUI: 'hide' }) : Promise.resolve();
  fs.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('portrait')).catch(() => {});
  try {
    await link.connect(code);
    controls.calibrate(); // hold the phone comfortably: that is "flat"
  } catch (err) {
    setStatus(`⚠ ${err.message}`);
    link.stop();
  } finally {
    $('connectBtn').disabled = false;
  }
}

function loop(t) {
  const dt = Math.min(0.05, Math.max(0.001, (t - (lastTime || t)) / 1000));
  lastTime = t;
  const tilt = controls.update(dt);
  $('tiltDot').style.transform = `translate(calc(-50% + ${tilt.x * 42}%), calc(-50% + ${-tilt.y * 42}%))`;
  if (connected && t - lastSend > 1000 / SEND_HZ) {
    lastSend = t;
    link.send({ t: 'tilt', x: +tilt.x.toFixed(3), y: +tilt.y.toFixed(3) });
  }
  requestAnimationFrame(loop);
}

$('connectBtn').addEventListener('click', connect);
$('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') connect(); });
$('bOk').addEventListener('click', () => press('confirm'));
$('bPause').addEventListener('click', () => press('pause'));
$('bPrev').addEventListener('click', () => press('focusPrev'));
$('bNext').addEventListener('click', () => press('focusNext'));
$('bView').addEventListener('click', () => press('view'));
$('bLevel').addEventListener('click', () => { controls.calibrate(); $('gyroHint').textContent = 'Levelled: this hold is now flat'; });
$('disconnectBtn').addEventListener('click', () => { link.stop(); connected = false; showPad(false); setStatus('Disconnected.'); });
// A code in the address (controller.html#1234) is pre-filled; connecting still needs a tap (sensor permission)
if (/^#\d{4}$/.test(location.hash)) $('codeInput').value = location.hash.slice(1);
requestAnimationFrame(loop);
