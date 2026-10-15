'use strict';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { HOME, run, git, diskInfo, expandHome, readdirSafe, trackedState, findNestedGit } = require('./util');
const { specById, DEV_CACHES, winAppCachePaths } = require('./catalog');
const {
  IS_WIN, DOWNLOADS, TRASH, BACKUPS, MAC_CACHES, LOGS, APP_DATA_NAME, WORDS, COPY_RE,
  isInside, samePath, segmentsBelow, systemProtected, rootProblem, areaBase, inSystemArea,
} = require('./platform');
const { emptyRecycleBin } = require('./recyclebin');
const { assessWorktree, backupHistory } = require('./worktree');
const kinds = require('./kinds');

/**
 * Folders that must never be removed or emptied themselves, whatever an item says.
 * Also carries `projectRoots`: on Windows, project folders on other drives (D:\code) are allowed places to clean.
 */
function protectedSet(projectRoots) {
  const s = new Set(systemProtected());
  const roots = [];
  for (const r of projectRoots || []) {
    const abs = path.resolve(expandHome(r));
    s.add(abs);
    roots.push(abs);
    try { const real = fs.realpathSync.native(abs); s.add(real); roots.push(real); } catch {}
  }
  s.projectRoots = roots;
  return s;
}

/** Protected, comparing the way the file system does (without letter case on Windows), and never a whole drive. */
const isProtected = (protectedPaths, n) => (IS_WIN
  ? path.parse(n).root === n || [...protectedPaths].some((x) => samePath(x, n))
  : protectedPaths.has(n));

/** Where a target may be: inside home, or (Windows) inside a project folder that passes the same checks as at scan time. */
const PROJECT_CATEGORIES = new Set(['build', 'deps', 'leftovers']);
function allowedPlace(item, n, protectedPaths) {
  if (isInside(n, HOME)) return true;
  if (!IS_WIN) return false;
  if (item.action === 'pnpm-prune') return true; // pnpm keeps a store per drive; the path is only measured, never touched
  return PROJECT_CATEGORIES.has(item.category)
    && (protectedPaths.projectRoots || []).some((r) => !rootProblem(r) && isInside(n, r));
}

/** Project-type targets (build caches, node_modules, worktrees, copies) never live in these places. */
const AGENT_DIRS = new Set(['.claude', '.codex', '.conductor']);
function inToolArea(n) {
  const base = areaBase(n);
  const rel = segmentsBelow(n, base);
  const parents = rel.slice(0, -1); // the target itself may be hidden (.next, .turbo)
  return (base === HOME && rel[0].toLowerCase() === APP_DATA_NAME.toLowerCase())
    || parents.some((seg) => (seg.startsWith('.') && !AGENT_DIRS.has(seg)) || (IS_WIN && seg.startsWith('$')))
    || (base !== HOME && inSystemArea(rel))
    || rel.some((seg) => seg.endsWith('.app'));
}

/**
 * Check that `p` is exactly the kind of thing `item` claims to be, right now.
 * Returns { why, st }: why is null when OK, 'gone' when it no longer exists, or a reason.
 */
