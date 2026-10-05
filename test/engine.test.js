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

const P = path.join(HOME, 'Projects');
let result;
assert.ok(true);
const byTitle = (cat, title) => result.items.find((i) => i.category === cat && i.title === title);

test('scan finds the right items', async () => {
  result = await scan({ projectRoots: ['~/Projects'], inactiveDays: 14 }, () => {});
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
  const prot = protectedSet(['~/Projects']);
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

test('other stacks: only real output and installed packages are offered', async () => {
  const S = path.join(P, 'stacks');
  const at = (cat, title, label) => result.items.find((i) => i.category === cat && i.title === title && i.kindLabel === label);
  // offered
  const rust = at('build', 'rust-cli', 'Rust build output');
  assert.ok(rust && rust.recommended, 'inactive Rust target recommended');
  const rustLive = at('build', 'rust-live', 'Rust build output');
  assert.ok(rustLive && !rustLive.recommended, 'Rust target of a project used today is offered but not preselected');
  const venv = at('deps', 'py-app', 'Python virtual environment');
  assert.ok(venv && venv.risk === 'safe' && venv.recommended && venv.installCmd === 'uv sync', 'venv with uv.lock is safe');
  const reqVenv = at('deps', 'py-req', 'Python virtual environment');
  assert.ok(reqVenv && reqVenv.risk === 'check' && !reqVenv.recommended, 'requirements.txt only: check first');
  assert.ok(at('build', 'py-app', 'pytest cache'));
  const gb = at('build', 'android-app', 'Gradle build output');
  assert.ok(gb && gb.risk === 'check' && !gb.recommended, 'build/ not ignored by git: Check first');
  assert.strictEqual(at('build', 'android-git', 'Gradle build output').risk, 'safe', 'build/ ignored by git: Safe');
  assert.ok(at('build', 'android-app', 'Gradle project cache'));
  const pods = at('deps', 'ios-app', 'CocoaPods');
  assert.ok(pods.installCmd === 'pod install' && pods.risk === 'check' && !pods.recommended, 'Pods: offered, never preselected');
  const php = at('deps', 'php-site', 'Composer packages');
  assert.ok(php && php.risk === 'check', 'vendor not in git: Check first');
  // the safety review's reproductions
  const patched = at('deps', 'py-patched', 'Python virtual environment');
  assert.ok(patched.risk === 'check' && !patched.recommended && patched.tags.includes('Changed after install') && /patched\.py/.test(patched.lose), 'hand edit in a venv is named');
  const podsPatched = at('deps', 'ios-patched', 'CocoaPods');
  assert.ok(podsPatched.risk === 'check' && !podsPatched.recommended && /Session\.swift/.test(podsPatched.lose), 'hand edit in Pods is named');
  assert.strictEqual(at('deps', 'ios-extra', 'CocoaPods').risk, 'locked', 'a folder in Pods that is not a pod locks it');
  assert.strictEqual(at('deps', 'php-legacy', 'Composer packages').risk, 'locked', 'non-Composer folder in vendor locks it');
  assert.strictEqual(at('deps', 'ex-app', 'Mix dependencies').risk, 'locked', 'deps folder not in mix.lock locks it');
  const mvn = at('build', 'java-app', 'Maven build output');
  assert.ok(mvn && mvn.risk === 'safe' && !mvn.recommended, 'deep uncommitted edit counts as activity');
  assert.ok(!at('build', 'java-uni', 'Maven build output').recommended, 'new file with a non-ASCII path counts as activity');
  assert.ok(!at('build', 'java-untr', 'Maven build output').recommended, 'new file deep in a new folder counts as activity');
  // second safety review
  const older = at('deps', 'py-older', 'Python virtual environment');
  assert.ok(older.risk === 'check' && /lib1\/core\.bin/.test(older.lose), 'an older edit is not hidden by a later install');
  assert.ok(at('deps', 'py-src', 'Python virtual environment').risk === 'check', 'hand file in .venv/src');
  assert.strictEqual(at('deps', 'php-topfile', 'Composer packages').risk, 'locked', 'loose file in vendor');
  assert.strictEqual(at('deps', 'php-bin', 'Composer packages').risk, 'locked', 'own script in vendor/bin');
  assert.strictEqual(at('deps', 'ios-top', 'CocoaPods').risk, 'locked', 'loose file in Pods');
  // third safety review
  const pyBin = at('deps', 'py-bin', 'Python virtual environment');
  assert.ok(pyBin.risk === 'check' && !pyBin.recommended && /deploy\.sh|notes\.txt/.test(pyBin.lose), 'hand files in .venv/bin or share');
  assert.ok(!at('build', 'svc', 'Maven build output').recommended, 'edit in a big repo with many other changes');
  assert.strictEqual(at('build', 'gradle-docs', 'Gradle build output').risk, 'check', 'docs/ inside an ignored build/');
  const notes = at('build', 'gradle-notes', 'Gradle build output');
  assert.ok(notes.risk === 'check' && !notes.recommended && /notes/.test(notes.lose), 'notes in an ignored build/ folder');
  assert.ok(at('build', 'swift-pkg', 'Swift package build'));
  assert.ok(byTitle('pkg', 'Cargo downloaded crates') && byTitle('pkg', 'Gradle versions'));
  assert.strictEqual(byTitle('pkg', 'Maven repository').risk, 'check', 'Maven repo may hold locally installed artifacts');
  const backup = result.items.find((i) => i.group === 'backup');
  assert.ok(backup && backup.action === 'trash' && !backup.recommended && backup.risk === 'check', 'device backup: Trash, never preselected');
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.includes('not-a-backup'))), 'folder without Info.plist is not a backup');
  // never offered: look-alikes
  const never = ['rust-odd/target', 'photos/target', 'py-fake/.venv', 'docs-site/build', 'vendored/vendor', 'gradle-libs/build', 'ex-notes/_build'];
  for (const n of never) {
    assert.ok(!result.items.some((i) => i.paths.includes(path.join(S, n))), `${n} must not be offered`);
  }

  // Clean re-checks the exact kind: tampering between scan and clean is refused.
  const prot = protectedSet(['~/Projects']);
  assert.strictEqual(await verify(rust, rust.paths[0], prot), null);
  assert.notStrictEqual(await verify({ ...rust, kindId: 'next' }, rust.paths[0], prot), null, 'kind swapped');
  assert.notStrictEqual(await verify(rust, path.join(S, 'rust-odd', 'target'), prot), null, 'target without CACHEDIR.TAG');
  assert.notStrictEqual(await verify(rust, path.join(S, 'rust-cli', 'src'), prot), null, 'source folder');
  assert.notStrictEqual(await verify(venv, path.join(S, 'py-fake', '.venv'), prot), null, 'venv without pyvenv.cfg');
  assert.notStrictEqual(await verify(php, path.join(S, 'vendored', 'vendor'), prot), null, 'git-tracked vendor');
  assert.notStrictEqual(await verify(php, path.join(S, 'php-legacy', 'vendor'), prot), null, 'vendor with a non-Composer folder');
  assert.notStrictEqual(await verify({ ...gb, kindId: 'gradle-build' }, path.join(S, 'gradle-libs', 'build'), prot), null, 'build/ with only a hand-dropped jar');
  assert.notStrictEqual(await verify(backup, path.join(HOME, 'Library', 'Application Support', 'MobileSync', 'Backup', 'not-a-backup'), prot), null, 'backup without Info.plist');
  assert.notStrictEqual(await verify(backup, path.join(HOME, 'Library', 'Application Support', 'MobileSync', 'Backup'), prot), null, 'Backup root itself');
  // marker removed after the scan
  const cfg = path.join(S, 'py-app', '.venv', 'pyvenv.cfg');
  fs.renameSync(cfg, cfg + '.moved');
  assert.notStrictEqual(await verify(venv, venv.paths[0], prot), null, 'pyvenv.cfg gone after scan');
  fs.renameSync(cfg + '.moved', cfg);
});

