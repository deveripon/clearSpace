'use strict';
// Regression tests for every issue found in the security reviews.
// Run with: HOME=/tmp/<anything containing fakehome> node --test test/safety.test.js
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

const HOME = os.homedir();
assert.ok(HOME.includes('fakehome'), 'Refusing to run outside a fake HOME');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(HOME, { recursive: true });

const sh = (cmd, cwd = HOME) => execSync(cmd, { cwd, stdio: 'pipe', env: { ...process.env, HOME, GIT_CONFIG_NOSYSTEM: '1' } }).toString();
const write = (p, content = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
const big = (p, mb = 2) => write(p, Buffer.alloc(mb * 1024 * 1024, 7));
const exists = (p) => fs.existsSync(p);
const gitInit = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  sh('git init -q -b main && git config user.email t@t && git config user.name t', dir);
};

const P = path.join(HOME, 'Projects');
const OUTSIDE = HOME + '-outside';
fs.rmSync(OUTSIDE, { recursive: true, force: true });

// ---------- fixtures ----------
// 1. symlinked containers
const DOCS = path.join(HOME, 'Documents');
big(path.join(DOCS, 'Taxes', 'return.pdf'), 6);
big(path.join(DOCS, 'Novel', 'draft.md'), 6);
fs.mkdirSync(path.join(HOME, 'Library'), { recursive: true });
fs.symlinkSync(DOCS, path.join(HOME, 'Library', 'Caches'));        // ~/Library/Caches -> ~/Documents
fs.symlinkSync(DOCS, path.join(HOME, '.cache'));                    // ~/.cache -> ~/Documents
fs.symlinkSync(DOCS, path.join(HOME, 'Downloads'));                 // ~/Downloads -> ~/Documents
big(path.join(OUTSIDE, 'bun-cache', 'precious.bin'), 3);
fs.mkdirSync(path.join(HOME, '.bun'), { recursive: true });
fs.symlinkSync(path.join(OUTSIDE, 'bun-cache'), path.join(HOME, '.bun', 'install'));
const BUN_TARGET = path.join(OUTSIDE, 'bun-cache');
fs.mkdirSync(path.join(BUN_TARGET, 'cache'), { recursive: true });
big(path.join(BUN_TARGET, 'cache', 'x.bin'), 2);

// 2. hidden tool folders inside the project root and an .app bundle
big(path.join(P, '.nvm-like', 'lib', 'node_modules', 'npm', 'x.bin'));
write(path.join(P, '.nvm-like', 'lib', 'package.json'), '{}');
big(path.join(P, 'Tool.app', 'Contents', 'Resources', 'node_modules', 'x.bin'));
write(path.join(P, 'Tool.app', 'Contents', 'Resources', 'package.json'), '{}');

// 3. node_modules with a cloned repo inside; tracked (vendored) node_modules; folder named node_modules w/o package.json
const NG = path.join(P, 'nested-git');
write(path.join(NG, 'package.json'), '{}'); write(path.join(NG, 'pnpm-lock.yaml'), '');
big(path.join(NG, 'node_modules', 'my-fork', 'index.js'));
gitInit(path.join(NG, 'node_modules', 'my-fork'));
sh('git add . && git commit -qm "my unpushed work"', path.join(NG, 'node_modules', 'my-fork'));
const VEND = path.join(P, 'vendored');
gitInit(VEND);
write(path.join(VEND, 'package.json'), '{}'); write(path.join(VEND, 'package-lock.json'), '{}');
big(path.join(VEND, 'node_modules', 'patched', 'index.js'));
sh('git add -f . && git commit -qm vendored', VEND);
const NAMED = path.join(P, 'not-a-project', 'node_modules');
big(path.join(NAMED, 'important.bin'));

// 4. hand-made coverage folder vs a real report
const COV = path.join(P, 'covproj');
write(path.join(COV, 'package.json'), '{}');
big(path.join(COV, 'coverage', 'my-notes.bin'));
const COV2 = path.join(P, 'covreal');
write(path.join(COV2, 'package.json'), '{}');
big(path.join(COV2, 'coverage', 'lcov-report', 'index.bin')); write(path.join(COV2, 'coverage', 'lcov.info'), 'TN:');

