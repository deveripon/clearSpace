'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { HOME, IS_WIN, within, diskName } = require('./platform');

// On Windows, package managers installed with npm are .cmd scripts, which only a shell can start.
const WIN_SHIMS = /^(pnpm|npm|npx|yarn)$/;

/** Run a command, resolve { code, stdout, stderr }. Never throws. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let child;
    // Only fixed commands with fixed arguments (pnpm store prune) go through the shell: nothing a user typed reaches it.
    const viaShell = IS_WIN && WIN_SHIMS.test(cmd) && args.every((a) => /^[\w.-]+$/.test(a));
    try {
      child = spawn(viaShell ? [cmd, ...args].join(' ') : cmd, viaShell ? [] : args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        shell: viaShell,
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: String(e) });
      return;
    }
    const timer = opts.timeout
      ? setTimeout(() => {
          if (!done) {
            try { child.kill('SIGKILL'); } catch (_) {}
          }
        }, opts.timeout)
      : null;
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(e) });
    });
    child.on('close', (code, signal) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve({ code: signal ? -1 : code, stdout, stderr, timedOut: signal === 'SIGKILL' });
    });
  });
}

/**
 * Run git safely: no optional locks (never writes .git/index.lock), no prompts,
 * and no repo-configured programs (fsmonitor, hooks) can run.
 * Resolves stdout, or null on any failure.
 */