test('clean recommended items, keep everything else', async () => {
  const wtc = result.items.find((i) => i.title === 'agent-clean' && i.group === 'worktree');
  const chosen = [...result.items.filter((i) => i.recommended && i.risk !== 'locked'), wtc];
  // Also pick the duplicate copy to test Trash + skip of nested items.
  const dup = result.items.find((i) => i.title === 'repo copy');
  const trashed = [];
  const out = await clean([...chosen, dup], {
    projectRoots: ['~/Projects'],
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
  const out = await clean(forced, { projectRoots: ['~/Projects'], trash: async () => { throw new Error('no trash expected'); } }, () => {});
  console.log(out.results.map((r) => `${r.status} ${r.title}: ${r.message}`).join('\n'));
  assert.ok(out.results.every((r) => r.status === 'refused' || r.status === 'error'));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/rel-dirty/package.json')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/hidden-untracked/notes.md')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/env-unique/.env')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/clone/notes.txt')));
  assert.ok(fs.existsSync(path.join(E, '.claude/worktrees/detached/d.txt')));

  // Same folder through two roots: scanned once, no duplicate ids.
  const r2 = await scan({ projectRoots: ['~/Projects', '~/devlink'], inactiveDays: 14 }, () => {});
  const ids = r2.items.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'no duplicate items');
  assert.ok(!r2.items.some((i) => i.paths.some((p) => p.includes('devlink'))), 'symlinked root collapsed');
});