async function check(item, p, protectedPaths) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return { why: 'Path is not absolute' };
  const n = path.resolve(p);
  if (n !== p.replace(IS_WIN ? /[\\/]+$/ : /\/+$/, '')) return { why: 'Path is not normalized' };
  if (item.action === 'empty-trash') {
    if (n !== TRASH) return { why: `Unexpected ${WORDS.trash} path` };
    // Windows empties the Recycle Bin itself (SHEmptyRecycleBin); Clearspace never deletes inside $Recycle.Bin.
    if (IS_WIN) return { why: null, st: null };
  } else {
    if (!allowedPlace(item, n, protectedPaths)) return { why: 'Outside your home folder and your project folders' };
    if (isProtected(protectedPaths, n)) return { why: 'Protected folder' };
  }
  let st;
  // bigint: Windows file ids are 64-bit and must compare exactly (see stillSame).
  try { st = await fsp.lstat(n, { bigint: true }); } catch { return { why: 'gone' }; }
  if (st.isSymbolicLink()) return { why: 'Is a symbolic link' };
  // No symbolic link anywhere along the path (a linked parent could redirect the delete).
  try {
    if ((await fsp.realpath(n)) !== n) return { why: 'The path goes through a symbolic link' };
  } catch { return { why: 'gone' }; }
  if (!st.isDirectory() && item.category !== 'files') return { why: 'Not a folder' };

  const base = path.basename(n);
  const parent = path.dirname(n);
  const why = await (async () => {
    switch (item.category) {
      case 'build':
      case 'deps': {
        if (inToolArea(n)) return `Inside an app, ${APP_DATA_NAME} or hidden tool folder`;
        // The exact kind the scan matched must still match now: name, project files next to it, contents.
        const spec = specById(item.kindId || (item.category === 'deps' ? 'node-modules' : ''));
        if (!spec || spec.category !== item.category) return 'Unknown kind of project folder';
        if (base !== spec.name) return `Not a ${spec.name} folder`;
        if (!spec.markers.some((m) => fs.existsSync(path.join(parent, m)))) return `No ${spec.markers[0]} next to it`;
        if (!(await kinds.insideOk(spec, n))) return `Does not look like ${spec.label.toLowerCase()} any more`;
        if (spec.category === 'deps') {
          const cont = await kinds.contents(spec, n);
          if (cont.lock) return cont.lock;
        }
        // Something listed as Safe must still be exactly what the scan saw.
        if (item.risk === 'safe') {
          if (spec.generic && !(await kinds.ignoredByGit(parent, base))) return 'git no longer ignores it. Scan again.';
          if (spec.knownTop && (await kinds.unexpectedTop(spec, n))) return 'Something new appeared inside it. Scan again.';
          for (const entry of Object.keys(spec.notOutput || {})) {
            if (fs.existsSync(path.join(n, entry))) return `${spec.name}/${entry} appeared after the scan. Scan again.`;
          }
          if (spec.category === 'deps' && (await kinds.changedAfterInstall(spec, n)).changed) return 'A file inside it changed after the scan. Scan again.';
        }
        return await projectFolderStillDisposable(parent, base, n, protectedPaths, spec);
      }
      case 'leftovers': {
        if (inToolArea(n)) return `Inside an app, ${APP_DATA_NAME} or hidden tool folder`;
        if (item.group === 'duplicate') {
          return item.action === 'trash' && COPY_RE.test(base) ? null : 'Not a duplicate copy folder';
        }
        if (path.basename(parent) !== 'worktrees') return 'Not in a worktrees folder';
        const a = await assessWorktree(n);
        if (item.group === 'wtcopy') {
          return item.action === 'trash' && a.kind === 'copy' ? null : 'It no longer looks like a copied worktree. Scan again.';
        }
        if (item.action !== 'worktree' || a.kind !== 'linked') return 'Not a linked git worktree';
        return a.locked ? a.reason : null;
      }
      case 'pkg': {
        if (item.key === 'dot-cache') {
          const dc = path.join(HOME, '.cache');
          return (samePath(parent, dc) || samePath(n, path.join(dc, 'huggingface', 'hub'))) ? null : 'Not a ~/.cache tool folder';
        }
        if (item.key === 'pnpm-prune') return null;
        const known = DEV_CACHES.find((c) => c.key === item.key);
        if (!known || !known.path) return 'Unknown developer cache';
        return samePath(path.resolve(expandHome(known.path)), n) ? null : 'Developer cache path changed';
      }
      case 'apps':
        if (samePath(n, LOGS)) return null;
        // Windows: only cache folders found at their exact known location, looked up again now.
        if (IS_WIN) return winAppCachePaths().some((c) => samePath(c.path, n)) ? null : 'Not a known app cache folder';
        return parent === MAC_CACHES ? null : 'Not an app cache folder';
      case 'files':
        if (item.action === 'empty-trash') return null;
        if (item.group === 'backup') {
          if (!BACKUPS.some((b) => samePath(b, parent)) || item.action !== 'trash') return 'Not a device backup folder';
          return fs.existsSync(path.join(n, 'Info.plist')) ? null : 'Does not look like a device backup any more';
        }
        return samePath(parent, DOWNLOADS) && item.action === 'trash' ? null : 'Not in Downloads';
      default:
        return 'Unknown category';
    }
  })();
  return { why, st };
}

