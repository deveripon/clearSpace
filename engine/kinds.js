'use strict';
/**
 * Checks for project folders (build output and installed dependencies) that scan and clean share,
 * so a folder is judged the same way when it is listed and again right before it is removed.
 */
const path = require('path');
const fsp = require('fs').promises;
const { readdirSafe, git } = require('./util');

/** True when the folder holds what this kind of tool output always contains. */
async function insideOk(spec, dir) {
  if (spec.inside) {
    let ok = false;
    for (const rel of spec.inside) {
      try { await fsp.lstat(path.join(dir, rel)); ok = true; break; } catch {}
    }
    if (!ok) return false;
  }
  if (spec.insideAnyChild) {
    let ok = false;
    for (const e of await readdirSafe(dir)) {
      if (!e.isDirectory() || e.isSymbolicLink()) continue;
      try { await fsp.lstat(path.join(dir, e.name, spec.insideAnyChild)); ok = true; break; } catch {}
    }
    if (!ok) return false;
  }
  return true;
}

/**
 * A git repository inside the folder is someone's work, not output. Returns a path, null, or 'TOO_BIG'.
 * `nestedGitOkUnder`: child folders where the tool itself keeps clones (Swift package checkouts).
 * `nestedGitDepth`: how deep to look (default 6).
 */
async function nestedGit(spec, dir, { findNestedGit }) {
  if (!spec.nestedGitOkUnder && !spec.nestedGitDepth) return findNestedGit(dir);
  const skip = new Set(spec.nestedGitOkUnder || []);
  const maxDepth = spec.nestedGitDepth || 6;
  let budget = 100000;
  try { await fsp.lstat(path.join(dir, '.git')); return path.join(dir, '.git'); } catch {}
  let level = [dir];
  for (let depth = 1; depth <= maxDepth && level.length; depth++) {
    const next = [];
    for (const d of level) {
      for (const e of await readdirSafe(d)) {
        if (--budget <= 0) return 'TOO_BIG';
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        if (depth === 1 && skip.has(e.name)) continue;
        const p = path.join(d, e.name);
        if (e.name === '.git') return p;
        try { await fsp.lstat(path.join(p, '.git')); return path.join(p, '.git'); } catch {}
        next.push(p);
      }
    }
    level = next;
  }
  return null;
}

/** For folder names that people also use for their own files: only "safe" when git ignores the folder. */
async function ignoredByGit(parent, name) {
  const inside = await git(parent, ['rev-parse', '--is-inside-work-tree'], 15000);
  if (!inside || inside.trim() !== 'true') return false;
  return (await git(parent, ['check-ignore', '-q', '--', name], 15000)) !== null;
}

// ---------------------------------------------------------------- what the package manager says it installed
const readText = async (p) => { try { return await fsp.readFile(p, 'utf8'); } catch { return null; } };
const dirNames = async (d) => (await readdirSafe(d)).filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name);

const VENV_TOP = new Set(['bin', 'lib', 'lib64', 'include', 'share', 'pyvenv.cfg', 'Lib', 'Scripts', '.gitignore', 'CACHEDIR.TAG', '.lock', 'etc', 'man', 'src', '.DS_Store']);
const PODS_OWN = new Set(['Pods.xcodeproj', 'Target Support Files', 'Headers', 'Local Podspecs', 'Manifest.lock']);
const files = async (d) => (await readdirSafe(d)).filter((e) => !e.isDirectory()).map((e) => e.name);

/**
 * Compare a dependencies folder with the package manager's own record.
 * Returns { lock, check }: `lock` = reason to refuse (something in it was not installed by the tool),
 * `check` = reason to ask the user to look first.
 */