// 5. worktree edge cases
const R = path.join(P, 'repo');
gitInit(R);
write(path.join(R, 'package.json'), '{}'); write(path.join(R, '.gitignore'), 'node_modules\n');
sh('git add . && git commit -qm init', R);
// a) commits only in the worktree's HEAD history (detached commit, then back to the branch)
sh('git worktree add -q .claude/worktrees/reflog-orphan -b reflog-orphan', R);
const WO = path.join(R, '.claude', 'worktrees', 'reflog-orphan');
sh('git checkout -q --detach && git commit -q --allow-empty -m "detached work" && git rev-parse HEAD > ../../../orphan.sha && git checkout -q reflog-orphan', WO);
big(path.join(WO, 'node_modules', 'x.bin'));
// b) a worktree ref only this worktree has
sh('git worktree add -q .claude/worktrees/wt-ref -b wt-ref', R);
const WR = path.join(R, '.claude', 'worktrees', 'wt-ref');
sh('git commit -q --allow-empty -m "kept in refs/worktree" && git update-ref refs/worktree/keep HEAD && git rev-parse HEAD > ../../../wtref.sha && git reset -q --hard HEAD~1', WR);
big(path.join(WR, 'node_modules', 'x.bin'));
// c) locked with git worktree lock
sh('git worktree add -q .claude/worktrees/locked-wt -b locked-wt && git worktree lock --reason "agent running" .claude/worktrees/locked-wt', R);
big(path.join(R, '.claude', 'worktrees', 'locked-wt', 'node_modules', 'x.bin'));
// d) fsmonitor hook must never run during a scan
const MARK = path.join(HOME, 'fsmonitor-ran');

// 6. false duplicate: "notes.txt copy" next to a FILE notes.txt
write(path.join(P, 'notes.txt'), 'hi');
big(path.join(P, 'notes.txt copy', 'stuff.bin'));

// 7. a project folder that is later swapped for a symlink (race between scan and clean)
const SWAP = path.join(P, 'swapme');
write(path.join(SWAP, 'package.json'), '{}'); write(path.join(SWAP, 'pnpm-lock.yaml'), '');
big(path.join(SWAP, 'node_modules', 'x.bin'));
const VICTIM = path.join(DOCS, 'victim');
write(path.join(VICTIM, 'package.json'), '{}');
big(path.join(VICTIM, 'node_modules', 'precious.bin'));
for (const d of [P, path.join(P, 'covproj'), NG, SWAP]) {
  const t = new Date(Date.now() - 60 * 86400000);
  try { fs.utimesSync(path.join(d, 'package.json'), t, t); } catch {}
}

// 8. second-round findings
// a) node_modules with thousands of packages and a cloned one at the end
const BIGNM = path.join(P, 'bignm');
write(path.join(BIGNM, 'package.json'), '{}'); write(path.join(BIGNM, 'pnpm-lock.yaml'), '');
for (let i = 0; i < 3500; i++) fs.mkdirSync(path.join(BIGNM, 'node_modules', `pkg-${String(i).padStart(4, '0')}`), { recursive: true });
big(path.join(BIGNM, 'node_modules', 'zzz-fork', 'index.js'));
gitInit(path.join(BIGNM, 'node_modules', 'zzz-fork'));
sh('git add . && git commit -qm "fork work"', path.join(BIGNM, 'node_modules', 'zzz-fork'));
// b) worktree with a git repo hidden inside an ignored .next folder
write(path.join(R, '.gitignore'), 'node_modules\n.next\n');
sh('git add .gitignore && git commit -qm ignore-next', R);
sh('git worktree add -q .claude/worktrees/hidden-repo -b hidden-repo', R);
const HR = path.join(R, '.claude', 'worktrees', 'hidden-repo');
big(path.join(HR, '.next', 'cache', 'inner', 'x.bin'));
gitInit(path.join(HR, '.next', 'cache', 'inner'));
sh('git add . && git commit -qm "inner work"', path.join(HR, '.next', 'cache', 'inner'));
// c) worktree folder whose name is not a valid ref name part, with a history-only commit
sh('git worktree add -q .claude/worktrees/fix.lock -b fixlock', R);
const FL = path.join(R, '.claude', 'worktrees', 'fix.lock');
sh('git checkout -q --detach && git commit -q --allow-empty -m "fixlock detached" && git rev-parse HEAD > ../../../fixlock.sha && git checkout -q fixlock', FL);
big(path.join(FL, 'node_modules', 'x.bin'));
// d) tracked coverage + vendored node_modules must survive even when git cannot run
const NOGIT = path.join(P, 'nogit-proj');
gitInit(NOGIT);
write(path.join(NOGIT, 'package.json'), '{}'); write(path.join(NOGIT, 'pnpm-lock.yaml'), '');
big(path.join(NOGIT, 'coverage', 'x.bin')); write(path.join(NOGIT, 'coverage', 'lcov.info'), 'TN:');
big(path.join(NOGIT, 'node_modules', 'patched', 'index.js'));
sh('git add -f . && git commit -qm vendored-everything', NOGIT);

