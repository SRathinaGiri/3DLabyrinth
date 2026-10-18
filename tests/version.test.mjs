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