async function contents(spec, dir) {
  const parent = path.dirname(dir);
  switch (spec.id) {
    case 'composer': {
      const raw = await readText(path.join(dir, 'composer', 'installed.json'));
      let pkgs = null;
      try { const j = JSON.parse(raw); pkgs = (Array.isArray(j) ? j : j.packages || []).map((p) => String(p.name || '').toLowerCase()); } catch {}
      if (!pkgs) return { lock: null, check: 'Composer\'s list of installed packages (vendor/composer/installed.json) is missing, so Clearspace cannot confirm everything in vendor came from Composer.' };
      const known = new Set(pkgs);
      const own = (await files(dir)).find((f) => f !== 'autoload.php' && f !== '.DS_Store');
      if (own) return { lock: `vendor/${own} is not something Composer installed. It may be your own file, so Clearspace will not remove this folder.`, check: null };
      // vendor/bin holds links or small proxy scripts that point into an installed package.
      for (const b of await readdirSafe(path.join(dir, 'bin'))) {
        if (b.isSymbolicLink() || b.name === '.DS_Store') continue;
        const txt = (await readText(path.join(dir, 'bin', b.name))) || '';
        if (b.isDirectory() || !pkgs.some((pk) => txt.slice(0, 4096).toLowerCase().includes(pk))) {
          return { lock: `vendor/bin/${b.name} does not point to a package Composer installed. It may be your own script, so Clearspace will not remove this folder.`, check: null };
        }
      }
      for (const v of await dirNames(dir)) {
        if (v === 'composer' || v === 'bin') continue;
        const loose = (await files(path.join(dir, v))).find((f) => f !== '.DS_Store');
        if (loose) return { lock: `vendor/${v}/${loose} is not part of a package Composer installed. It may be your own file, so Clearspace will not remove this folder.`, check: null };
        const subs = await dirNames(path.join(dir, v));
        const extra = subs.find((s) => !known.has(`${v}/${s}`.toLowerCase())) || (subs.length ? null : v);
        if (extra) return { lock: `vendor/${extra === v ? v : `${v}/${extra}`} is not a package Composer installed. It may be your own code, so Clearspace will not remove this folder.`, check: null };
      }
      return { lock: null, check: null };
    }
    case 'pods': {
      const raw = await readText(path.join(dir, 'Manifest.lock'));
      if (!raw) return { lock: null, check: 'CocoaPods\' list of installed pods (Pods/Manifest.lock) is missing.' };
      const sect = (raw.split(/\n(?=[A-Z][A-Z ]+:)/).find((s) => s.startsWith('PODS:')) || '');
      const names = new Set([...sect.matchAll(/^\s*- "?([^\s/"(]+)/gm)].map((m) => m[1]));
      for (const e of await readdirSafe(dir)) {
        if (PODS_OWN.has(e.name) || e.name.startsWith('.')) continue; // CocoaPods keeps its own hidden caches here
        if (!e.isDirectory() || !names.has(e.name)) return { lock: `Pods/${e.name} is not a pod CocoaPods installed. It may be your own code, so Clearspace will not remove this folder.`, check: null };
      }
      return { lock: null, check: null };
    }
    case 'mix-deps': {
      const raw = await readText(path.join(parent, 'mix.lock'));
      if (!raw) return { lock: 'There is no mix.lock, so Clearspace cannot confirm these folders came from Mix.', check: null };
      const names = new Set([...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]));
      for (const e of await readdirSafe(dir)) {
        if (e.name === '.DS_Store') continue;
        if (!e.isDirectory() || !names.has(e.name)) return { lock: `deps/${e.name} is not listed in mix.lock. It may be your own code, so Clearspace will not remove this folder.`, check: null };
      }
      return { lock: null, check: null };
    }
    case 'venv':
    case 'venv-plain': {
      const extra = (await readdirSafe(dir)).map((e) => e.name).find((n) => !VENV_TOP.has(n));
      if (extra) return { lock: null, check: `${spec.name}/${extra} is not part of a normal virtual environment. Look at it before cleaning.` };
      // src/ holds editable installs cloned by pip; anything else there is someone's own code.
      for (const e of await readdirSafe(path.join(dir, 'src'))) {
        let isRepo = false;
        try { await fsp.lstat(path.join(dir, 'src', e.name, '.git')); isRepo = true; } catch {}
        if (!isRepo) return { lock: null, check: `${spec.name}/src/${e.name} is not a package pip cloned. Look at it before cleaning.` };
      }
      return { lock: null, check: null };
    }
    default:
      return { lock: null, check: null };
  }
}