const GIT_SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
async function git(cwd, args, timeout = 60000) {
  const r = await run('git', [...GIT_SAFE, '-C', cwd, ...args], {
    timeout, env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  return r.code === 0 ? r.stdout : null;
}

/**
 * Look for a git repository inside `dir` (someone's own work, e.g. a cloned package).
 * node_modules: every package folder (including @scope/*) is checked directly.
 * Other folders: breadth-first up to 4 levels. Returns a path, null, or 'TOO_BIG' when the search could not finish.
 */
async function findNestedGit(dir) {
  const fsp2 = require('fs').promises;
  const has = async (p) => { try { await fsp2.lstat(path.join(p, '.git')); return true; } catch { return false; } };
  if (await has(dir)) return path.join(dir, '.git');
  if (path.basename(dir) === 'node_modules') {
    // Every package folder (and @scope/*), plus packages nested one node_modules level deeper.
    const packagesIn = async (nm) => {
      const out = [];
      for (const e of await readdirSafe(nm)) {
        if (!e.isDirectory() || e.isSymbolicLink() || ['.bin', '.pnpm', '.cache'].includes(e.name)) continue;
        const p = path.join(nm, e.name);
        if (e.name.startsWith('@')) {
          for (const s of await readdirSafe(p)) if (s.isDirectory() && !s.isSymbolicLink()) out.push(path.join(p, s.name));
        } else out.push(p);
      }
      return out;
    };
    for (const pkg of await packagesIn(dir)) {
      if (await has(pkg)) return path.join(pkg, '.git');
      for (const inner of await packagesIn(path.join(pkg, 'node_modules'))) {
        if (await has(inner)) return path.join(inner, '.git');
      }
    }
    return null;
  }
  let budget = 100000;
  let level = [dir];
  for (let depth = 1; depth <= 6 && level.length; depth++) {
    const next = [];
    for (const d of level) {
      for (const e of await readdirSafe(d)) {
        if (--budget <= 0) return 'TOO_BIG';
        if (e.name === '.git') return path.join(d, e.name);
        if (e.isDirectory() && !e.isSymbolicLink()) next.push(path.join(d, e.name));
      }
    }
    level = next;
  }
  return null;
}

/**
 * Whether git tracks anything at `name` inside `parent`: 'tracked' | 'untracked' | 'unknown'.
 * Fails closed: any git problem gives 'unknown', and so does a .git entry anywhere between
 * `parent` and `stopAt` that git cannot read (a broken or moved repository).
 */
async function trackedState(parent, name, stopAt) {
  const r = await run('git', [...GIT_SAFE, '-C', parent, 'rev-parse', '--is-inside-work-tree'], {
    timeout: 15000, env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  if (r.code !== 0) {
    if (!/not a git repository/i.test(r.stderr)) return 'unknown';
    let d = parent;
    while (true) {
      try { await fsp.lstat(path.join(d, '.git')); return 'unknown'; } catch {}
      if (!stopAt || d === stopAt || d === path.dirname(d) || !d.startsWith(stopAt)) break;
      d = path.dirname(d);
    }
    return 'untracked';
  }
  const out = r.stdout.trim();
  if (out === 'false') return 'unknown';
  if (out !== 'true') return 'unknown';
  const ls = await git(parent, ['ls-files', '--', name]);
  if (ls === null) return 'unknown';
  return ls.trim() ? 'tracked' : 'untracked';
}

/** Size on disk in bytes: `du -sk` on macOS (native, fast on APFS), a file walk on Windows. Returns null when unknown. */
async function diskUsage(p, timeout = 180000) {
  if (IS_WIN) return walkSize(p, timeout);
  const r = await run('du', ['-sk', p], { timeout });
  // du exits 1 when some subfolders are unreadable but still prints a total.
  const m = /^(\d+)\s/.exec(r.stdout);
  if (!m) return null;
  return Number(m[1]) * 1024;
}

/**
 * Total size of the files under `p` (Windows has no du). Never follows links or junctions, counts hard-linked
 * files once (pnpm links packages from its store), skips what it cannot read. Null when it cannot finish in time.
 */
async function walkSize(p, timeout) {
  const deadline = Date.now() + timeout;
  let st;
  try { st = await fsp.lstat(p, { bigint: true }); } catch { return null; }
  if (st.isSymbolicLink()) return 0;
  if (!st.isDirectory()) return Number(st.size);
  let total = 0n;
  const seen = new Set();
  const queue = [p];
  let active = 0;
  let late = false;
  await new Promise((resolve) => {
    const pump = () => {
      if (late) return;
      if (Date.now() > deadline) { late = true; resolve(); return; }
      if (!queue.length && !active) { resolve(); return; }
      while (active < 16 && queue.length) {
        const dir = queue.pop();
        active++;
        (async () => {
          const files = [];
          for (const e of await readdirSafe(dir)) {
            const full = path.join(dir, e.name);
            if (e.isDirectory() && !e.isSymbolicLink()) queue.push(full);
            else if (e.isFile()) files.push(full);
          }
          await Promise.all(files.map(async (f) => {
            try {
              const s = await fsp.lstat(f, { bigint: true });
              if (s.nlink > 1n) {
                const id = `${s.dev}:${s.ino}`;
                if (seen.has(id)) return;
                seen.add(id);
              }
              total += s.size;
            } catch {}
          }));
        })().finally(() => { active--; pump(); });
      }
    };
    pump();
  });
  return late ? null : Number(total);
}

/** Run async fn over items with limited concurrency. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

async function isRealDir(p) {
  try {
    const st = await fsp.lstat(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch { return false; }
}

async function readdirSafe(p) {
  try { return await fsp.readdir(p, { withFileTypes: true }); } catch { return []; }
}

function tilde(p) {
  return within(p, HOME) ? '~' + p.slice(HOME.length) : p;
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/') || (IS_WIN && p.startsWith('~\\'))) return path.join(HOME, p.slice(2));
  return p;
}

/** Disk totals for the volume holding `p`. */
async function diskInfo(p = HOME) {
  try {
    const s = await fsp.statfs(p);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    return { total, free, used: total - free };
  } catch {
    return null;
  }
}

/**
 * Totals for home's disk, then (Windows) every other drive that holds a project folder, each with its `root`
 * and a `name` to show. The first entry carries the whole list as `all`.
 */
async function disksInfo(projectRoots = []) {
  const roots = [path.parse(HOME).root.toUpperCase()];
  if (IS_WIN) {
    for (const r of projectRoots) {
      const root = path.parse(path.resolve(expandHome(r))).root.toUpperCase();
      if (!roots.includes(root)) roots.push(root);
    }
  }
  const all = [];
  for (const [k, root] of roots.entries()) {
    const d = await diskInfo(k === 0 ? HOME : root);
    if (d) all.push({ ...d, root: IS_WIN ? root : null, name: diskName(k === 0 ? HOME : root) });
  }
  return all.length ? { ...all[0], all } : null;
}

/** Newest modification time (ms) of files in a project, ignoring generated folders. Shallow + bounded. */
const IGNORE_FOR_ACTIVITY = new Set([
  'node_modules', '.git', '.next', '.turbo', '.nuxt', '.svelte-kit', '.parcel-cache',
  '.vite', '.cache', 'dist', 'build', 'out', 'coverage', '.vercel', '.expo', '.claude', '.DS_Store', 'Thumbs.db', 'desktop.ini',
  // output and installed packages of other stacks: tools write here, people do not
  'target', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'Pods', 'vendor',
  '.gradle', '.build', '.dart_tool', '_build', 'deps', 'cmake-build-debug', 'cmake-build-release', '.zig-cache', 'zig-cache',
]);
async function lastActivity(dir, maxDepth = 7, budget = { n: 8000 }) {
  let newest = 0;
  async function walk(d, depth) {
    if (budget.n <= 0) return;
    const entries = await readdirSafe(d);
    for (const e of entries) {
      if (budget.n-- <= 0) return;
      if (IGNORE_FOR_ACTIVITY.has(e.name)) continue;
      const full = path.join(d, e.name);
      if (e.isFile()) {
        try {
          const st = await fsp.lstat(full);
          if (st.mtimeMs > newest) newest = st.mtimeMs;
        } catch {}
      } else if (e.isDirectory() && depth < maxDepth) {
        await walk(full, depth + 1);
      }
    }
  }
  await walk(dir, 0);
  // Latest git commit counts as activity too.
  const out = await git(dir, ['log', '-1', '--format=%ct'], 8000);
  const ct = Number((out || '').trim()) * 1000;
  if (ct > newest) newest = ct;
  // So do uncommitted changes anywhere in the project, however deep (src/main/java/...).
  const top = await git(dir, ['rev-parse', '--show-toplevel'], 8000);
  // Limited to this folder (pathspec "."), so changes elsewhere in a big repository cannot crowd it out.
  const st = top ? await git(dir, ['status', '--porcelain', '-z', '--untracked-files=all', '--', '.'], 15000) : null;
  if (top && st) {
    const root = top.trim();
    // -z: "XY path\0", and renames/copies add the old path as the next field. Paths are exact (no quoting).
    const tok = st.split('\0');
    const rels = [];
    for (let i = 0; i < tok.length && rels.length < 400; i++) {
      const t = tok[i];
      if (t.length < 4) continue;
      rels.push(t.slice(3));
      if (t[0] === 'R' || t[0] === 'C') i++; // skip the old name
    }
    const changed = rels.map((rel) => path.join(root, rel)).filter((p) => within(p, dir));
    for (const p of changed) {
      try { const m = (await fsp.lstat(p)).mtimeMs; if (m > newest) newest = m; } catch {}
    }
  }
  return newest || null;
}

module.exports = {
  HOME, run, walkSize, git, findNestedGit, trackedState, diskUsage, pool, exists, isRealDir, readdirSafe, tilde, expandHome, diskInfo, disksInfo, lastActivity,
};
