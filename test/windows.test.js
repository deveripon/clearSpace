'use strict';
// Windows engine tests in a throwaway fake user folder. Run with: npm run test:win
// Builds the fixtures itself (no bash needed) and points USERPROFILE, LOCALAPPDATA and APPDATA at the fake folder
// before the engine is loaded. Set CLEARSPACE_OTHER_DRIVE_DIR to a folder on a second drive to also test a project
// folder outside the user folder (defaults to a folder next to this repository when it is not on the system drive).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

if (process.platform !== 'win32') {
  test('Windows only', { skip: 'run on Windows' }, () => {});
  return;
}

const T = fs.realpathSync.native(os.tmpdir());
const HOME = path.join(T, 'clearspace-fakehome-win');
fs.rmSync(HOME, { recursive: true, force: true });
fs.mkdirSync(HOME, { recursive: true });
const LOCAL = path.join(HOME, 'AppData', 'Local');
const ROAMING = path.join(HOME, 'AppData', 'Roaming');
Object.assign(process.env, { USERPROFILE: HOME, HOME, LOCALAPPDATA: LOCAL, APPDATA: ROAMING });
// Keep git from finding a repository above the fake folder (some people keep their whole user folder in git;
// with the fake HOME, git would not trust it, and Clearspace would rightly refuse everything as "git could not check").
const OTHER_PARENT = process.env.CLEARSPACE_OTHER_DRIVE_DIR ? path.dirname(process.env.CLEARSPACE_OTHER_DRIVE_DIR) : null;
process.env.GIT_CEILING_DIRECTORIES = [T, OTHER_PARENT, path.dirname(path.dirname(__dirname))].filter(Boolean).join(';');

const repoDrive = path.parse(__dirname).root.toUpperCase();
const systemDrive = `${(process.env.SystemDrive || 'C:').toUpperCase()}\\`;
const OTHER = process.env.CLEARSPACE_OTHER_DRIVE_DIR
  || (repoDrive !== systemDrive ? path.join(path.dirname(path.dirname(__dirname)), 'clearspace-otherdrive-fakehome') : null);

const { scan } = require('../engine/scan');
const { clean, verify, protectedSet } = require('../engine/clean');
const { rootProblem } = require('../engine/platform');

const DAY = 86400000;
const P = path.join(HOME, 'Projects');
const OUTSIDE = path.join(T, 'clearspace-fakehome-win-outside');
const write = (p, data = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const big = (p, mb) => write(p, Buffer.alloc(mb * 1024 * 1024, 1));
const age = (days, ...files) => { const t = new Date(Date.now() - days * DAY); for (const f of files) fs.utimesSync(f, t, t); };
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' } }).toString();
const initRepo = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 't@t');
  git(dir, 'config', 'user.name', 't');
  git(dir, 'config', 'core.autocrlf', 'false');
};

// ---------------------------------------------------------------- fixtures
// An inactive npm project: node_modules is Safe and recommended.
const old = path.join(P, 'old-app');
write(path.join(old, 'package.json'), '{}');
write(path.join(old, 'package-lock.json'), '{}');
write(path.join(old, 'src', 'index.js'), 'console.log(1)');
big(path.join(old, 'node_modules', 'left-pad', 'big.bin'), 2);
big(path.join(old, '.next', 'cache', 'c.bin'), 2);
age(60, path.join(old, 'package.json'), path.join(old, 'package-lock.json'), path.join(old, 'src', 'index.js'));

// A junction inside node_modules that points at precious files elsewhere: the link goes, the files stay.
const PRECIOUS = path.join(OUTSIDE, 'precious');
write(path.join(PRECIOUS, 'keep.txt'), 'keep me');
fs.symlinkSync(PRECIOUS, path.join(old, 'node_modules', 'linked-pkg'), 'junction');

// A project reached through a junction: never offered.
const realElsewhere = path.join(OUTSIDE, 'real-project');
write(path.join(realElsewhere, 'package.json'), '{}');
write(path.join(realElsewhere, 'package-lock.json'), '{}');
big(path.join(realElsewhere, 'node_modules', 'x', 'x.bin'), 2);
fs.symlinkSync(realElsewhere, path.join(P, 'via-junction'), 'junction');

