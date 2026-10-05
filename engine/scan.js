'use strict';
const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const {
  HOME, run, git: gitRaw, findNestedGit, trackedState, diskUsage, pool, exists, isRealDir, readdirSafe, tilde, expandHome, diskInfo, lastActivity,
} = require('./util');
const {
  CATEGORIES, BUILD_DIRS, DEV_CACHES, APP_CACHE_TEXT, APP_CACHE_SKIP, INSTALLER_EXT,
  SAFE_APP_CACHES, APP_CACHE_WARNINGS, APP_CACHE_UNKNOWN,
} = require('./catalog');
const { assessWorktree } = require('./worktree');

const DAY = 86400000;
const MB = 1024 * 1024;
const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'], ['package-lock.json', 'npm'], ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'], ['bun.lock', 'bun'],
];
const NO_DESCEND = new Set(['.git', '.Trash', 'Library', '.venv', 'venv', '__pycache__', '.idea', '.gradle', 'Pods', 'DerivedData']);
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };

const idOf = (...parts) => crypto.createHash('sha1').update(parts.join('\n')).digest('hex').slice(0, 12);

function agoText(ms, now = Date.now()) {
  if (!ms) return null;
  const days = Math.floor((now - ms) / DAY);
  if (days <= 0) return 'Used today';
  if (days === 1) return 'Used yesterday';
  if (days < 45) return `Used ${days} days ago`;
  const months = Math.round(days / 30);
  return `Not used for ${months} month${months === 1 ? '' : 's'}`;
}

async function lockIn(d) {
  for (const [file, pm] of LOCKFILES) {
    if (await exists(path.join(d, file))) return { root: d, lockfile: file, pm };
  }
  return null;
}
async function isWorkspaceRoot(d) {
  if (await exists(path.join(d, 'pnpm-workspace.yaml'))) return true;
  try { return Boolean(JSON.parse(await fsp.readFile(path.join(d, 'package.json'), 'utf8')).workspaces); } catch { return false; }
}
/**
 * The project a folder belongs to: its own lockfile folder, or an enclosing monorepo root
 * (one that declares workspaces). Never climbs out of a git repository or above the scan root,
 * so a stray lockfile higher up cannot pull unrelated projects together.
 */
async function findLockRoot(dir, stopAt) {
  const own = await lockIn(dir);
  if (own) return own;
  let d = dir;
  while (d !== stopAt && d.startsWith(stopAt + '/')) {
    if (await exists(path.join(d, '.git'))) break;
    d = path.dirname(d);
    if (await isWorkspaceRoot(d)) {
      const l = await lockIn(d);
      if (l) return l;
    }
  }
  return { root: dir, lockfile: null, pm: null };
}

async function git(cwd, args, timeout = 15000) {
  const out = await gitRaw(cwd, args, timeout);
  return out === null ? null : out.trim();
}

