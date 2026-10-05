'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');

const HOME = os.homedir();

/** Run a command, resolve { code, stdout, stderr }. Never throws. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let done = false;
    let child;
    try {
      child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env, ...(opts.env || {}) },
        stdio: ['ignore', 'pipe', 'pipe'],
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

/** Size on disk in bytes using `du -sk` (native, fast on APFS). Returns null when unknown. */
async function diskUsage(p, timeout = 180000) {
  const r = await run('du', ['-sk', p], { timeout });
  // du exits 1 when some subfolders are unreadable but still prints a total.
  const m = /^(\d+)\s/.exec(r.stdout);
  if (!m) return null;
  return Number(m[1]) * 1024;
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
  return p.startsWith(HOME) ? '~' + p.slice(HOME.length) : p;
}

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return HOME;
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
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

/** Newest modification time (ms) of files in a project, ignoring generated folders. Shallow + bounded. */
const IGNORE_FOR_ACTIVITY = new Set([
  'node_modules', '.git', '.next', '.turbo', '.nuxt', '.svelte-kit', '.parcel-cache',
  '.vite', '.cache', 'dist', 'build', 'out', 'coverage', '.vercel', '.expo', '.claude', '.DS_Store',
]);
async function lastActivity(dir, maxDepth = 3, budget = { n: 4000 }) {
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
  return newest || null;
}

module.exports = {
  HOME, run, git, findNestedGit, trackedState, diskUsage, pool, exists, isRealDir, readdirSafe, tilde, expandHome, diskInfo, lastActivity,
};
