'use strict';
/**
 * Decide whether a folder under .claude/worktrees (or similar) is safe to remove.
 * Used both when scanning and again right before cleaning.
 *
 * kind:
 *   'linked'  – a real git worktree registered to this exact folder (compared by inode, not by path string)
 *   'copy'    – a Finder copy of a worktree: its .git file points at a worktree that exists somewhere else
 *   'unknown' – anything else (full clone, broken link, no .git). Always locked.
 */
const path = require('path');
const fsp = require('fs').promises;
const crypto = require('crypto');
const { git, findNestedGit } = require('./util');
const DAY = 86400000;
// Folders that only ever hold tool output.
const GENERATED = new Set(['node_modules', '.next', '.turbo', '.nuxt', '.svelte-kit', '.parcel-cache', '.vite',
  '.vercel', '.expo', '.angular', '__pycache__', '.pytest_cache', 'playwright-report', 'test-results']);
// Usually tool output, but a person could put files there: allowed, but the item becomes "Check first" and names them.
const PROBABLY_GENERATED = new Set(['dist', 'build', 'out', 'coverage', '.cache', 'tmp']);
const GENERATED_FILE = /(\.tsbuildinfo|^\.DS_Store|^next-env\.d\.ts|\.log)$/;

async function sameFile(a, b) {
  try {
    const [x, y] = await Promise.all([fsp.stat(a), fsp.stat(b)]);
    return x.dev === y.dev && x.ino === y.ino;
  } catch { return false; }
}

async function fileHash(p) {
  try {
    const st = await fsp.lstat(p);
    if (!st.isFile() || st.size > 50 * 1024 * 1024) return null;
    return crypto.createHash('sha1').update(await fsp.readFile(p)).digest('hex');
  } catch { return null; }
}

function unquote(p) {
  if (p.startsWith('"') && p.endsWith('"')) {
    try { return JSON.parse(p); } catch { return p.slice(1, -1); }
  }
  return p;
}

const unknown = (reason) => ({ kind: 'unknown', locked: true, reason });

async function assessWorktree(dir) {
  const dotgit = path.join(dir, '.git');
  let st;
  try { st = await fsp.lstat(dotgit); } catch { return unknown('There is no .git file, so Clearspace cannot tell what this folder is.'); }
  if (st.isDirectory()) return unknown('This is a full git repository, not a worktree. Clearspace will not remove it.');
  if (!st.isFile()) return unknown('Unexpected .git entry.');
  let gitdir;
  try {
    const m = /^gitdir:\s*(.+?)\s*$/m.exec(await fsp.readFile(dotgit, 'utf8'));
    if (!m) return unknown('The .git file is not a worktree link.');
    gitdir = path.resolve(dir, m[1]);
  } catch { return unknown('Could not read the .git file.'); }

  let back;
  try {
    const raw = (await fsp.readFile(path.join(gitdir, 'gitdir'), 'utf8')).trim();
    back = path.resolve(gitdir, raw); // relative back-pointers are relative to the admin folder
  } catch {
    return unknown('Git has no record of this worktree.');
  }

  if (!(await sameFile(back, dotgit))) {
    try { await fsp.access(back); } catch { return unknown('Git points to a worktree folder that no longer exists.'); }
    return { kind: 'copy', locked: false, registeredAt: path.dirname(back) };
  }

  // ---- a real, linked worktree
  const res = { kind: 'linked', locked: false, reason: null, gitdir };
  res.branch = ((await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])) || '').trim() || 'unknown';
  // `git worktree lock` means someone wants it kept.
  try {
    const why = (await fsp.readFile(path.join(gitdir, 'locked'), 'utf8')).trim();
    return { ...res, locked: true, reason: `Locked with git worktree lock${why ? ` (${why})` : ''}. Unlock it first if you want it removed.` };
  } catch {}
  // Recent activity: an agent may be working in it right now.
  let active = 0;
  for (const f of ['index', 'HEAD', path.join('logs', 'HEAD')]) {
    try { active = Math.max(active, (await fsp.stat(path.join(gitdir, f))).mtimeMs); } catch {}
  }
  res.lastActivity = active || null;
  res.recentlyActive = Boolean(active && Date.now() - active < DAY);
  const common = ((await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) || '').trim();
  res.mainRepo = common ? (path.basename(common) === '.git' ? path.dirname(common) : common) : null;

  // 1. modified + untracked (explicit flag beats any status.showUntrackedFiles config)
  const status = await git(dir, ['status', '--porcelain', '--untracked-files=all']);
  if (status === null) return { ...res, locked: true, reason: 'Git could not read this worktree.' };
  res.dirty = status.split('\n').filter(Boolean).length;

  // 2. ignored files that are not build output (.env and friends)
  // -z: paths come back exactly as stored (no quoting of special or non-English characters).
  const ign = await git(dir, ['status', '-z', '--porcelain', '--ignored=matching', '--untracked-files=normal']);
  if (ign === null) return { ...res, locked: true, reason: 'Git could not read this worktree.' };
  const ignored = ign.split('\0').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3).replace(/\/$/, ''));
  const mainList = await git(res.mainRepo || dir, ['worktree', 'list', '--porcelain']);
  const mainWorktree = mainList ? ((/^worktree (.+)$/m.exec(mainList) || [])[1] || null) : null;
  const risky = [];
  const probable = [];
  for (const rel of ignored) {
    const segs = rel.split('/');
    if (segs.some((s) => GENERATED.has(s)) || GENERATED_FILE.test(segs[segs.length - 1])) continue;
    if (segs.some((s) => PROBABLY_GENERATED.has(s))) { probable.push(rel + '/'); continue; }
    // A file identical to the one in the main project is not unique work.
    if (mainWorktree) {
      const [a, b] = await Promise.all([fileHash(path.join(dir, rel)), fileHash(path.join(mainWorktree, rel))]);
      if (a && a === b) continue;
    }
    risky.push(rel);
  }
  res.risky = risky;
  res.probable = probable;

  // 2a. a git repository hidden inside ignored folders (e.g. a cloned package in node_modules or .next)
  for (const rel of ignored) {
    const full = path.join(dir, rel);
    let st;
    try { st = await fsp.lstat(full); } catch { return { ...res, locked: true, reason: `Could not read ${rel}. Clearspace will not remove this worktree.` }; }
    if (!st.isDirectory()) continue;
    const hit = await findNestedGit(full);
    if (hit === 'TOO_BIG') return { ...res, locked: true, reason: `${rel}/ is too large to check for git repositories inside it.` };
    if (hit) return { ...res, locked: true, reason: `Contains a git repository (${path.relative(dir, hit)}) that may hold your own work.` };
  }

  // 2b. tracked files hidden from status (skip-worktree / assume-unchanged) often hold local secrets
  const lsv = await git(dir, ['ls-files', '-v']);
  if (lsv === null) return { ...res, locked: true, reason: 'Git could not read this worktree.' };
  const hidden = lsv.split('\n').filter((l) => /^(S|[a-z]) /.test(l)).map((l) => unquote(l.slice(2)));

  // 3. commits on no branch (detached HEAD) would become unreachable
  const orphan = await git(dir, ['rev-list', '--count', 'HEAD', '--not', '--branches', '--remotes']);
  const unpushed = await git(dir, ['rev-list', '--count', 'HEAD', '--not', '--remotes']);
  if (orphan === null || unpushed === null) return { ...res, locked: true, reason: 'Git could not check this worktree\'s commits.' };
  res.orphanCommits = Number(orphan.trim()) || 0;
  res.unpushed = Number(unpushed.trim()) || 0;
  res.lastCommit = Number(((await git(dir, ['log', '-1', '--format=%ct'])) || '0').trim()) * 1000 || null;

  // 4. commits only this worktree knows about: its HEAD history (reflog) and per-worktree refs.
  //    They are not lost: they are saved as refs in the main repo before removal (see backupHistory).
  const orphans = await historyOrphans(dir);
  if (orphans === null) return { ...res, locked: true, reason: 'Git could not check this worktree\'s history.' };
  res.historyOrphans = orphans;

  if (res.dirty > 0) {
    res.locked = true;
    res.reason = `Has ${res.dirty} uncommitted change${res.dirty === 1 ? '' : 's'}. Commit or discard them first.`;
  } else if (risky.length) {
    res.locked = true;
    const shown = risky.slice(0, 3).join(', ') + (risky.length > 3 ? ` and ${risky.length - 3} more` : '');
    res.reason = `Has files git ignores that are not in your main project (${shown}). Move them first.`;
  } else if (hidden.length) {
    res.locked = true;
    res.reason = `Has tracked files git was told to ignore changes in (${hidden.slice(0, 3).join(', ')}). They may hold local settings.`;
  } else if (res.orphanCommits > 0) {
    res.locked = true;
    res.reason = `Its ${res.orphanCommits} commit${res.orphanCommits === 1 ? ' is' : 's are'} on no branch and would be lost. Create a branch first.`;
  }
  return res;
}