/** Walk project folders, collecting generated folders, node_modules, worktrees and duplicate copies. */
async function walkProjects(roots, onProgress) {
  const found = { build: [], deps: [], worktrees: [], copies: [] };
  let visited = 0;

  async function walk(dir, depth, root) {
    if (depth > 10) return;
    visited++;
    if (visited % 200 === 0) onProgress && onProgress({ phase: 'walk', detail: tilde(dir) });
    const entries = await readdirSafe(dir);
    const names = new Set(entries.map((e) => e.name));
    for (const e of entries) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      const name = e.name;
      if (name === 'node_modules') {
        // Only a real project's dependencies (package.json next to it). Anything else is left alone.
        if (names.has('package.json')) found.deps.push({ dir: full, parent: dir, root });
        continue;
      }
      if (name.endsWith('.app')) continue; // never look inside application bundles
      if (NO_DESCEND.has(name)) continue;
      const bd = BUILD_DIRS[name];
      if (bd && bd.markers.some((m) => names.has(m))) {
        found.build.push({ dir: full, parent: dir, kind: name, root });
        continue;
      }
      if (name === '.claude' || name === '.codex' || name === '.conductor') {
        const wtDir = path.join(full, 'worktrees');
        for (const w of await readdirSafe(wtDir)) {
          if (w.isDirectory() && !w.isSymbolicLink()) {
            found.worktrees.push({ dir: path.join(wtDir, w.name), owner: dir, tool: name.slice(1) });
          }
        }
        continue;
      }
      const m = /^(.+?) copy(?: \d+)?$/.exec(name);
      const orig = m && entries.find((x) => x.name === m[1]);
      if (orig && orig.isDirectory() && !orig.isSymbolicLink()) {
        found.copies.push({ dir: full, original: path.join(dir, m[1]) });
        // Still walk into the copy so its own heavy folders are visible separately.
      }
      if (name.startsWith('.')) {
        // Hidden folders (tool installs, editor data, VCS internals) are never scanned into.
        continue;
      }
      await walk(full, depth + 1, root);
    }
  }

  for (const r of roots) {
    if (await isRealDir(r)) await walk(r, 0, r);
  }
  return found;
}