/**
 * Files changed after the package manager last installed into this folder are hand edits (a patched package,
 * a debugging print). Returns { changed: relative path | null, unknown: true when there were too many files to check }.
 */
/**
 * Python: every file a package installed is listed with its size in that package's own RECORD.
 * A file whose size differs, or that is newer than its own RECORD, was edited by hand; a top-level entry
 * that no RECORD claims was put there by hand. Checks each package against itself, so a later install
 * of another package cannot hide an older edit.
 */
// Exactly the files that venv, virtualenv and uv create in bin/ (Scripts/ on Windows layouts).
const VENV_BIN_OWN = /^(activate|activate\.(bat|csh|fish|nu|ps1|xsh)|Activate\.ps1|activate_this\.py|deactivate|deactivate\.(bat|nu)|pydoc\.bat|python|python3|python3\.\d+|pythonw|python\.exe|pythonw\.exe)$/;
const pkgName = (n) => n.toLowerCase().replace(/[-_.]+/g, '-');
const SEEDED = new Set(['pip', 'setuptools', 'wheel', 'distribute']);

/** Package names a lockfile pins (uv.lock, poetry.lock, Pipfile.lock), or null when there is no such lockfile. */
async function lockedPackages(projectDir) {
  for (const f of ['uv.lock', 'poetry.lock', 'Pipfile.lock']) {
    const t = await readText(path.join(projectDir, f));
    if (t === null) continue;
    const names = new Set();
    for (const m of t.matchAll(/^\s*name\s*=\s*"([^"]+)"/gm)) names.add(pkgName(m[1]));
    for (const m of t.matchAll(/"([A-Za-z0-9][A-Za-z0-9._-]*)"\s*:\s*\{/g)) names.add(pkgName(m[1]));
    // The project itself (Poetry and uv install it into the venv; poetry.lock does not list it).
    const pp = await readText(path.join(projectDir, 'pyproject.toml'));
    const own = pp && /^\s*name\s*=\s*"([^"]+)"/m.exec(pp);
    return { names, text: t, self: own ? pkgName(own[1]) : null };
  }
  return null;
}