// 9. final-round findings
// a) worktree whose ignored folder has a non-English name and a git repo inside
sh('git worktree add -q .claude/worktrees/unicode-wt -b unicode-wt', R);
const UW = path.join(R, '.claude', 'worktrees', 'unicode-wt');
big(path.join(UW, 'packages', 'über-lib', 'node_modules', 'fork', 'index.js'));
gitInit(path.join(UW, 'packages', 'über-lib', 'node_modules', 'fork'));
sh('git add . && git commit -qm "unicode fork work"', path.join(UW, 'packages', 'über-lib', 'node_modules', 'fork'));
// b) project with a broken repository (HEAD missing) and committed coverage + node_modules
const BROKEN = path.join(P, 'broken-repo');
gitInit(BROKEN);
write(path.join(BROKEN, 'package.json'), '{}'); write(path.join(BROKEN, 'pnpm-lock.yaml'), '');
big(path.join(BROKEN, 'coverage', 'x.bin')); write(path.join(BROKEN, 'coverage', 'lcov.info'), 'TN:');
big(path.join(BROKEN, 'node_modules', 'patched', 'index.js'));
sh('git add -f . && git commit -qm all', BROKEN);
fs.rmSync(path.join(BROKEN, '.git', 'HEAD'));
// c) a git repo inside a project's own .next, and one two node_modules levels deep
const BN = path.join(P, 'build-nested');
write(path.join(BN, 'package.json'), '{}'); write(path.join(BN, 'pnpm-lock.yaml'), '');
big(path.join(BN, '.next', 'cache', 'repo', 'x.bin'));
gitInit(path.join(BN, '.next', 'cache', 'repo'));
sh('git add . && git commit -qm inner', path.join(BN, '.next', 'cache', 'repo'));
const DEEP = path.join(P, 'nm-deep');
write(path.join(DEEP, 'package.json'), '{}'); write(path.join(DEEP, 'pnpm-lock.yaml'), '');
big(path.join(DEEP, 'node_modules', 'a', 'node_modules', 'fork', 'index.js'));
gitInit(path.join(DEEP, 'node_modules', 'a', 'node_modules', 'fork'));
sh('git add . && git commit -qm deep', path.join(DEEP, 'node_modules', 'a', 'node_modules', 'fork'));
// d) a plain inactive project whose node_modules gets a cloned repo AFTER the scan
const LATE = path.join(P, 'late-clone');
write(path.join(LATE, 'package.json'), '{}'); write(path.join(LATE, 'pnpm-lock.yaml'), '');
big(path.join(LATE, 'node_modules', 'x', 'index.js'));

// fsmonitor trap is armed last, so only the app's own git calls could trigger it
sh(`git config core.fsmonitor "touch ${MARK}; true"`, R);
assert.ok(!exists(MARK));

const { scan, rootProblem } = require('../engine/scan');
const { clean, check, protectedSet } = require('../engine/clean');
let result;
const find = (fn) => result.items.find(fn);
const trashStub = async (p) => { throw new Error('unexpected trash of ' + p); };