/** Same checks the scan made, repeated right before cleaning: not tracked by git, no git repository inside. */
async function projectFolderStillDisposable(parent, base, n, protectedPaths, spec) {
  // The project folder it is in (a whole data drive counts when it is a project folder; '/' and C: never do).
  const isRoot = (r) => (protectedPaths.projectRoots || []).some((x) => samePath(x, r));
  const root = [...protectedPaths].filter((r) => isInside(n, r) && !samePath(r, HOME) && (path.parse(r).root !== r || isRoot(r)))
    .sort((a, b) => b.length - a.length)[0] || parent;
  if ((await trackedState(parent, base, root)) !== 'untracked') return 'Git tracks it, or git could not check it';
  const nested = await kinds.nestedGit(spec || {}, n, { findNestedGit });
  if (nested === 'TOO_BIG') return 'Too large to check for git repositories inside';
  if (nested) return 'Contains a git repository';
  return null;
}

/** Back-compat helper used by tests: returns only the reason. */
async function verify(item, p, protectedPaths) {
  return (await check(item, p, protectedPaths)).why;
}

/** True when `p` is still the very same real folder that was checked (closes swap-in-a-symlink races). */
async function stillSame(p, st) {
  try {
    const now = await fsp.lstat(p, { bigint: typeof st.ino === 'bigint' });
    if (now.isSymbolicLink() || now.dev !== st.dev || now.ino !== st.ino) return false;
    return (await fsp.realpath(p)) === p;
  } catch { return false; }
}

const friendly = (err) => (['EPERM', 'EACCES', 'ENOTDIR', 'ENOTEMPTY'].includes(err.code)
  ? `${WORDS.os} did not allow removing some files (${err.code}).${IS_WIN ? ' Some may be open in an app.' : ''}`
  : err.code === 'EBUSY' ? 'Some files are in use.' : (err.message || String(err)));