async function venvEdits(dir) {
  let budget = 120000;
  const project = path.dirname(dir);
  const lock = await lockedPackages(project);
  const listedOutside = new Set(); // files RECORD lists outside site-packages (scripts in bin/, headers in include/, data in share/)
  for (const lib of ['lib', 'lib64']) {
    for (const py of await dirNames(path.join(dir, lib))) {
      const sp = path.join(dir, lib, py, 'site-packages');
      const claimed = new Set(['__pycache__', '.DS_Store', '_virtualenv.py', '_virtualenv.pth', 'distutils-precedence.pth', 'README.txt']);
      const infos = (await dirNames(sp)).filter((d) => d.endsWith('.dist-info'));
      const listed = new Set();
      for (const info of infos) {
        claimed.add(info);
        // Installed by hand? Not pinned by the lockfile, or installed from a local folder or a git URL the lockfile does not name.
        const name = pkgName(info.replace(/\.dist-info$/, '').split('-')[0]);
        const where = path.relative(project, path.join(sp, info));
        const du = await readText(path.join(sp, info, 'direct_url.json'));
        const isSelf = Boolean(lock && lock.self === name && du && du.includes('file:'));
        if (lock && !SEEDED.has(name) && !lock.names.has(name) && !isSelf) return { changed: where, unknown: false, why: 'not-locked' };
        if (du) {
          let j = null;
          try { j = JSON.parse(du); } catch {}
          const url = j && typeof j.url === 'string' ? j.url : '';
          if (url.startsWith('file:')) {
            let local = '';
            try { local = decodeURIComponent(new URL(url).pathname); } catch {}
            if (!(local === project || local.startsWith(project + '/'))) return { changed: where, unknown: false, why: 'local-source' };
          } else if (j && j.vcs_info && !(lock && lock.text.includes(url.replace(/^git\+/, '')))) {
            return { changed: where, unknown: false, why: 'local-source' };
          }
        }
        const recPath = path.join(sp, info, 'RECORD');
        const rec = await readText(recPath);
        if (rec === null) return { changed: path.relative(path.dirname(dir), path.join(sp, info)), unknown: false };
        let recTime = 0;
        try { recTime = (await fsp.stat(recPath)).mtimeMs; } catch {}
        for (const line of rec.split('\n')) {
          if (!line.trim()) continue;
          const parts = line.split(',');
          const size = parts.pop();
          parts.pop(); // hash
          const rel = parts.join(',').replace(/^"|"$/g, '');
          if (!rel) continue;
          if (rel.startsWith('..')) {
            // Scripts and data a package put outside site-packages (bin/, share/): same size and date checks.
            const abs = path.resolve(sp, rel);
            listedOutside.add(abs);
            let st2 = null;
            try { st2 = await fsp.lstat(abs); } catch {}
            if (st2 && !st2.isSymbolicLink() && ((size && Number(size) !== st2.size) || st2.mtimeMs > recTime + 120000)) {
              return { changed: path.relative(path.dirname(dir), abs), unknown: false };
            }
            continue;
          }
          claimed.add(rel.split('/')[0]);
          listed.add(rel);
          if (rel.endsWith('.pyc') || rel.endsWith('/RECORD')) continue;
          if (--budget <= 0) return { changed: null, unknown: true };
          let st;
          try { st = await fsp.lstat(path.join(sp, rel)); } catch { continue; } // removed files lose nothing
          if ((size && Number(size) !== st.size) || st.mtimeMs > recTime + 120000) {
            return { changed: path.relative(path.dirname(dir), path.join(sp, rel)), unknown: false };
          }
        }
      }
      const unclaimed = (await readdirSafe(sp)).map((e) => e.name).find((n) => !claimed.has(n) && !n.endsWith('.egg-info') && !n.endsWith('.pth'));
      if (unclaimed) return { changed: path.relative(path.dirname(dir), path.join(sp, unclaimed)), unknown: false };
      // Files added by hand inside an installed package: present on disk but in no RECORD.
      let level = [...claimed].filter((n) => !n.endsWith('.dist-info') && n !== '__pycache__').map((n) => path.join(sp, n));
      for (let depth = 0; depth < 12 && level.length; depth++) {
        const next = [];
        for (const d of level) {
          for (const e of await readdirSafe(d)) {
            if (--budget <= 0) return { changed: null, unknown: true };
            if (e.name === '__pycache__' || e.name.endsWith('.pyc') || e.name === '.DS_Store') continue;
            const full = path.join(d, e.name);
            if (e.isDirectory() && !e.isSymbolicLink()) { next.push(full); continue; }
            if (!listed.has(path.relative(sp, full))) return { changed: path.relative(path.dirname(dir), full), unknown: false };
          }
        }
        level = next;
      }
      // Nothing else belongs next to site-packages.
      const besides = (await readdirSafe(path.join(dir, lib, py))).map((e) => e.name).find((n) => n !== 'site-packages' && n !== '.DS_Store');
      if (besides) return { changed: path.relative(path.dirname(dir), path.join(dir, lib, py, besides)), unknown: false };
    }
  }
  // lib/ and lib64/ hold only the pythonX.Y folders.
  for (const lib of ['lib', 'lib64']) {
    for (const e of await readdirSafe(path.join(dir, lib))) {
      if (e.name === '.DS_Store' || (e.isDirectory() && !e.isSymbolicLink() && /^python\d/.test(e.name))) continue;
      return { changed: path.relative(project, path.join(dir, lib, e.name)), unknown: false };
    }
  }
  let created = 0;
  try { created = (await fsp.stat(path.join(dir, 'pyvenv.cfg'))).mtimeMs; } catch {}
  // bin/, share/, include/, etc/, man/: only the environment's own scripts and what some RECORD lists.
  for (const top of ['bin', 'Scripts', 'share', 'include', 'etc', 'man']) {
    let level = [path.join(dir, top)];
    for (let depth = 0; depth < 12 && level.length; depth++) {
      const next = [];
      for (const d of level) {
        for (const e of await readdirSafe(d)) {
          if (--budget <= 0) return { changed: null, unknown: true };
          if (e.name === '.DS_Store' || e.name === '__pycache__') continue;
          const full = path.join(d, e.name);
          if (e.isDirectory() && !e.isSymbolicLink()) { next.push(full); continue; }
          if (listedOutside.has(full)) continue;
          if ((top === 'bin' || top === 'Scripts') && d === path.join(dir, top) && VENV_BIN_OWN.test(e.name)) {
            // Its own scripts are written when the environment is created; a later change is a hand edit (an exported API key...).
            if (e.isSymbolicLink()) continue;
            try { if ((await fsp.lstat(full)).mtimeMs <= created + 120000) continue; } catch { continue; }
          }
          return { changed: path.relative(path.dirname(dir), full), unknown: false };
        }
      }
      level = next;
    }
  }
  return { changed: null, unknown: false };
}