test('scan', async () => {
  result = await scan({ projectRoots: ['~/Projects', '~', '~/Library', '~/.bun'], inactiveDays: 14 }, () => {});
  console.log(result.items.map((i) => `${i.category} | ${i.title} | ${i.risk}${i.recommended ? ' REC' : ''} | ${i.paths.join(', ')}`).join('\n'));
  console.log('warnings:', result.warnings);
});

test('symlinked containers never turn other folders into caches', () => {
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.startsWith(DOCS + '/') || p.startsWith(path.join(HOME, 'Library', 'Caches') + '/'))), 'no item through ~/Library/Caches or Documents');
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.startsWith(path.join(HOME, '.cache')))), 'no ~/.cache item through a symlink');
  assert.ok(!result.items.some((i) => i.category === 'files' && i.action === 'trash'), 'no Downloads item through a symlink');
  assert.ok(!result.items.some((i) => i.key === 'bun'), 'bun cache behind a symlinked parent is not offered');
});

test('home, Library and hidden folders are refused as project folders', () => {
  assert.ok(rootProblem(HOME));
  assert.ok(rootProblem(path.join(HOME, 'Library', 'x')));
  assert.ok(rootProblem(path.join(HOME, '.nvm')));
  assert.strictEqual(rootProblem(P), null);
  assert.ok(result.warnings.some((w) => /home folder itself/.test(w)));
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.includes('.nvm-like') || p.includes('Tool.app'))), 'hidden folders and .app bundles skipped');
});

test('node_modules with a nested repo is locked; vendored and stray ones are never offered', () => {
  const ng = find((i) => i.category === 'deps' && i.title === 'nested-git');
  assert.ok(ng && ng.risk === 'locked' && !ng.recommended, 'nested git => locked');
  assert.ok(!find((i) => i.category === 'deps' && i.title === 'vendored'), 'tracked node_modules not offered');
  assert.ok(!result.items.some((i) => i.paths.includes(NAMED)), 'node_modules without package.json not offered');
});

test('coverage is only offered when it is a real report', () => {
  assert.ok(!result.items.some((i) => i.paths.includes(path.join(COV, 'coverage'))), 'hand-made coverage folder not offered');
  assert.ok(result.items.some((i) => i.paths.includes(path.join(COV2, 'coverage'))), 'real coverage report offered');
});

test('worktrees: locked wt is locked, history orphans flagged, fsmonitor never ran', () => {
  const lk = find((i) => i.title === 'locked-wt');
  assert.strictEqual(lk.risk, 'locked');
  assert.match(lk.lockedReason, /git worktree lock/);
  const ro = find((i) => i.title === 'reflog-orphan');
  assert.ok(ro.risk === 'check' && !ro.recommended && /refs\/clearspace-backup/.test(ro.lose), 'history orphans explained');
  const wr = find((i) => i.title === 'wt-ref');
  assert.ok(wr.risk === 'check' && /refs\/clearspace-backup/.test(wr.lose));
  assert.ok(!exists(MARK), 'core.fsmonitor command must not run');
});

test('a folder named "X copy" next to a FILE X is not a duplicate', () => {
  assert.ok(!find((i) => i.group === 'duplicate' && i.title === 'notes.txt copy'));
});

