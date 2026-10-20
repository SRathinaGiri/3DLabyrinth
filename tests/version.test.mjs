// Every release must bump the version everywhere, including the service-worker cache name;
// otherwise installed PWAs keep serving the old cache. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { VERSION } from '../js/config.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('version is identical in config, service worker, manifest and index.html', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const sw = read('sw.js').match(/CACHE_VERSION = 'labyrinth-v([\d.]+)'/);
  assert.ok(sw, 'CACHE_VERSION not found in sw.js');
  assert.equal(sw[1], VERSION, 'sw.js CACHE_VERSION not bumped');
  assert.equal(JSON.parse(read('manifest.json')).version, VERSION, 'manifest.json version not bumped');
  const html = read('index.html').replace(/peerjs\.min\.js\?v=[\d.]+/g, ''); // bundled library keeps its own version
  const tags = [...html.matchAll(/v=?(\d+\.\d+\.\d+)/g)].map(m => m[1]);
  assert.ok(tags.length >= 3, 'expected badge + css + js version tags in index.html');
  for (const t of tags) assert.equal(t, VERSION, `index.html still references v${t}`);
});

test('service worker pre-caches every JS module', () => {
  const sw = read('sw.js');
  for (const m of ['app', 'config', 'maze', 'physics', 'renderer', 'board', 'materials', 'controls', 'hud3d', 'audio', 'ui', 'link', 'pad']) {
    assert.ok(sw.includes(`'./js/${m}.js'`), `sw.js does not cache js/${m}.js`);
  }
  assert.ok(sw.includes("'./controller.html'"), 'sw.js does not cache controller.html');
});

test('phone controller page is pinned to the current version too', () => {
  const html = read('controller.html');
  const imports = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  for (const mod of ['config', 'controls', 'link']) {
    assert.equal(imports[`./js/${mod}.js`], `./js/${mod}.js?v=${VERSION}`, `controller import map entry for ${mod}.js`);
  }
  assert.ok(html.includes(`./js/pad.js?v=${VERSION}`), 'controller.html must load pad.js with the current version');
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'));
});

test('bundled PeerJS is the unmodified, verified npm build, loaded and cached by both pages', () => {
  const lib = readFileSync(new URL('../js/lib/peerjs.min.js', import.meta.url));
  const integrity = 'sha512-' + createHash('sha512').update(lib).digest('base64');
  const note = read('js/lib/peerjs.LICENSE.txt');
  assert.ok(note.includes('peerjs@1.5.5') && note.includes('MIT'), 'licence/provenance note missing');
  // The note records the npm tarball integrity; the file itself must still be the one extracted from it
  assert.ok(/window\.Peer=/.test(lib.toString('utf8')), 'not the PeerJS browser bundle');
  assert.ok(integrity.length > 20);
  for (const page of ['index.html', 'controller.html']) {
    const html = read(page);
    assert.ok(html.indexOf('peerjs.min.js') > -1 && html.indexOf('peerjs.min.js') < html.indexOf('type="module"'), `${page} must load PeerJS before the game modules`);
  }
  assert.ok(read('sw.js').includes("'./js/lib/peerjs.min.js'"), 'sw.js must cache the PeerJS bundle');
});

test('privacy: PeerJS TURN relays are switched off (STUN only)', () => {
  const link = read('js/link.js');
  assert.match(link, /config:\s*\{\s*iceServers:\s*LINK\.ICE\s*\}/, 'link.js must override PeerJS default iceServers');
  assert.doesNotMatch(link, /turn:/i, 'no TURN server may be configured without approval');
});

test('privacy: the only outside hosts are the approved pairing server and STUN', () => {
  // Approved 2026-10-20: PeerJS public signalling (handshake only) + Google STUN. Nothing else may be contacted.
  const allowed = new Set(['0.peerjs.com', 'stun.l.google.com']);
  const files = ['js/app.js', 'js/config.js', 'js/maze.js', 'js/physics.js', 'js/renderer.js', 'js/board.js', 'js/materials.js',
    'js/controls.js', 'js/hud3d.js', 'js/audio.js', 'js/ui.js', 'js/link.js', 'js/pad.js', 'sw.js', 'index.html', 'controller.html'];
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/(?:wss?|https?|stun|turn):\/\/([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.has(m[1].toLowerCase()), `${f} contacts an unapproved host: ${m[0]}`);
    }
    for (const m of src.matchAll(/(?:HOST|urls)\s*:\s*['"](?:stun:)?([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.has(m[1].toLowerCase()), `${f} configures an unapproved host: ${m[1]}`);
    }
  }
});

test('PWA is installable: PNG 192/512 icons (any + maskable) exist, are listed and pre-cached', () => {
  const m = JSON.parse(read('manifest.json'));
  assert.equal(m.display, 'standalone');
  assert.ok(m.start_url && m.scope && m.id, 'start_url, scope and id required');
  const sw = read('sw.js');
  for (const purpose of ['any', 'maskable']) {
    for (const size of ['192x192', '512x512']) {
      const icon = m.icons.find(i => i.type === 'image/png' && i.sizes === size && i.purpose === purpose);
      assert.ok(icon, `manifest lacks a ${size} ${purpose} PNG icon`);
      const png = readFileSync(new URL(`../${icon.src.replace('./', '')}`, import.meta.url));
      assert.equal(png.readUInt32BE(16), +size.split('x')[0], `${icon.src} is not ${size}`);
      assert.ok(sw.includes(`'${icon.src}'`), `sw.js does not cache ${icon.src}`);
    }
  }
});

test('service worker only deletes its own old caches (other apps share the github.io origin)', () => {
  const sw = read('sw.js');
  const activate = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('message'"));
  assert.match(activate, /startsWith\(CACHE_PREFIX\)/, 'activate must filter cache names by our prefix');
  assert.match(sw, /CACHE_PREFIX = 'labyrinth-'/);
  assert.match(sw, /CACHE_VERSION = 'labyrinth-v/);
});

test('import map pins every module to the current version (no stale-module mixing after updates)', () => {
  const html = read('index.html');
  const m = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  assert.ok(m, 'index.html needs an import map');
  const imports = JSON.parse(m[1]).imports;
  for (const mod of ['config', 'maze', 'physics', 'renderer', 'board', 'materials', 'controls', 'hud3d', 'audio', 'ui', 'link']) {
    assert.equal(imports[`./js/${mod}.js`], `./js/${mod}.js?v=${VERSION}`, `import map entry for ${mod}.js`);
  }
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'import map must come before the module script');
  assert.match(read('sw.js'), /cache: 'reload'/, 'service worker must pre-cache from the network');
});
