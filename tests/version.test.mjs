// Every release must bump the version everywhere, including the service-worker cache name;
// otherwise installed PWAs keep serving the old cache. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSION } from '../js/config.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('version is identical in config, service worker, manifest and index.html', () => {
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
  const sw = read('sw.js').match(/CACHE_VERSION = 'labyrinth-v([\d.]+)'/);
  assert.ok(sw, 'CACHE_VERSION not found in sw.js');
  assert.equal(sw[1], VERSION, 'sw.js CACHE_VERSION not bumped');
  assert.equal(JSON.parse(read('manifest.json')).version, VERSION, 'manifest.json version not bumped');
  const html = read('index.html');
  const tags = [...html.matchAll(/v=?(\d+\.\d+\.\d+)/g)].map(m => m[1]);
  assert.ok(tags.length >= 3, 'expected badge + css + js version tags in index.html');
  for (const t of tags) assert.equal(t, VERSION, `index.html still references v${t}`);
});

test('service worker pre-caches every JS module', () => {
  const sw = read('sw.js');
  for (const m of ['app', 'config', 'maze', 'physics', 'renderer', 'board', 'materials', 'controls', 'hud3d', 'audio', 'ui']) {
    assert.ok(sw.includes(`'./js/${m}.js'`), `sw.js does not cache js/${m}.js`);
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
  for (const mod of ['config', 'maze', 'physics', 'renderer', 'board', 'materials', 'controls', 'hud3d', 'audio', 'ui']) {
    assert.equal(imports[`./js/${mod}.js`], `./js/${mod}.js?v=${VERSION}`, `import map entry for ${mod}.js`);
  }
  assert.ok(html.indexOf('type="importmap"') < html.indexOf('type="module"'), 'import map must come before the module script');
  assert.match(read('sw.js'), /cache: 'reload'/, 'service worker must pre-cache from the network');
});