test('cleaning worktrees never makes a commit unreachable', async () => {
  const items = ['reflog-orphan', 'wt-ref', 'locked-wt'].map((t) => ({ ...find((i) => i.title === t), risk: 'safe' }));
  const out = await clean(items, { projectRoots: ['~/Projects'], trash: trashStub }, () => {});
  console.log(out.results.map((r) => `${r.status} ${r.title}: ${r.message}`).join('\n'));
  assert.strictEqual(out.results.find((r) => r.title === 'locked-wt').status, 'refused');
  assert.ok(exists(path.join(R, '.claude', 'worktrees', 'locked-wt')));
  assert.ok(!exists(WO) && !exists(WR), 'unlocked worktrees removed');
  assert.ok(!exists(MARK), 'core.fsmonitor command must not run during clean');
  sh('git config --unset core.fsmonitor', R); // the checks below use plain git
  for (const f of ['orphan.sha', 'wtref.sha']) {
    const sha = fs.readFileSync(path.join(R, f), 'utf8').trim();
    const refs = sh(`git for-each-ref --contains ${sha} --format="%(refname)"`, R);
    assert.match(refs, /refs\/clearspace-backup\//, `${f} commit is still reachable from a backup ref`);
  }
  // fix.lock (used by a later test) deliberately still holds a reflog-only commit: ignore just that one.
  const pending = fs.readFileSync(path.join(R, 'fixlock.sha'), 'utf8').trim();
  const unreachable = sh('git fsck --unreachable --no-reflogs 2>/dev/null || true', R)
    .split('\n').filter((l) => l.startsWith('unreachable commit') && !l.includes(pending));
  assert.deepStrictEqual(unreachable, [], 'no unreachable commits');
});

test('a folder swapped for a symlink after the scan is never followed', async () => {
  const it = find((i) => i.category === 'deps' && i.title === 'swapme');
  assert.ok(it);
  fs.renameSync(SWAP, SWAP + '-moved');
  fs.symlinkSync(VICTIM, SWAP); // swapme -> ~/Documents/victim (which has its own node_modules)
  const out = await clean([it], { projectRoots: ['~/Projects'], trash: trashStub }, () => {});
  assert.notStrictEqual(out.results[0].status, 'done');
  assert.ok(exists(path.join(VICTIM, 'node_modules', 'precious.bin')), 'victim untouched');
});

test('verify refuses node_modules in tool areas even if an item claims them', async () => {
  const prot = protectedSet(['~/Projects']);
  const fake = { category: 'deps', action: 'delete', paths: [] };
  const nvm = path.join(P, '.nvm-like', 'lib', 'node_modules');
  assert.ok((await check(fake, nvm, prot)).why);
  assert.ok((await check(fake, path.join(P, 'Tool.app', 'Contents', 'Resources', 'node_modules'), prot)).why);
  assert.ok((await check(fake, NAMED, prot)).why, 'no package.json next to it');
  assert.ok(exists(path.join(nvm, 'npm', 'x.bin')));
});

test('emptying reports partial failure honestly', async () => {
  const home2 = path.join(HOME, 'Library2');
  // Use ~/Library/Logs semantics on a temporary real folder by faking an apps item at ~/Library/Logs.
  fs.rmSync(path.join(HOME, 'Library', 'Caches')); // remove the symlink, make a real Caches dir
  const c = path.join(HOME, 'Library', 'Caches', 'com.example.app');
  big(path.join(c, 'ok', 'a.bin'), 1);
  big(path.join(c, 'stuck', 'b.bin'), 1);
  fs.chmodSync(path.join(c, 'stuck'), 0o500);
  const item = { id: 'x', title: 'example', category: 'apps', action: 'empty', paths: [c], size: 2 };
  const out = await clean([item], { projectRoots: ['~/Projects'], trash: trashStub }, () => {});
  if (exists(path.join(c, 'stuck'))) fs.chmodSync(path.join(c, 'stuck'), 0o700);
  const r = out.results[0];
  if (process.getuid && process.getuid() === 0) {
    assert.ok(['done', 'partial'].includes(r.status)); // root ignores permissions
  } else {
    assert.strictEqual(r.status, 'partial', r.message);
  }
  assert.ok(exists(c), 'the cache folder itself is kept');
  void home2;
});

test('second round: big node_modules, hidden repos, odd names, missing git', async () => {
  const bn = result.items.find((i) => i.category === 'deps' && i.title === 'bignm');
  assert.ok(bn && bn.risk === 'locked', 'cloned package found even among thousands of packages');
  const hr = result.items.find((i) => i.title === 'hidden-repo');
  assert.ok(hr && hr.risk === 'locked' && /git repository/.test(hr.lockedReason), 'repo inside ignored .next locks the worktree');
  const fl = result.items.find((i) => i.title === 'fix.lock');
  assert.ok(fl && fl.risk === 'check');
  const out = await clean([fl], { projectRoots: ['~/Projects'], trash: trashStub }, () => {});
  assert.strictEqual(out.results[0].status, 'done', out.results[0].message);
  const sha = fs.readFileSync(path.join(R, 'fixlock.sha'), 'utf8').trim();
  assert.match(sh(`git for-each-ref --contains ${sha} --format="%(refname)"`, R), /refs\/clearspace-backup\/fix_lock\//);
  sh('git config --unset core.fsmonitor || true', R);
  assert.ok(!/unreachable commit/.test(sh('git fsck --unreachable --no-reflogs 2>/dev/null || true', R)), 'repo has no unreachable commits at all');
  // tracked folders are offered neither with git nor without it
  for (const p of [path.join(NOGIT, 'coverage'), path.join(NOGIT, 'node_modules')]) {
    assert.ok(!result.items.some((i) => i.paths.includes(p)), 'tracked folder not offered: ' + p);
  }
  const savedPath = process.env.PATH;
  process.env.PATH = '/nonexistent-bin';
  let r2;
  try { r2 = await scan({ projectRoots: ['~/Projects'], inactiveDays: 14 }, () => {}); } finally { process.env.PATH = savedPath; }
  for (const p of [path.join(NOGIT, 'coverage'), path.join(NOGIT, 'node_modules')]) {
    assert.ok(!r2.items.some((i) => i.paths.includes(p)), 'without git, tracked folder still not offered: ' + p);
  }
  assert.ok(r2.items.filter((i) => i.category === 'leftovers' && i.group === 'worktree').every((i) => i.risk === 'locked'), 'without git, worktrees are locked');
});

test('catalog patterns', () => {
  const { SAFE_APP_CACHES, APP_CACHE_WARNINGS } = require('../engine/catalog');
  const safe = (n) => SAFE_APP_CACHES.some((re) => re.test(n));
  const warn = (n) => (APP_CACHE_WARNINGS.find(([re]) => re.test(n)) || [, ''])[1];
  assert.ok(safe('com.todesktop.230313mzl4w4u92'));
  assert.ok(!safe('com.todesktop.someotherapp'), 'only Cursor among ToDesktop apps');
  assert.ok(!safe('com.todesktop.230313mzl4w4u92.ShipIt'));
  assert.ok(!/AI models/.test(warn('org.whispersystems.signal-desktop')), 'Signal is not an AI model cache');
  assert.ok(/AI models/.test(warn('llama.cpp')));
  assert.ok(!/cloud-sync/.test(warn('org.virtualbox.app.VirtualBox')), 'VirtualBox is not cloud sync');
  assert.ok(/cloud-sync/.test(warn('com.getdropbox.dropbox')));
  assert.ok(/Local History/.test(warn('JetBrains')));
});

test('final round: unicode names, broken repos, deep nested repos, re-check at clean time', async () => {
  const uw = result.items.find((i) => i.title === 'unicode-wt');
  assert.ok(uw && uw.risk === 'locked', 'repo inside a non-English ignored folder locks the worktree: ' + (uw && uw.lockedReason));
  for (const p of [path.join(BROKEN, 'coverage'), path.join(BROKEN, 'node_modules')]) {
    assert.ok(!result.items.some((i) => i.paths.includes(p)), 'broken repo: tracked folder not offered ' + p);
  }
  assert.ok(!result.items.some((i) => i.paths.includes(path.join(BN, '.next'))), '.next with a repo inside not offered');
  const deep = result.items.find((i) => i.category === 'deps' && i.title === 'nm-deep');
  assert.ok(deep && deep.risk === 'locked', 'repo two node_modules levels deep found');
  const late = result.items.find((i) => i.category === 'deps' && i.title === 'late-clone');
  assert.ok(late, 'late-clone offered at scan time');
  gitInit(path.join(LATE, 'node_modules', 'x'));
  sh('git add . && git commit -qm "cloned after scan"', path.join(LATE, 'node_modules', 'x'));
  const out = await clean([late], { projectRoots: ['~/Projects'], trash: trashStub }, () => {});
  assert.strictEqual(out.results[0].status, 'refused', out.results[0].message);
  assert.ok(exists(path.join(LATE, 'node_modules', 'x', 'index.js')), 'late clone kept');
});