// A Python virtual environment in the Windows layout (Lib\site-packages, Scripts), pinned by uv.lock.
const py = path.join(P, 'py-app');
write(path.join(py, 'pyproject.toml'), '[project]\nname = "py-app"\n');
write(path.join(py, 'uv.lock'), '[[package]]\nname = "requests"\n');
const venv = path.join(py, '.venv');
write(path.join(venv, 'Scripts', 'python.exe'), 'MZ');
age(10, path.join(venv, 'Scripts', 'python.exe'));
write(path.join(venv, 'pyvenv.cfg'), 'home = C:\\Python312\n');
const sp = path.join(venv, 'Lib', 'site-packages');
const body = Buffer.alloc(1024 * 1024 * 2, 7);
write(path.join(sp, 'requests', '__init__.py'), body);
write(path.join(sp, 'requests-2.0.dist-info', 'METADATA'), 'Name: requests');
write(path.join(sp, 'requests-2.0.dist-info', 'RECORD'),
  `requests/__init__.py,sha256=x,${body.length}\nrequests-2.0.dist-info/METADATA,sha256=y,14\nrequests-2.0.dist-info/RECORD,,\n`);
age(60, path.join(py, 'pyproject.toml'), path.join(py, 'uv.lock'));

// A git repository with AI-agent worktrees: one clean, one with uncommitted work.
const repo = path.join(P, 'repo');
initRepo(repo);
write(path.join(repo, 'package.json'), '{}');
write(path.join(repo, '.gitignore'), 'node_modules\n.claude\n');
git(repo, 'add', '.');
git(repo, 'commit', '-qm', 'init');
git(repo, 'worktree', 'add', '-q', path.join('.claude', 'worktrees', 'agent-clean'), '-b', 'wt-clean');
const wtClean = path.join(repo, '.claude', 'worktrees', 'agent-clean');
write(path.join(wtClean, 'f.txt'), 'hi');
git(wtClean, 'add', '.');
git(wtClean, 'commit', '-qm', 'wt commit');
big(path.join(wtClean, 'node_modules', 'n.bin'), 2);
git(repo, 'worktree', 'add', '-q', path.join('.claude', 'worktrees', 'agent-dirty'), '-b', 'wt-dirty');
const wtDirty = path.join(repo, '.claude', 'worktrees', 'agent-dirty');
write(path.join(wtDirty, 'package.json'), '{"changed":true}');
big(path.join(wtDirty, 'big.bin'), 2);
// Worktrees made right now count as active; make the clean one look idle.
for (const f of ['index', 'HEAD', path.join('logs', 'HEAD')]) {
  const p = path.join(repo, '.git', 'worktrees', 'agent-clean', f);
  if (fs.existsSync(p)) age(3, p);
}

// A File Explorer copy of a project ("repo - Copy").
fs.cpSync(path.join(P, 'old-app', 'src'), path.join(P, 'old-app - Copy', 'src'), { recursive: true });
write(path.join(P, 'old-app - Copy', 'package.json'), '{}');
big(path.join(P, 'old-app - Copy', 'data.bin'), 2);

// Browser and app caches next to things that must survive (settings, logins).
const chrome = path.join(LOCAL, 'Google', 'Chrome', 'User Data');
big(path.join(chrome, 'Default', 'Cache', 'Cache_Data', 'data_1'), 6);
write(path.join(chrome, 'Default', 'Login Data'), 'secret logins');
write(path.join(chrome, 'Default', 'Preferences'), '{}');
big(path.join(chrome, 'Profile 1', 'Code Cache', 'js', 'c'), 1);
big(path.join(chrome, 'NotAProfile', 'Cache', 'x'), 3);
big(path.join(ROAMING, 'Code', 'CachedData', 'abc', 'x.bin'), 6);
write(path.join(ROAMING, 'Code', 'User', 'settings.json'), '{"mine":true}');
big(path.join(LOCAL, 'Temp', 'leftover.tmp'), 6);
big(path.join(LOCAL, 'CrashDumps', 'app.dmp'), 6);
big(path.join(LOCAL, 'SomeApp', 'Cache', 'x.bin'), 6); // unknown app: never listed
// Developer caches.
big(path.join(LOCAL, 'npm-cache', '_cacache', 'c.bin'), 2);
big(path.join(LOCAL, 'pip', 'Cache', 'p.bin'), 2);
// Downloads.
big(path.join(HOME, 'Downloads', 'setup.exe'), 55);