/** Commits in this worktree's own HEAD history or refs/worktree, refs/bisect that no branch, tag or remote contains. */
async function historyOrphans(dir) {
  const hasLog = await git(dir, ['rev-parse', '--git-path', 'logs/HEAD']);
  if (hasLog === null) return null;
  let reflog = '';
  try { await fsp.access(path.resolve(dir, hasLog.trim())); reflog = await git(dir, ['reflog', 'show', '--format=%H', 'HEAD']); } catch { reflog = ''; }
  const refs = await git(dir, ['for-each-ref', '--format=%(objectname)', 'refs/worktree', 'refs/bisect']);
  if (refs === null || reflog === null) return null;
  const tips = [...new Set(`${reflog || ''}\n${refs}`.split('\n').map((x) => x.trim()).filter((x) => /^[0-9a-f]{40,64}$/.test(x)))];
  if (!tips.length) return [];
  // Every commit reachable from the tips but from no branch, tag or remote.
  const r = await git(dir, ['rev-list', ...tips, '--not', '--branches', '--tags', '--remotes'], 120000);
  if (r === null) return null;
  const unreachable = new Set(r.split('\n').filter(Boolean));
  // Protecting the tips that are unreachable protects everything behind them too.
  return tips.filter((t) => unreachable.has(t));
}

/** Save orphan commits as refs in the main repo so removing the worktree cannot make them unreachable. */
async function backupHistory(a, name) {
  if (!a.historyOrphans || !a.historyOrphans.length) return 0;
  // Ref names may not contain dots in risky places (".lock", ".."): keep letters, digits, - and _ only.
  const safeName = name.replace(/[^A-Za-z0-9_-]/g, '_') || 'worktree';
  for (const sha of a.historyOrphans) {
    const ref = `refs/clearspace-backup/${safeName}/${sha.slice(0, 12)}`;
    if ((await git(a.mainRepo, ['update-ref', ref, sha])) === null) throw new Error('Could not save this worktree\'s history. Nothing was removed.');
    const check = await git(a.mainRepo, ['rev-parse', '--verify', '--quiet', ref]);
    if (!check || check.trim() !== sha) throw new Error('Could not confirm the history backup. Nothing was removed.');
  }
  return a.historyOrphans.length;
}

module.exports = { assessWorktree, backupHistory, sameFile };