test('other stacks after cleaning: output gone, project files kept', async () => {
  const S = path.join(P, 'stacks');
  assert.ok(!fs.existsSync(path.join(S, 'rust-cli', 'target')), 'Rust target removed');
  assert.ok(fs.existsSync(path.join(S, 'rust-cli', 'src', 'main.rs')) && fs.existsSync(path.join(S, 'rust-cli', 'Cargo.toml')), 'Rust sources kept');
  assert.ok(fs.existsSync(path.join(S, 'rust-live', 'target')), 'active project target kept (not preselected)');
  assert.ok(!fs.existsSync(path.join(S, 'py-app', '.venv')), 'venv removed');
  assert.ok(fs.existsSync(path.join(S, 'py-app', 'pyproject.toml')) && fs.existsSync(path.join(S, 'py-app', 'uv.lock')), 'project files kept');
  assert.ok(fs.existsSync(path.join(S, 'py-req', 'venv')), 'requirements-only venv kept (check first)');
  for (const n of ['rust-odd/target/mine.bin', 'photos/target/pic.bin', 'py-fake/.venv/data.bin', 'docs-site/build/index.bin', 'vendored/vendor/acme/lib/lib.bin',
    'gradle-libs/build/libs/vendor-sdk.jar', 'ex-notes/_build/my-release-notes.bin', 'php-legacy/vendor/acme-legacy/Lib.bin', 'ex-app/deps/hiredis/hiredis.bin',
    'py-patched/.venv/lib/python3.12/site-packages/lib1/patched.py', 'ios-patched/Pods/Alamofire/Session.swift', 'ios-extra/Pods/MyHelpers/h.bin',
    'java-app/target/maven-status/m.bin', 'android-app/build/intermediates/i.bin', 'gradle-notes/build/notes/n.md', 'php-topfile/vendor/helpers.php',
    'php-bin/vendor/bin/deploy.sh', 'ios-top/Pods/MyHelpers.swift', 'py-src/.venv/src/myscript.py', 'py-older/.venv/lib/python3.12/site-packages/lib1/core.bin',
    'py-bin/.venv/bin/deploy.sh', 'py-bin/.venv/share/mine/notes.txt', 'gradle-docs/build/docs/notes.md', 'mono400/svc/target/maven-status/m.bin']) {
    assert.ok(fs.existsSync(path.join(S, n)), `${n} untouched`);
  }
  assert.ok(fs.existsSync(path.join(HOME, 'Library', 'Application Support', 'MobileSync', 'Backup', '00008030-TEST', 'Info.plist')), 'backup untouched');
  assert.ok(fs.existsSync(path.join(HOME, '.m2', 'repository', 'r.bin')), 'Maven repo untouched (check first)');
});
