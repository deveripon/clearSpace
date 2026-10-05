'use strict';
// Run with: HOME=<fake home> node --test test/engine.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const HOME = os.homedir();
assert.ok(HOME.includes('fakehome'), 'Refusing to run outside a fake HOME');
const { scan } = require('../engine/scan');
const { clean, verify, protectedSet } = require('../engine/clean');

const P = path.join(HOME, 'devripon');
let result;
assert.ok(true);
const byTitle = (cat, title) => result.items.find((i) => i.category === cat && i.title === title);

test('scan finds the right items', async () => {
  result = await scan({ projectRoots: ['~/devripon'], inactiveDays: 14 }, () => {});
  const summary = result.items.map((i) => `${i.category} | ${i.title} | ${i.kindLabel || ''} | ${(i.size / 1048576).toFixed(1)}MB | ${i.risk}${i.recommended ? ' REC' : ''} | ${i.paths.length}p | ${i.tags.join(', ')}`);
  console.log(summary.join('\n'));
  console.log('warnings:', result.warnings, 'took', result.tookMs, 'ms');

  // build caches grouped per project root + kind
  const monoTurbo = result.items.find((i) => i.category === 'build' && i.title === 'mono' && i.kindLabel === 'Turborepo cache');
  assert.ok(monoTurbo, 'mono turbo cache found');
  assert.strictEqual(monoTurbo.paths.length, 2, 'both .turbo folders grouped');
  assert.ok(result.items.find((i) => i.category === 'build' && i.title === 'projA' && i.kindLabel === 'Next.js build cache'));

  // node_modules: inactive+lockfile recommended, active not, no-lockfile => check
  assert.strictEqual(byTitle('deps', 'projA').recommended, true);
  assert.strictEqual(byTitle('deps', 'projB').recommended, false, 'active project not preselected');
  assert.strictEqual(byTitle('deps', 'nolock').risk, 'check');
  assert.strictEqual(byTitle('deps', 'nolock').recommended, false);
  assert.strictEqual(byTitle('deps', 'mono').paths.length, 2, 'monorepo node_modules grouped');

  // worktrees
  const wtClean = result.items.find((i) => i.title === 'agent-clean' && i.group === 'worktree');
  const wtDirty = result.items.find((i) => i.title === 'agent-dirty' && i.group === 'worktree');
  assert.ok(wtClean && !wtClean.recommended && wtClean.risk === 'check', 'clean worktree w/ unpushed commit: check, not preselected');
  assert.match(wtClean.lose, /commits? not pushed yet stay on branch wt-clean/);
  assert.ok(wtDirty && wtDirty.risk === 'locked' && !wtDirty.recommended, 'dirty worktree locked');
  const orphans = result.items.filter((i) => i.subtitle.includes('repo copy') && i.group === 'wtcopy');
  assert.strictEqual(orphans.length, 2, 'worktrees inside the copy are recognized as unlinked copies');
  assert.ok(orphans.every((o) => !o.recommended && o.action === 'trash'), 'copies go to the Trash, never rm');
  const dup = result.items.find((i) => i.title === 'repo copy');
  assert.ok(dup && dup.action === 'trash' && !dup.recommended && dup.tags.includes('Same latest commit as the original'));

  // caches
  assert.ok(byTitle('apps', 'Google Chrome'));
  assert.ok(!result.items.some((i) => /com\.apple/.test(i.subtitle)), 'Apple caches never listed');
  assert.ok(!result.items.some((i) => i.title === 'tiny'), 'tiny caches hidden');
  assert.ok(byTitle('pkg', 'npm download cache'));
  assert.ok(byTitle('pkg', 'Yarn download cache'));
  // downloads
  assert.ok(byTitle('files', 'big.dmg') && !byTitle('files', 'big.dmg').recommended);
  assert.ok(!byTitle('files', 'note.txt'));
  // symlinks never followed
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.includes('linkdir') || p.startsWith('/etc'))));
});

test('verify() refuses tampered or dangerous targets', async () => {
  const prot = protectedSet(['~/devripon']);
  const nm = byTitle('deps', 'projA');
  assert.strictEqual(await verify(nm, nm.paths[0], prot), null);
  assert.notStrictEqual(await verify(nm, path.join(P, 'projA', 'src'), prot), null, 'src is not node_modules');
  assert.notStrictEqual(await verify(nm, HOME, prot), null, 'home refused');
  assert.notStrictEqual(await verify(nm, '/etc', prot), null, 'outside home refused');
  assert.notStrictEqual(await verify(nm, path.join(P, 'projB', 'node_modules_link'), prot), null, 'symlink refused');
  assert.notStrictEqual(await verify(nm, P + '/projA/../projA/node_modules', prot), null, 'non-normalized refused');
  const chrome = byTitle('apps', 'Google Chrome');
  assert.notStrictEqual(await verify(chrome, path.join(HOME, 'Library', 'Caches'), prot), null, 'Caches root not deletable as app cache');
  assert.notStrictEqual(await verify({ ...chrome, action: 'delete' }, path.join(HOME, 'Downloads'), prot), null);
});