// A project folder on another drive (Windows people often keep code on D:).
let otherProject = null;
if (OTHER) {
  fs.rmSync(OTHER, { recursive: true, force: true });
  otherProject = path.join(OTHER, 'code', 'far-app');
  write(path.join(otherProject, 'package.json'), '{}');
  write(path.join(otherProject, 'pnpm-lock.yaml'), '');
  big(path.join(otherProject, 'node_modules', 'p', 'p.bin'), 2);
  age(90, path.join(otherProject, 'package.json'), path.join(otherProject, 'pnpm-lock.yaml'));
  // An installed game next to the code: its node_modules belongs to the game and is never offered.
  const game = path.join(OTHER, 'SteamLibrary', 'steamapps', 'common', 'SomeGame', 'resources', 'app');
  write(path.join(game, 'package.json'), '{}');
  write(path.join(game, 'package-lock.json'), '{}');
  big(path.join(game, 'node_modules', 'g', 'g.bin'), 2);
  age(90, path.join(game, 'package.json'), path.join(game, 'package-lock.json'));
}
const ROOTS = ['~\\Projects', ...(OTHER ? [OTHER] : [])];
const GAME_NM = OTHER && path.join(OTHER, 'SteamLibrary', 'steamapps', 'common', 'SomeGame', 'resources', 'app', 'node_modules');

// ---------------------------------------------------------------- tests
let result;
const find = (pred) => result.items.find(pred);
const byPath = (p) => find((i) => i.paths.some((x) => x.toLowerCase() === p.toLowerCase()));

test('scan', async () => {
  result = await scan({ projectRoots: ROOTS, inactiveDays: 14 }, () => {});
  assert.deepStrictEqual(result.warnings.filter((w) => !/Recycle Bin/.test(w)), []);
});

test('project folders: node_modules, build caches, Windows venv', () => {
  const nm = byPath(path.join(old, 'node_modules'));
  assert.ok(nm, 'inactive node_modules found');
  assert.strictEqual(nm.risk, 'safe');
  assert.ok(nm.recommended, 'inactive project with a lockfile is recommended');
  assert.ok(byPath(path.join(old, '.next')), '.next found');
  const v = byPath(venv);
  assert.ok(v, 'Windows-layout venv found');
  assert.strictEqual(v.risk, 'safe', `venv is safe (${v.lose})`);
});

test('nothing reached through a junction is offered', () => {
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.includes('via-junction') || p.startsWith(OUTSIDE))));
});

test('worktrees: clean one offered, dirty one locked', () => {
  const c = byPath(wtClean);
  // Its commit is on no remote yet (it stays on branch wt-clean), so it is "Check first", not locked.
  assert.ok(c && c.risk === 'check', `clean worktree can be cleaned (${c && (c.lockedReason || c.risk)})`);
  const d = byPath(wtDirty);
  assert.ok(d && d.risk === 'locked', 'dirty worktree locked');
});

test('File Explorer copy is found and goes to the Recycle Bin', () => {
  const c = byPath(path.join(P, 'old-app - Copy'));
  assert.ok(c, 'copy found');
  assert.strictEqual(c.action, 'trash');
  assert.strictEqual(c.recommended, false);
});