async function buildItems(found, settings, onProgress) {
  const now = Date.now();
  const items = [];
  const activityCache = new Map();
  const activity = async (dir) => {
    if (!activityCache.has(dir)) activityCache.set(dir, lastActivity(dir));
    return activityCache.get(dir);
  };
  const inactiveMs = (settings.inactiveDays || 14) * DAY;

  // ---- Build caches, grouped per project root + kind
  const buildGroups = new Map();
  for (const b of found.build) {
    // Never touch a folder that git tracks (or when git cannot tell).
    if ((await trackedState(b.parent, b.kind, b.root)) !== 'untracked') continue;
    // A git repository inside a build folder is someone's work, not output.
    if (await findNestedGit(b.dir)) continue;
    // "coverage" is a common folder name: only treat it as a report when report files are there.
    if (b.kind === 'coverage') {
      const inside = new Set((await readdirSafe(b.dir)).map((e) => e.name));
      if (!['lcov.info', 'coverage-final.json', 'coverage-summary.json', 'clover.xml', 'lcov-report', 'cobertura-coverage.xml'].some((f) => inside.has(f))) continue;
    }
    const lr = await findLockRoot(b.parent, b.root);
    const key = lr.root + '\n' + b.kind;
    if (!buildGroups.has(key)) buildGroups.set(key, { root: lr.root, kind: b.kind, paths: [] });
    buildGroups.get(key).paths.push(b.dir);
  }
  for (const g of buildGroups.values()) {
    const info = BUILD_DIRS[g.kind];
    const last = await activity(g.root);
    const tags = [];
    const usedToday = last && now - last < DAY;
    if (usedToday) tags.push('Used today');
    items.push({
      id: idOf('build', g.root, g.kind),
      category: 'build',
      title: path.basename(g.root),
      kindLabel: info.label,
      subtitle: tilde(g.root),
      paths: g.paths,
      action: 'delete',
      risk: 'safe',
      recommended: true,
      tags,
      what: info.what + (g.paths.length > 1 ? ` (${g.paths.length} folders in this project)` : ''),
      after: info.after,
      lose: 'No. Only generated files are removed. Your source code is untouched.',
      note: usedToday ? 'If its dev server is running, stop it before cleaning.' : null,
    });
  }

  // ---- node_modules, grouped per lockfile root (skip ones inside worktrees: they belong to the worktree item)
  const depGroups = new Map();
  for (const d of found.deps) {
    const ts = await trackedState(d.parent, 'node_modules', d.root);
    if (ts !== 'untracked') continue; // vendored or unknown: never offered
    d.nestedGit = await findNestedGit(d.dir);
    if (d.nestedGit === 'TOO_BIG') d.nestedGit = d.dir; // could not finish checking: treat as unsafe
    const lr = await findLockRoot(d.parent, d.root);
    if (!depGroups.has(lr.root)) depGroups.set(lr.root, { ...lr, paths: [] });
    depGroups.get(lr.root).paths.push(d.dir);
    if (d.nestedGit) depGroups.get(lr.root).nestedGit = d.nestedGit;
  }
  for (const g of depGroups.values()) {
    const last = await activity(g.root);
    const inactive = last ? now - last > inactiveMs : true;
    const tags = [];
    const ago = agoText(last, now);
    if (ago) tags.push(ago);
    const pm = g.pm || 'npm';
    items.push({
      id: idOf('deps', g.root),
      category: 'deps',
      title: path.basename(g.root),
      kindLabel: 'node_modules',
      subtitle: tilde(g.root),
      paths: g.paths,
      action: 'delete',
      risk: g.nestedGit ? 'locked' : (g.lockfile ? 'safe' : 'check'),
      recommended: Boolean(!g.nestedGit && inactive && g.lockfile),
      lockedReason: g.nestedGit ? `Contains a git repository (${tilde(g.nestedGit)}) that may hold your own work. Clearspace will not remove it.` : null,
      tags,
      active: !inactive,
      pm,
      what: `Packages installed for this project${g.paths.length > 1 ? ` (${g.paths.length} node_modules folders)` : ''}.`,
      after: g.lockfile
        ? `Run \`${pm} install\` before you work on it again. It restores the exact versions from ${g.lockfile}.`
        : 'Run your install command before you work on it again. There is no lockfile, so newer package versions may be installed.',
      lose: 'No, unless you edited files inside node_modules by hand (for example a patch you have not saved with patch-package). Your code, git history and .env files are not in there.',
      note: pm === 'pnpm'
        ? 'pnpm shares package files with its store, so most of this space is freed by "Unused packages in the pnpm store" in Developer caches.'
        : (!inactive ? 'You used this project recently. Leave it unless you need the space.' : null),
    });
  }

  // ---- Worktrees (assessed by engine/worktree.js; the same check runs again right before cleaning)
  for (const w of found.worktrees) {
    onProgress && onProgress({ phase: 'git', detail: tilde(w.dir) });
    const a = await assessWorktree(w.dir);
    const project = path.basename(w.owner);
    const base = { category: 'leftovers', title: path.basename(w.dir), subtitle: tilde(w.dir), paths: [w.dir], tags: [] };
    if (a.kind === 'copy') {
      items.push({
        ...base,
        id: idOf('wt-copy', w.dir),
        group: 'wtcopy',
        kindLabel: 'copied worktree folder',
        action: 'trash',
        risk: 'check',
        recommended: false,
        what: `A copy of an AI-agent worktree inside ${project}. Git does not use this copy: the real worktree is at ${tilde(a.registeredAt)}.`,
        after: 'The folder moves to the Trash. The real worktree and its branch are not touched.',
        lose: 'Only files you edited in this copy by hand. You can put it back from the Trash.',
      });
      continue;
    }
    if (a.kind === 'unknown') {
      items.push({
        ...base,
        id: idOf('wt-unknown', w.dir),
        group: 'worktree',
        kindLabel: `folder in ${project} worktrees`,
        action: 'worktree',
        risk: 'locked',
        recommended: false,
        lockedReason: a.reason,
        what: 'A folder where AI agents keep worktrees, but Clearspace could not confirm it is a disposable worktree.',
        after: 'Clearspace will not clean it.',
        lose: 'Not applicable: it is locked.',
      });
      continue;
    }
    const tags = a.branch === 'HEAD' ? ['Detached HEAD'] : (a.branch === `worktree-${path.basename(w.dir)}` ? [] : [`Branch ${a.branch}`]);
    if (a.recentlyActive) tags.push('Active in the last 24 hours');
    else {
      const ago = agoText(Math.max(a.lastActivity || 0, a.lastCommit || 0), now);
      if (ago) tags.push(ago.replace('Used', 'Last active').replace('Not used for', 'Inactive for'));
    }
    const orphans = (a.historyOrphans || []).length;
    const risk = a.locked ? 'locked'
      : (a.unpushed || orphans || a.recentlyActive || (a.probable && a.probable.length) ? 'check' : 'safe');
    items.push({
      ...base,
      id: idOf('wt', w.dir),
      group: 'worktree',
      kindLabel: `worktree of ${project}`,
      action: 'worktree',
      risk,
      recommended: risk === 'safe',
      tags,
      lockedReason: a.locked ? a.reason : null,
      note: a.recentlyActive ? 'Git activity in the last 24 hours: an AI agent may still be working here. Make sure it has finished.' : null,
      what: `A separate working copy an AI coding agent created on branch ${a.branch}. Your main ${project} folder does not use it.`,
      after: `Removed with \`git worktree remove\`. The branch ${a.branch} stays in your repository.`,
      lose: (a.unpushed
        ? `No commits are lost: its ${a.unpushed} commit${a.unpushed === 1 ? '' : 's'} not pushed yet stay on branch ${a.branch} in your main repo.`
        : 'No commits are lost: everything on this branch is already in your repository.')
        + (orphans ? ` ${orphans} older commit${orphans === 1 ? '' : 's'} from its history that no branch contains will be saved in your repo under refs/clearspace-backup/${path.basename(w.dir)}.` : '')
        + (a.probable && a.probable.length ? ` Ignored folders that are usually build output are deleted too: ${a.probable.slice(0, 4).join(', ')}. Check them if you ever put files there by hand.` : ''),
      meta: { branch: a.branch, unpushed: a.unpushed, dirty: a.dirty },
    });
  }

  // ---- Duplicate project copies
  for (const c of found.copies) {
    const origHead = await git(c.original, ['rev-parse', 'HEAD']);
    const copyHead = await git(c.dir, ['rev-parse', 'HEAD']);
    const same = origHead && copyHead && origHead === copyHead;
    const copyStatus = copyHead ? await git(c.dir, ['status', '--porcelain', '--untracked-files=normal']) : null;
    const copyChanges = copyStatus ? copyStatus.split('\n').filter(Boolean).length : 0;
    items.push({
      id: idOf('copy', c.dir),
      category: 'leftovers',
      group: 'duplicate',
      title: path.basename(c.dir),
      kindLabel: `Duplicate of ${path.basename(c.original)}`,
      subtitle: tilde(c.dir),
      paths: [c.dir],
      action: 'trash',
      risk: 'check',
      recommended: false,
      tags: [...(same ? ['Same latest commit as the original'] : []), ...(copyChanges ? [`${copyChanges} uncommitted change${copyChanges === 1 ? '' : 's'} in the copy`] : [])],
      what: `A Finder copy of ${path.basename(c.original)}, including its own node_modules and worktrees.`,
      after: 'The whole folder moves to the Trash. You can put it back from the Trash until you empty it.',
      lose: (same
        ? 'It is at the same commit as the original, but Clearspace did not compare uncommitted changes, untracked files or .env files.'
        : 'Possibly: it is not at the same commit as the original.')
        + (copyChanges ? ` Git shows ${copyChanges} uncommitted change${copyChanges === 1 ? '' : 's'} in the copy.` : '')
        + ' Look inside before cleaning. It goes to the Trash, so you can put it back.',
    });
  }

  // ---- Developer caches
  let pnpmStore = null;
  const sp = await run('pnpm', ['store', 'path'], { timeout: 10000, cwd: HOME });
  if (sp.code === 0 && sp.stdout.trim()) pnpmStore = path.dirname(sp.stdout.trim());
  for (const c of DEV_CACHES) {
    let p = expandHome(c.path);
    if (c.key === 'pnpm-prune') {
      if (sp.code !== 0) continue; // pnpm not installed
      if (pnpmStore) p = pnpmStore;
    }
    if (!(await isRealDir(p))) continue;
    items.push({
      id: idOf('pkg', c.key),
      category: 'pkg',
      title: c.name,
      kindLabel: null,
      subtitle: tilde(p),
      paths: [p],
      action: c.action,
      risk: c.risk || 'safe',
      recommended: c.risk !== 'check' && c.key !== 'pnpm-prune',
      sizeLabel: c.sizeLabel || null,
      tags: [],
      what: c.what,
      after: c.after,
      lose: 'No, but they must be downloaded again (needs internet) or rebuilt when a tool needs them.',
      note: c.note || null,
      key: c.key,
    });
  }

  // ---- ~/.cache: one item per tool, never preselected (some tools keep models or tokens here)
  const dotCache = path.join(HOME, '.cache');
  for (const e of await readdirSafe(dotCache)) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    if (/^(lm-studio|gh|github-copilot|op|1password)$/i.test(e.name)) continue;
    let p = path.join(dotCache, e.name);
    let title = `${e.name} cache`;
    if (e.name === 'huggingface') {
      p = path.join(p, 'hub'); // models only; the login token next to it is kept
      if (!(await isRealDir(p))) continue;
      title = 'Hugging Face downloaded models';
    }
    items.push({
      id: idOf('dotcache', p),
      category: 'pkg',
      key: 'dot-cache',
      title,
      kindLabel: null,
      subtitle: tilde(p),
      paths: [p],
      action: 'delete',
      risk: 'check',
      recommended: false,
      tags: [],
      what: `Files a command-line tool (${e.name}) keeps in ~/.cache.`,
      after: 'The tool downloads or rebuilds what it needs the next time it runs. Large downloads, such as AI models, take time to fetch again.',
      lose: 'Usually not: caches hold re-downloadable data. Check first if you are not sure what this tool is.',
    });
  }

  // ---- App caches & logs
  const cachesDir = path.join(HOME, 'Library', 'Caches');
  for (const e of await readdirSafe(cachesDir)) {
    if (!e.isDirectory() || e.isSymbolicLink()) continue;
    if (APP_CACHE_SKIP.some((re) => re.test(e.name))) continue;
    const p = path.join(cachesDir, e.name);
    const known = SAFE_APP_CACHES.some((re) => re.test(e.name));
    const warn = APP_CACHE_WARNINGS.find(([re]) => re.test(e.name));
    const safe = known && !warn;
    items.push({
      id: idOf('app', p),
      category: 'apps',
      title: prettyBundle(e.name),
      kindLabel: safe ? null : 'not on the known-safe list',
      subtitle: tilde(p),
      paths: [p],
      action: 'empty',
      risk: safe ? 'safe' : 'check',
      recommended: safe,
      tags: [],
      minSize: 5 * MB,
      ...APP_CACHE_TEXT,
      ...(safe ? {} : { lose: warn ? warn[1] : APP_CACHE_UNKNOWN }),
    });
  }
  const logs = path.join(HOME, 'Library', 'Logs');
  if (await isRealDir(logs)) {
    items.push({
      id: idOf('app', logs),
      category: 'apps',
      title: 'Log files',
      subtitle: tilde(logs),
      paths: [logs],
      action: 'empty',
      risk: 'safe',
      recommended: true,
      tags: [],
      minSize: 5 * MB,
      what: 'Diagnostic logs and crash reports written by apps.',
      after: 'Apps start new log files. Old crash reports are gone.',
      lose: 'Only old logs, which you would need only to debug a past crash.',
    });
  }

  // ---- Downloads & Trash
  const dl = path.join(HOME, 'Downloads');
  for (const e of await readdirSafe(dl)) {
    if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
    const p = path.join(dl, e.name);
    let st;
    try { st = await fsp.lstat(p); } catch { continue; }
    if (e.isFile() && st.size < 50 * MB) continue;
    const installer = e.isFile() && INSTALLER_EXT.test(e.name);
    const partialDl = /\.(crdownload|download|part|partial)$/i.test(e.name);
    const age = Math.floor((now - (st.birthtimeMs || st.mtimeMs)) / DAY);
    items.push({
      id: idOf('dl', p),
      category: 'files',
      title: e.name,
      kindLabel: partialDl ? 'Unfinished download' : installer ? 'Installer or archive' : (e.isDirectory() ? 'Folder' : 'File'),
      subtitle: tilde(p),
      paths: [p],
      action: 'trash',
      risk: 'check',
      recommended: false,
      tags: [age <= 0 ? 'Added today' : `Added ${age} day${age === 1 ? '' : 's'} ago`],
      knownSize: e.isFile() ? st.size : undefined,
      minSize: 50 * MB,
      what: installer
        ? 'A downloaded installer or archive. Once the app is installed or the files extracted, it is usually not needed.'
        : 'A large item in your Downloads folder.',
      after: 'It moves to the Trash. You can put it back until you empty the Trash.',
      lose: 'Only if you still need this file. Check before cleaning.',
    });
  }
  const trash = path.join(HOME, '.Trash');
  items.push({
    id: idOf('trash'),
    category: 'files',
    title: 'Trash',
    kindLabel: null,
    subtitle: 'Items you already moved to the Trash',
    paths: [trash],
    action: 'empty-trash',
    risk: 'check',
    recommended: false,
    tags: [],
    minSize: 1,
    what: 'Files you deleted in Finder. They still take space until the Trash is emptied.',
    after: 'Everything in your Trash on this Mac is deleted. Trash folders on external drives are not touched.',
    lose: 'Yes: everything in the Trash is deleted for good and cannot be put back.',
  });

  return items;
}