async function rmrf(p, st) {
  if (!(await stillSame(p, st))) throw new Error('The folder changed after it was checked. Nothing was removed. Scan again.');
  await fsp.rm(p, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
}

/** Delete the contents of `p` but keep `p`. Returns the number of entries that could not be removed. */
async function emptyDir(p, st) {
  const entries = await readdirSafe(p);
  if (!(await stillSame(p, st))) throw new Error('The folder changed after it was checked. Nothing was removed. Scan again.');
  let failed = 0;
  let firstErr = null;
  for (const e of entries) {
    // Re-check before every entry: the folder must still be the one that was verified.
    if (!(await stillSame(p, st))) throw new Error('The folder changed while it was being cleaned. Stopped. Scan again.');
    try {
      // fs.rm never follows a symbolic link: a link inside is removed, its target is not touched.
      await fsp.rm(path.join(p, e.name), { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
    } catch (err) { failed++; firstErr = firstErr || err; }
  }
  return { failed, total: entries.length, firstErr };
}

async function removeWorktree(wt) {
  const a = await assessWorktree(wt);
  if (a.kind !== 'linked' || a.locked || !a.mainRepo) throw new Error(a.reason || 'Not a removable worktree');
  // Save commits only this worktree's history knows about, so nothing becomes unreachable.
  const saved = await backupHistory(a, path.basename(wt));
  // No --force: git itself also refuses if anything is modified or untracked.
  const r = await git(a.mainRepo, ['worktree', 'remove', wt], 600000);
  if (r === null) throw new Error('git worktree remove refused to remove it. Nothing else was changed.');
  return saved;
}

/** The disks to measure: home's first, then (Windows) every other drive an item is on; all drives for the Recycle Bin. */
function cleanedVolumes(items) {
  if (!IS_WIN) return [HOME];
  const home = path.parse(HOME).root.toUpperCase();
  const drives = new Set([home]);
  for (const it of items) {
    if (it.action === 'empty-trash') {
      for (let c = 67; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (fs.existsSync(d)) drives.add(d); }
    } else for (const p of it.paths) drives.add(path.parse(p).root.toUpperCase());
  }
  return [...drives].map((d) => (d === home ? HOME : d));
}

/**
 * Clean the given items (already chosen by the user from the latest scan).
 * deps: { trash(path) -> Promise, projectRoots }
 */
async function clean(items, deps, onProgress) {
  const protectedPaths = protectedSet(deps.projectRoots);
  // Free space is measured on every disk that cleaning touches (on Windows, projects often live on D:).
  const volumes = cleanedVolumes(items);
  const before = await Promise.all(volumes.map((v) => diskInfo(v)));
  const results = [];

  // Skip items that sit inside another selected item: cleaning the outer one covers them.
  const outerPaths = items.flatMap((i) => i.paths.map((p) => ({ p, id: i.id, title: i.title })));
  const work = [];
  for (const it of items) {
    const outer = it.paths.every((p) => outerPaths.some((o) => o.id !== it.id && isInside(p, o.p)))
      ? outerPaths.find((o) => o.id !== it.id && isInside(it.paths[0], o.p)) : null;
    if (outer) results.push({ id: it.id, title: it.title, status: 'skipped', message: `Included in ${outer.title}` });
    else work.push(it);
  }
  // Empty the Trash first (so items moved to the Trash in this run stay recoverable),
  // and prune pnpm last (so it sees node_modules that were just deleted).
  const rank = (it) => (it.action === 'empty-trash' ? 0 : it.action === 'pnpm-prune' ? 2 : 1);
  work.sort((a, b) => rank(a) - rank(b));

  let i = 0;
  for (const it of work) {
    i++;
    onProgress && onProgress({ index: i, total: work.length, title: it.title, id: it.id });
    const res = { id: it.id, title: it.title, status: 'done', message: null };
    try {
      const problems = [];
      let removedAny = false;
      let partial = null;
      for (const p of it.paths) {
        const { why, st } = await check(it, p, protectedPaths);
        if (why === 'gone') continue;
        if (why) { problems.push(why); continue; }
        switch (it.action) {
          case 'delete': await rmrf(p, st); break;
          case 'empty-trash':
            if (IS_WIN) { await (deps.emptyTrash || emptyRecycleBin)(); break; }
          // falls through: on macOS the Trash is a folder in home, emptied like any other
          case 'empty': {
            const r = await emptyDir(p, st);
            if (r.failed) {
              partial = it.action === 'empty-trash' && r.failed === r.total
                ? 'macOS did not allow emptying the Trash. Give Clearspace Full Disk Access in System Settings.'
                : `${r.failed} of ${r.total} item${r.total === 1 ? '' : 's'} could not be removed: ${friendly(r.firstErr)}`;
            }
            break;
          }
          case 'trash':
            if (!(await stillSame(p, st))) throw new Error('It changed after it was checked. Nothing was moved. Scan again.');
            await deps.trash(p);
            break;
          case 'worktree': {
            const saved = await removeWorktree(p);
            if (saved) res.message = `${saved} commit${saved === 1 ? '' : 's'} from its history saved under refs/clearspace-backup/`;
            break;
          }
          case 'pnpm-prune': {
            const r = await run('pnpm', ['store', 'prune'], { timeout: 900000, cwd: HOME });
            if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'pnpm store prune failed').trim().split('\n').pop());
            break;
          }
          default: throw new Error('Unknown action');
        }
        removedAny = true;
      }
      if (problems.length) {
        res.status = removedAny ? 'partial' : 'refused';
        res.message = `Not cleaned for safety: ${problems[0]}`;
      } else if (partial) {
        res.status = 'partial';
        res.message = partial;
      } else if (!removedAny) {
        res.status = 'skipped';
        res.message = 'Already gone';
      }
    } catch (err) {
      res.status = 'error';
      res.message = friendly(err);
    }
    results.push(res);
  }

  await new Promise((r) => setTimeout(r, 800)); // let APFS settle its free-space count
  const after = await Promise.all(volumes.map((v) => diskInfo(v)));
  const measured = before.every(Boolean) && after.every(Boolean);
  return {
    results,
    before: before[0],
    after: after[0],
    volumes: volumes.map((v, k) => ({ name: v, before: before[k], after: after[k] })),
    freed: measured ? volumes.reduce((a, _, k) => a + Math.max(0, after[k].free - before[k].free), 0) : null,
    estimated: items.filter((it) => results.find((r) => r.id === it.id && r.status === 'done')).reduce((a, it) => a + (it.size || 0), 0),
    finishedAt: Date.now(),
  };
}

module.exports = { clean, verify, check, protectedSet, stillSame };