async function changedAfterInstall(spec, dir) {
  if (spec.id === 'venv' || spec.id === 'venv-plain') return venvEdits(dir);
  // When did the tool last write its own record?
  let record = 0;
  const mt = async (p) => { try { return (await fsp.stat(p)).mtimeMs; } catch { return 0; } };
  if (spec.id === 'composer') record = await mt(path.join(dir, 'composer', 'installed.json'));
  else if (spec.id === 'pods') record = await mt(path.join(dir, 'Manifest.lock'));
  else if (spec.id === 'mix-deps') {
    record = await mt(path.join(path.dirname(dir), 'mix.lock'));
    for (const d of await dirNames(dir)) record = Math.max(record, await mt(path.join(dir, d, '.hex')), await mt(path.join(dir, d, '.fetch')));
  } else return { changed: null, unknown: false };
  if (!record) return { changed: null, unknown: true };

  const SKIP = new Set(['__pycache__', '.DS_Store', 'composer']); // Python byte-code and Composer's autoloader are rewritten by the tools
  let budget = 60000;
  let level = [dir];
  for (let depth = 0; depth < 12 && level.length; depth++) {
    const next = [];
    for (const d of level) {
      for (const e of await readdirSafe(d)) {
        if (--budget <= 0) return { changed: null, unknown: true };
        if (SKIP.has(e.name) || e.name.endsWith('.pyc') || e.isSymbolicLink()) continue;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { next.push(p); continue; }
        if (!e.isFile()) continue;
        try {
          if ((await fsp.lstat(p)).mtimeMs > record + 120000) return { changed: path.relative(path.dirname(dir), p), unknown: false };
        } catch {}
      }
    }
    level = next;
  }
  return { changed: null, unknown: false };
}

/** First top-level entry a generic build folder should not contain (for example notes kept in an ignored build/). */
async function unexpectedTop(spec, dir) {
  if (!spec.knownTop) return null;
  for (const e of await readdirSafe(dir)) {
    if (e.name === '.DS_Store') continue;
    if (spec.knownTop.some((k) => (k instanceof RegExp ? k.test(e.name) : k === e.name))) continue;
    return e.name;
  }
  return null;
}

module.exports = { insideOk, nestedGit, ignoredByGit, contents, changedAfterInstall, unexpectedTop };