function prettyBundle(name) {
  const known = {
    'com.google.Chrome': 'Google Chrome', Google: 'Google (Chrome and others)', 'com.microsoft.VSCode': 'Visual Studio Code',
    'com.microsoft.VSCode.ShipIt': 'Visual Studio Code updates', 'com.todesktop.230313mzl4w4u92': 'Cursor',
    'com.todesktop.230313mzl4w4u92.ShipIt': 'Cursor updates', 'com.spotify.client': 'Spotify', 'com.tinyspeck.slackmacgap': 'Slack',
    'com.hnc.Discord': 'Discord', 'org.whispersystems.signal-desktop': 'Signal', 'com.figma.Desktop': 'Figma',
    'com.openai.chat': 'ChatGPT', 'com.anthropic.claudefordesktop': 'Claude', 'com.anthropic.claudefordesktop.ShipIt': 'Claude updates',
    'company.thebrowser.Browser': 'Arc', 'com.brave.Browser': 'Brave', 'org.mozilla.firefox': 'Firefox', Firefox: 'Firefox',
    'dev.warp.Warp-Stable': 'Warp', 'com.exafunction.windsurf': 'Windsurf', 'com.postmanlabs.mac': 'Postman',
    'us.zoom.xos': 'Zoom', 'com.microsoft.teams2': 'Microsoft Teams', 'notion.id': 'Notion', 'com.github.GitHubClient': 'GitHub Desktop',
    'node-gyp': 'node-gyp headers', typescript: 'TypeScript', 'next-swc': 'Next.js SWC', 'pnpm': 'pnpm metadata', 'node': 'Node.js',
    'com.docker.docker': 'Docker Desktop', 'mega.mac': 'MEGA', 'com.anydesk.anydeskmacos': 'AnyDesk',
  };
  if (known[name]) return known[name];
  if (/^[a-z0-9-]+(\.[A-Za-z0-9-]+){2,}$/.test(name)) {
    const parts = name.split('.');
    const last = parts[parts.length - 1] === 'ShipIt' ? parts[parts.length - 2] + ' updates' : parts[parts.length - 1];
    return last.charAt(0).toUpperCase() + last.slice(1);
  }
  return name;
}