test('clean recommended items, keep everything else', async () => {
  const wtc = result.items.find((i) => i.title === 'agent-clean' && i.group === 'worktree');
  const chosen = [...result.items.filter((i) => i.recommended && i.risk !== 'locked'), wtc];
  // Also pick the duplicate copy to test Trash + skip of nested items.
  const dup = result.items.find((i) => i.title === 'repo copy');
  const trashed = [];
  const out = await clean([...chosen, dup], {
    projectRoots: ['~/devripon'],
    trash: async (p) => { trashed.push(p); fs.renameSync(p, path.join(HOME, '.Trash', path.basename(p))); },
  }, () => {});
  console.log(out.results.map((r) => `${r.status.padEnd(8)} ${r.title} ${r.message || ''}`).join('\n'));
  assert.ok(out.results.every((r) => r.status === 'done' || r.status === 'skipped'), 'no errors');

  // Removed
  assert.ok(!fs.existsSync(path.join(P, 'projA', 'node_modules')));
  assert.ok(!fs.existsSync(path.join(P, 'projA', '.next')));
  assert.ok(!fs.existsSync(path.join(P, 'mono', 'apps', 'web', '.next')));
  assert.ok(!fs.existsSync(path.join(P, 'repo', '.claude', 'worktrees', 'agent-clean')));
  assert.ok(fs.existsSync(path.join(HOME, 'Library', 'Caches', 'com.google.Chrome')), 'cache folder itself kept');
  assert.strictEqual(fs.readdirSync(path.join(HOME, 'Library', 'Caches', 'com.google.Chrome')).length, 0, 'cache emptied');
  assert.deepStrictEqual(trashed, [path.join(P, 'repo copy')]);

  // Kept
  assert.ok(fs.existsSync(path.join(P, 'projA', 'src', 'a.ts')), 'source kept');
  assert.ok(fs.existsSync(path.join(P, 'projB', 'node_modules')), 'active project node_modules kept');
  assert.ok(fs.existsSync(path.join(P, 'nolock', 'node_modules')), 'no-lockfile node_modules kept');
  assert.ok(fs.existsSync(path.join(P, 'repo', '.claude', 'worktrees', 'agent-dirty', 'package.json')), 'dirty worktree kept');
  assert.ok(fs.existsSync(path.join(HOME, 'Library', 'Caches', 'com.apple.Safari', 's.bin')), 'Apple cache kept');
  assert.ok(fs.existsSync(path.join(HOME, 'Downloads', 'big.dmg')), 'downloads kept');
  assert.ok(fs.existsSync('/etc/hostname') || fs.existsSync('/etc/passwd'), '/etc untouched');

  // Branch of removed worktree still exists with its commit
  const { execSync } = require('child_process');
  const log = execSync('git -C "' + path.join(P, 'repo') + '" log --oneline wt-clean', { encoding: 'utf8' });
  assert.match(log, /wt commit/);
  const wts = execSync('git -C "' + path.join(P, 'repo') + '" worktree list', { encoding: 'utf8' });
  assert.ok(!wts.includes('agent-clean'), 'worktree unregistered');
  console.log('freed (disk delta):', out.freed, 'estimated:', out.estimated);
});

test('safety review regressions', async () => {
  const E = path.join(P, 'edge');
  const wt = (name) => result.items.find((i) => i.paths[0] === path.join(E, '.claude', 'worktrees', name));
  for (const n of ['rel-dirty', 'hidden-untracked', 'detached', 'env-unique', 'clone']) {
    const it = wt(n);
    assert.ok(it, `${n} listed`);
    assert.strictEqual(it.risk, 'locked', `${n} must be locked (${it.lockedReason})`);
    console.log(`locked ${n}: ${it.lockedReason}`);
  }
  assert.notStrictEqual(wt('env-same').risk, 'locked', '.env identical to main project is not unique work');
  assert.strictEqual(wt('skipwt').risk, 'locked', 'skip-worktree secrets lock the worktree');
  const bn = wt('build-notes');
  assert.ok(bn.risk === 'check' && !bn.recommended && /build\//.test(bn.lose), 'ignored build/ is named and not preselected');
  // tracked coverage never offered
  assert.ok(!result.items.some((i) => i.paths.some((p) => p === path.join(E, 'coverage'))), 'tracked coverage skipped');
  // stray lockfile at scan root did not swallow lockfile-less project
  const nl = byTitle('deps', 'nolock');
  assert.strictEqual(nl.paths.length, 1);
  assert.strictEqual(nl.risk, 'check');

  // Even if a locked item is forced into clean(), nothing is removed.
  const forced = ['rel-dirty', 'hidden-untracked', 'detached', 'env-unique', 'clone'].map(wt).map((i) => ({ ...i, risk: 'safe' }));
  const out = await clean(forced, { projectRoots: ['~/devripon'], trash: async () => { throw new Error('no trash expected'); } }, () => {});
  console.log(out.results.map((r) => `${r.status} ${r.title}: ${r.message}`).join('\n'));
  assert.ok(out.results.every((r) => r.status === 'refused' || r.status === 'error'));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/rel-dirty/package.json')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/hidden-untracked/notes.md')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/env-unique/.env')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/clone/notes.txt')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/detached/d.txt')));

  // Same folder through two roots: scanned once, no duplicate ids.
  const r2 = await scan({ projectRoots: ['~/devripon', '~/devlink'], inactiveDays: 14 }, () => {});
  const ids = r2.items.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate items');
  assert.ok(!r2.items.some((i) => i.paths.some((p) => p.includes('devlink'))), 'symlinked root collapsed');
});