test('app caches: only known cache folders, one item per app', () => {
  const ch = find((i) => i.category === 'apps' && i.title === 'Google Chrome');
  assert.ok(ch, 'Chrome listed');
  assert.ok(ch.paths.some((p) => p.endsWith(path.join('Default', 'Cache'))));
  assert.ok(ch.paths.some((p) => p.endsWith(path.join('Profile 1', 'Code Cache'))));
  assert.ok(!ch.paths.some((p) => p.includes('NotAProfile')), 'only real profile folders');
  assert.ok(find((i) => i.title === 'Visual Studio Code'), 'VS Code');
  assert.strictEqual(find((i) => i.title === 'Temporary files').recommended, false, 'Temp is never preselected');
  assert.ok(find((i) => i.title === 'Crash dumps'), 'crash dumps');
  assert.ok(!result.items.some((i) => i.paths.some((p) => p.includes('SomeApp'))), 'unknown app folder never listed');
  assert.ok(find((i) => i.key === 'npm'), 'npm cache');
  assert.ok(find((i) => i.key === 'pip'), 'pip cache');
  assert.ok(byPath(path.join(HOME, 'Downloads', 'setup.exe')), 'large download');
});

test('project roots: home, AppData, hidden, system and whole drives are refused', () => {
  assert.ok(rootProblem(HOME));
  assert.ok(rootProblem(path.join(HOME, 'AppData', 'Local', 'x')));
  assert.ok(rootProblem(path.join(HOME, '.nvm')));
  assert.ok(rootProblem(`${systemDrive}Windows`));
  assert.ok(rootProblem(`${systemDrive}Program Files\\x`));
  assert.ok(rootProblem(`${systemDrive}code`), 'system drive outside home');
  assert.ok(rootProblem(systemDrive), 'whole system drive');
  assert.strictEqual(rootProblem('D:\\'), null, 'a whole data drive is fine');
  assert.ok(rootProblem('D:\\$RECYCLE.BIN\\x'));
  assert.ok(rootProblem('D:\\Program Files\\x'), 'programs on D:');
  assert.ok(rootProblem('D:\\Games\\SteamLibrary'), 'games');
  assert.strictEqual(rootProblem('D:\\code\\intel'), null, 'system folder names only count at the top of a drive');
  assert.ok(rootProblem(path.dirname(HOME)), 'a folder that contains home');
  assert.ok(rootProblem('\\\\server\\share\\code'), 'network folder');
  assert.strictEqual(rootProblem(path.join(HOME, 'Projects')), null);
  assert.strictEqual(rootProblem('D:\\code'), null);
});

test('the check before cleaning refuses anything unexpected', async () => {
  const prot = protectedSet(ROOTS);
  const nm = byPath(path.join(old, 'node_modules'));
  const ch = find((i) => i.title === 'Google Chrome');
  assert.strictEqual(await verify(nm, nm.paths[0], prot), null);
  assert.ok(await verify(nm, HOME, prot), 'home');
  assert.ok(await verify(nm, P, prot), 'project root itself');
  assert.ok(await verify(nm, path.join(OUTSIDE, 'real-project', 'node_modules'), prot), 'outside home and roots');
  assert.ok(await verify(nm, path.join(P, 'via-junction', 'node_modules'), prot), 'through a junction');
  assert.ok(await verify(nm, nm.paths[0].toUpperCase(), prot), 'different letter case');
  assert.ok(await verify(ch, path.join(chrome, 'Default'), prot), 'a whole browser profile');
  assert.ok(await verify(ch, path.join(chrome, 'NotAProfile', 'Cache'), prot), 'cache outside a profile');
  assert.ok(await verify(ch, LOCAL, prot), 'AppData\\Local');
  assert.ok(await verify(ch, path.join(LOCAL, 'SomeApp', 'Cache'), prot), 'unknown app');
  if (GAME_NM) {
    assert.ok(!byPath(GAME_NM), 'node_modules inside a game library is not offered');
    assert.ok(await verify(nm, GAME_NM, prot), 'and refused right before cleaning');
  }
  assert.ok(await verify({ ...nm, kindId: 'node-modules' }, path.join(LOCAL, 'Temp'), prot), 'Temp is not node_modules');
});