/** Folders that must not be used as project folders (they hold tools, apps or system data). */
function rootProblem(real) {
  if (real === HOME || !real.startsWith(HOME + '/')) return 'choose a folder inside your home folder, not the home folder itself';
  const first = real.slice(HOME.length + 1).split('/')[0];
  if (first.toLowerCase() === 'library') return 'the Library folder holds app and system data';
  if (first.startsWith('.')) return 'hidden folders hold tools and settings';
  if (real.split('/').some((seg) => seg.endsWith('.app'))) return 'it is inside an application';
  return null;
}

/** Full scan. `onProgress({phase, detail, done, total})`. */
async function scan(settings, onProgress) {
  const started = Date.now();
  const warnings = [];
  const roots = [];
  for (const r of (settings.projectRoots || []).map(expandHome)) {
    let real;
    try { real = await fsp.realpath(r); } catch { continue; }
    const why = rootProblem(real);
    if (why) { warnings.push(`${tilde(real)} is not scanned: ${why}`); continue; }
    if (!roots.includes(real)) roots.push(real);
  }
  // A root inside another root would be scanned twice.
  for (let i = roots.length - 1; i >= 0; i--) {
    if (roots.some((o, j) => j !== i && roots[i].startsWith(o + '/'))) roots.splice(i, 1);
  }
  onProgress && onProgress({ phase: 'walk', detail: 'Looking through your project folders' });
  const found = await walkProjects(roots, onProgress);
  onProgress && onProgress({ phase: 'git', detail: 'Checking worktrees and project activity' });
  let items = await buildItems(found, settings, onProgress);

  // Every path must resolve to itself: nothing reached through a symbolic link anywhere along the way.
  const canonical = await Promise.all(items.map(async (it) => {
    if (it.action === 'empty-trash') return true;
    for (const p of it.paths) {
      try { if ((await fsp.realpath(p)) !== p) return false; } catch { return false; }
    }
    return true;
  }));
  items = items.filter((_, i) => canonical[i]);

  // Measure sizes
  let done = 0;
  const total = items.length;
  await pool(items, 6, async (it) => {
    if (it.knownSize !== undefined) {
      it.size = it.knownSize;
    } else {
      const sizes = await Promise.all(it.paths.map((p) => diskUsage(p)));
      it.size = sizes.some((s) => s === null) && sizes.every((s) => s === null)
        ? null
        : sizes.reduce((a, s) => a + (s || 0), 0);
    }
    done++;
    onProgress && onProgress({ phase: 'measure', detail: it.title, done, total });
  });

  // Drop noise
  const min = { build: 1 * MB, deps: 1 * MB, leftovers: 1 * MB, pkg: 1 * MB, apps: 5 * MB, files: 50 * MB };
  items = items.filter((it) => {
    if (it.action === 'empty-trash') {
      if (it.size === null) warnings.push('Clearspace could not measure the Trash. Give it Full Disk Access in System Settings to include it.');
      return it.size >= MB;
    }
    if (it.size === null) return it.risk === 'locked';
    return it.size >= (it.minSize || min[it.category] || MB);
  });
  for (const it of items) { delete it.knownSize; delete it.minSize; }

  items.sort((a, b) => (b.size || 0) - (a.size || 0));
  const categories = CATEGORIES.map((c) => {
    const list = items.filter((i) => i.category === c.id);
    return { ...c, count: list.length, size: list.reduce((a, i) => a + (i.size || 0), 0) };
  });
  return {
    items, categories, warnings,
    disk: await diskInfo(HOME),
    roots: roots.map(tilde),
    scannedAt: Date.now(),
    tookMs: Date.now() - started,
  };
}

module.exports = { scan, walkProjects, buildItems, agoText, prettyBundle, rootProblem };
