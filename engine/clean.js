'use strict';
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { HOME, run, git, diskInfo, expandHome, readdirSafe, trackedState, findNestedGit } = require('./util');
const { BUILD_DIRS, DEV_CACHES } = require('./catalog');
const { assessWorktree, backupHistory } = require('./worktree');

const CACHES = path.join(HOME, 'Library', 'Caches');
const DOWNLOADS = path.join(HOME, 'Downloads');
const TRASH = path.join(HOME, '.Trash');
const COVERAGE_FILES = ['lcov.info', 'coverage-final.json', 'coverage-summary.json', 'clover.xml', 'lcov-report', 'cobertura-coverage.xml'];

/** Folders that must never be removed or emptied themselves, whatever an item says. */
function protectedSet(projectRoots) {
  const s = new Set(['/', HOME, path.join(HOME, 'Library'), CACHES, DOWNLOADS, TRASH,
    path.join(HOME, 'Desktop'), path.join(HOME, 'Documents'), path.join(HOME, '.cache'),
    path.join(HOME, 'Library', 'Application Support'), path.join(HOME, 'Library', 'Mobile Documents'),
    path.join(HOME, 'Library', 'CloudStorage'), path.join(HOME, '.ssh'), path.join(HOME, '.config')]);
  for (const r of projectRoots || []) {
    const abs = path.resolve(expandHome(r));
    s.add(abs);
    try { s.add(fs.realpathSync.native(abs)); } catch {}
  }
  return s;
}

const isInside = (child, parent) => child !== parent && child.startsWith(parent.endsWith('/') ? parent : parent + '/');

/** Project-type targets (build caches, node_modules, worktrees, copies) never live in these places. */
const AGENT_DIRS = new Set(['.claude', '.codex', '.conductor']);
function inToolArea(n) {
  const rel = n.slice(HOME.length + 1).split('/');
  const parents = rel.slice(0, -1); // the target itself may be hidden (.next, .turbo)
  return rel[0].toLowerCase() === 'library'
    || parents.some((seg) => seg.startsWith('.') && !AGENT_DIRS.has(seg))
    || rel.some((seg) => seg.endsWith('.app'));
}

/**
 * Check that `p` is exactly the kind of thing `item` claims to be, right now.
 * Returns { why, st }: why is null when OK, 'gone' when it no longer exists, or a reason.
 */
async function check(item, p, protectedPaths) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return { why: 'Path is not absolute' };
  const n = path.resolve(p);
  if (n !== p.replace(/\/+$/, '')) return { why: 'Path is not normalized' };
  if (item.action === 'empty-trash') {
    if (n !== TRASH) return { why: 'Unexpected Trash path' };
  } else {
    if (!isInside(n, HOME)) return { why: 'Outside your home folder' };
    if (protectedPaths.has(n)) return { why: 'Protected folder' };
  }
  let st;
  try { st = await fsp.lstat(n); } catch { return { why: 'gone' }; }
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
      case 'build': {
        if (inToolArea(n)) return 'Inside an app, Library or hidden tool folder';
        if (!BUILD_DIRS[base]) return 'Not a build cache folder';
        if (!fs.existsSync(path.join(parent, 'package.json'))) return 'No package.json next to it';
        if (base === 'coverage') {
          const inside = new Set((await readdirSafe(n)).map((e) => e.name));
          if (!COVERAGE_FILES.some((f) => inside.has(f))) return 'Does not look like a coverage report';
        }
        return await projectFolderStillDisposable(parent, base, n, protectedPaths);
      }
      case 'deps':
        if (inToolArea(n)) return 'Inside an app, Library or hidden tool folder';
        if (base !== 'node_modules') return 'Not a node_modules folder';
        if (!fs.existsSync(path.join(parent, 'package.json'))) return 'No package.json next to it';
        return await projectFolderStillDisposable(parent, base, n, protectedPaths);
      case 'leftovers': {
        if (inToolArea(n)) return 'Inside an app, Library or hidden tool folder';
        if (item.group === 'duplicate') {
          return item.action === 'trash' && / copy(?: \d+)?$/.test(base) ? null : 'Not a duplicate copy folder';
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
          return (parent === dc || n === path.join(dc, 'huggingface', 'hub')) ? null : 'Not a ~/.cache tool folder';
        }
        if (item.key === 'pnpm-prune') return null;
        const known = DEV_CACHES.find((c) => c.key === item.key);
        if (!known) return 'Unknown developer cache';
        return path.resolve(expandHome(known.path)) === n ? null : 'Developer cache path changed';
      }
      case 'apps':
        if (n === path.join(HOME, 'Library', 'Logs')) return null;
        return parent === CACHES ? null : 'Not an app cache folder';
      case 'files':
        if (item.action === 'empty-trash') return null;
        return parent === DOWNLOADS && item.action === 'trash' ? null : 'Not in Downloads';
      default:
        return 'Unknown category';
    }
  })();
  return { why, st };
}

/** Same checks the scan made, repeated right before cleaning: not tracked by git, no git repository inside. */
async function projectFolderStillDisposable(parent, base, n, protectedPaths) {
  const root = [...protectedPaths].filter((r) => isInside(n, r) && r !== HOME && r !== '/').sort((a, b) => b.length - a.length)[0] || parent;
  if ((await trackedState(parent, base, root)) !== 'untracked') return 'Git tracks it, or git could not check it';
  const nested = await findNestedGit(n);
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
    const now = await fsp.lstat(p);
    if (now.isSymbolicLink() || now.dev !== st.dev || now.ino !== st.ino) return false;
    return (await fsp.realpath(p)) === p;
  } catch { return false; }
}

const friendly = (err) => (['EPERM', 'EACCES', 'ENOTDIR', 'ENOTEMPTY'].includes(err.code)
  ? `macOS did not allow removing some files (${err.code}).`
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

/**
 * Clean the given items (already chosen by the user from the latest scan).
 * deps: { trash(path) -> Promise, projectRoots }
 */
async function clean(items, deps, onProgress) {
  const protectedPaths = protectedSet(deps.projectRoots);
  const before = await diskInfo(HOME);
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
          case 'empty':
          case 'empty-trash': {
            const r = await emptyDir(p, st);
            if (r.failed) {
              partial = it.action === 'empty-trash' && r.failed === r.total
                ? 'macOS did not allow emptying the Trash. Give Clearspace Full Disk Access in Settings.'
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
  const after = await diskInfo(HOME);
  return {
    results,
    before,
    after,
    freed: before && after ? Math.max(0, after.free - before.free) : null,
    estimated: items.filter((it) => results.find((r) => r.id === it.id && r.status === 'done')).reduce((a, it) => a + (it.size || 0), 0),
    finishedAt: Date.now(),
  };
}

module.exports = { clean, verify, check, protectedSet, stillSame };