test('clean: everything recommended, plus the copy and the Recycle Bin', async () => {
  const chosen = result.items.filter((i) => (i.recommended && i.risk !== 'locked')
    || i.group === 'duplicate' || i.action === 'empty-trash' || i.title === 'Temporary files' || i.paths.includes(wtClean));
  const trashed = [];
  let binEmptied = 0;
  const res = await clean(chosen, {
    projectRoots: ROOTS,
    trash: async (p) => { trashed.push(p); fs.renameSync(p, path.join(OUTSIDE, `trashed-${path.basename(p)}`)); },
    emptyTrash: async () => { binEmptied++; },
  }, () => {});
  const bad = res.results.filter((r) => r.status !== 'done' && r.status !== 'skipped');
  assert.deepStrictEqual(bad, [], 'every item cleaned');

  assert.ok(!fs.existsSync(path.join(old, 'node_modules')), 'node_modules removed');
  assert.ok(!fs.existsSync(path.join(old, '.next')), '.next removed');
  assert.ok(fs.existsSync(path.join(old, 'src', 'index.js')), 'source kept');
  assert.strictEqual(fs.readFileSync(path.join(PRECIOUS, 'keep.txt'), 'utf8'), 'keep me', 'junction target untouched');
  assert.ok(fs.existsSync(path.join(realElsewhere, 'node_modules', 'x', 'x.bin')), 'project behind a junction untouched');

  assert.ok(!fs.existsSync(venv), 'venv removed');
  assert.ok(fs.existsSync(path.join(py, 'uv.lock')), 'lockfile kept');

  assert.ok(!fs.existsSync(wtClean), 'clean worktree removed');
  assert.ok(git(repo, 'branch', '--list', 'wt-clean').trim(), 'its branch is kept');
  assert.ok(fs.existsSync(path.join(wtDirty, 'package.json')), 'dirty worktree untouched');

  assert.ok(trashed.some((p) => p.endsWith('old-app - Copy')), 'copy went to the Recycle Bin');
  assert.strictEqual(binEmptied, 1, 'Recycle Bin emptied through Windows');

  assert.ok(fs.existsSync(path.join(chrome, 'Default', 'Cache')), 'cache folder itself kept');
  assert.strictEqual(fs.readdirSync(path.join(chrome, 'Default', 'Cache')).length, 0, 'cache emptied');
  assert.strictEqual(fs.readFileSync(path.join(chrome, 'Default', 'Login Data'), 'utf8'), 'secret logins', 'logins kept');
  assert.ok(fs.existsSync(path.join(chrome, 'Default', 'Preferences')), 'browser settings kept');
  assert.ok(fs.existsSync(path.join(chrome, 'NotAProfile', 'Cache', 'x')), 'non-profile folder kept');
  assert.ok(fs.existsSync(path.join(ROAMING, 'Code', 'User', 'settings.json')), 'VS Code settings kept');
  assert.strictEqual(fs.readdirSync(path.join(LOCAL, 'Temp')).length, 0, 'Temp emptied');
  assert.ok(fs.existsSync(path.join(LOCAL, 'SomeApp', 'Cache', 'x.bin')), 'unknown app cache kept');
  assert.ok(fs.existsSync(path.join(HOME, 'Downloads', 'setup.exe')), 'downloads kept (never preselected)');

  if (otherProject) {
    assert.ok(!fs.existsSync(path.join(otherProject, 'node_modules')), 'node_modules on the other drive removed');
    assert.ok(fs.existsSync(path.join(otherProject, 'package.json')), 'its project kept');
    assert.ok(fs.existsSync(path.join(GAME_NM, 'g', 'g.bin')), 'game files untouched');
  }
  assert.ok(Array.isArray(res.volumes) && res.volumes.length >= 1);
});

test('cleanup', () => {
  fs.rmSync(HOME, { recursive: true, force: true });
  fs.rmSync(OUTSIDE, { recursive: true, force: true });
  if (OTHER) fs.rmSync(OTHER, { recursive: true, force: true });
});
