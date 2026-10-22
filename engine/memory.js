'use strict';
/**
 * Performance: CPU and memory use, which apps can be quit, and an optional purge.
 * Nothing here kills a process. Apps are asked to quit the same way ⌘Q does, so they can save first.
 */
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { run } = require('./util');

// ---------------------------------------------------------------- parsing (pure, unit-tested)
/** `vm_stat` output -> byte counts. */
function parseVmStat(text) {
  const pageSize = Number((/page size of (\d+) bytes/.exec(text) || [])[1]) || 4096;
  const get = (label) => {
    const m = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\"]/g, '\\$&')}:\\s+(\\d+)`, 'm').exec(text);
    return m ? Number(m[1]) * pageSize : 0;
  };
  return {
    pageSize,
    free: get('Pages free'),
    active: get('Pages active'),
    inactive: get('Pages inactive'),
    speculative: get('Pages speculative'),
    wired: get('Pages wired down'),
    purgeable: get('Pages purgeable'),
    fileBacked: get('File-backed pages'),
    anonymous: get('Anonymous pages'),
    compressed: get('Pages occupied by compressor'),
  };
}

/** `sysctl vm.swapusage` -> { total, used } in bytes. */
function parseSwap(text) {
  const unit = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  const val = (key) => {
    const m = new RegExp(`${key} = ([\\d.]+)([KMG])`).exec(text || '');
    return m ? Math.round(Number(m[1]) * unit[m[2]]) : 0;
  };
  return { total: val('total'), used: val('used') };
}

/** The same split Activity Monitor shows. */
function summarize(vm, total, swap, level) {
  const app = Math.max(0, vm.anonymous - vm.purgeable);
  const used = Math.min(total, app + vm.wired + vm.compressed);
  const cached = Math.max(0, Math.min(total - used, vm.fileBacked + vm.purgeable));
  const free = Math.max(0, total - used - cached);
  // kern.memorystatus_vm_pressure_level: 1 normal, 2 warning, 4 critical
  const pressure = level >= 4 ? 'critical' : level >= 2 ? 'warning' : 'normal';
  return { total, used, app, wired: vm.wired, compressed: vm.compressed, cached, free, swapUsed: swap.used, swapTotal: swap.total, pressure };
}

/** Folders whose apps are part of macOS and are never offered for quitting. */
const SYSTEM_PREFIXES = ['/System/', '/Library/Apple/', '/usr/', '/sbin/', '/bin/', '/private/'];
const NEVER_QUIT = new Set(['Finder.app', 'Dock.app', 'SystemUIServer.app', 'loginwindow.app', 'ControlCenter.app', 'WindowServer.app']);

/** The outermost .app bundle a process belongs to (helpers count toward their app), or null. */
function bundleOf(exe) {
  const i = exe.indexOf('.app/');
  if (i < 0) return null;
  const b = exe.slice(0, i + 4);
  if (!b.startsWith('/') || SYSTEM_PREFIXES.some((p) => b.startsWith(p))) return null;
  if (NEVER_QUIT.has(path.basename(b))) return null;
  return b;
}

/** One `ps -axo pid=,%cpu=,rss=,comm=` line (also accepts the older pid/rss/comm form). */
function parsePsLine(line) {
  // Some locales print the CPU column with a comma ("12,5").
  let m = /^\s*(\d+)\s+(\d+[.,]\d+)\s+(\d+)\s+(.+)$/.exec(line);
  if (m) return { pid: Number(m[1]), cpu: Number(m[2].replace(',', '.')), bytes: Number(m[3]) * 1024, exe: m[4].trim() };
  m = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
  return m ? { pid: Number(m[1]), cpu: 0, bytes: Number(m[2]) * 1024, exe: m[3].trim() } : null;
}

/**
 * ps output -> apps (helpers count toward their app). RSS counts shared pages in every process,
 * so memory is an upper estimate. CPU is % of one core, like Activity Monitor (can pass 100%).
 * `exclude`: bundle paths never listed (Clearspace itself).
 */
function parseApps(text, exclude = []) {
  const apps = new Map();
  for (const line of String(text).split('\n')) {
    const p = parsePsLine(line);
    if (!p) continue;
    const bundle = bundleOf(p.exe);
    if (!bundle || exclude.includes(bundle)) continue;
    if (!apps.has(bundle)) apps.set(bundle, { bundle, name: path.basename(bundle, '.app'), bytes: 0, cpu: 0, pids: [] });
    const a = apps.get(bundle);
    a.bytes += p.bytes;
    a.cpu += p.cpu;
    a.pids.push(p.pid);
  }
  return [...apps.values()]
    .map((a) => ({ ...a, cpu: Math.round(a.cpu * 10) / 10, id: crypto.createHash('sha1').update(a.bundle).digest('hex').slice(0, 12) }))
    .sort((x, y) => y.bytes - x.bytes);
}

/** What well-known busy macOS processes are doing, in plain words. */
const PROCESS_NOTES = [
  [/^(mds|mds_stores|mdworker(_shared)?|mdbulkimport)$/, 'Spotlight is indexing files. Busy for a while after big changes, then it settles.'],
  [/^kernel_task$/, 'macOS itself. High CPU here often means it is slowing things down to keep your Mac cool.'],
  [/^WindowServer$/, 'Draws everything on screen. Busier with many windows, displays or animations.'],
  [/^(photoanalysisd|photolibraryd|mediaanalysisd)$/, 'Photos is analysing your library. It runs mostly while your Mac is idle.'],
  [/^(bird|cloudd|fileproviderd)$/, 'iCloud is syncing files.'],
  [/^backupd(-helper)?$/, 'Time Machine is backing up.'],
  [/^(softwareupdated|softwareupdate)$/, 'macOS is checking for or preparing updates.'],
  [/^(com\.docker\..*|vpnkit.*|qemu.*)$/, 'Part of Docker or another virtual machine.'],
  [/^(node|bun|deno|python3?|java|ruby|go|cargo|rustc)$/, 'A developer tool or server started from a terminal or editor.'],
  [/^(XProtect.*|syspolicyd|trustd)$/, 'macOS security checks.'],
];
const noteFor = (name) => (PROCESS_NOTES.find(([re]) => re.test(name)) || [])[1] || null;

/** Processes that are not part of an app, grouped by name (top by CPU or memory). Shown for information; never quit. */
function parseProcesses(text) {
  const by = new Map();
  for (const line of String(text).split('\n')) {
    const p = parsePsLine(line);
    if (!p || p.exe.includes('.app/')) continue;
    const name = path.basename(p.exe);
    if (!by.has(name)) by.set(name, { name, bytes: 0, cpu: 0, count: 0, system: /^\/(System|usr|sbin|bin|Library\/Apple)\//.test(p.exe) || !p.exe.startsWith('/') });
    const g = by.get(name);
    g.bytes += p.bytes;
    g.cpu += p.cpu;
    g.count += 1;
  }
  return [...by.values()].map((g) => ({ ...g, cpu: Math.round(g.cpu * 10) / 10, note: noteFor(g.name) }));
}

/** Whole-machine CPU use since the previous call, from the kernel's per-core counters. */
let lastTimes = null;
function cpuUsage() {
  const cpus = os.cpus();
  const t = cpus.reduce((a, c) => ({ user: a.user + c.times.user + c.times.nice, sys: a.sys + c.times.sys, idle: a.idle + c.times.idle, irq: a.irq + c.times.irq }), { user: 0, sys: 0, idle: 0, irq: 0 });
  const prev = lastTimes;
  lastTimes = t;
  const d = prev ? { user: t.user - prev.user, sys: t.sys - prev.sys, idle: t.idle - prev.idle, irq: t.irq - prev.irq } : t;
  const total = d.user + d.sys + d.idle + d.irq || 1;
  return { user: (d.user / total) * 100, system: ((d.sys + d.irq) / total) * 100, idle: (d.idle / total) * 100, cores: cpus.length, load: os.loadavg() };
}

/** AppleScript string literal. */
const asString = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------- reading the system
async function snapshot({ selfBundle } = {}) {
  const [vm, mem, sw, lvl, ps] = await Promise.all([
    run('vm_stat', [], { timeout: 5000 }),
    run('sysctl', ['-n', 'hw.memsize'], { timeout: 5000 }),
    run('sysctl', ['-n', 'vm.swapusage'], { timeout: 5000 }),
    run('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], { timeout: 5000 }),
    run('ps', ['-axo', 'pid=,%cpu=,rss=,comm='], { timeout: 8000 }),
  ]);
  const total = Number(mem.stdout.trim());
  if (vm.code !== 0 || !total) return { error: 'Clearspace could not read memory information.' };
  const summary = summarize(parseVmStat(vm.stdout), total, parseSwap(sw.stdout), Number(lvl.stdout.trim()) || 1);
  const apps = parseApps(ps.stdout, selfBundle ? [selfBundle] : []);
  const processes = parseProcesses(ps.stdout);
  // Keep the top entries by memory and by CPU so either sort shows the real leaders.
  const top = (list, n) => {
    const keep = new Set([...[...list].sort((a, b) => b.bytes - a.bytes).slice(0, n), ...[...list].sort((a, b) => b.cpu - a.cpu).slice(0, n)]);
    return list.filter((x) => keep.has(x));
  };
  return { ...summary, cpu: cpuUsage(), apps: top(apps, 12), processes: top(processes, 8), at: Date.now() };
}

/**
 * Ask an app to quit, exactly like ⌘Q: it may show "save changes?" and can refuse.
 * The bundle must still be running and still be a normal app; its identifier is read from the bundle itself.
 */
async function quitApp(app) {
  if (!app || typeof app.bundle !== 'string' || bundleOf(app.bundle + '/') !== app.bundle) return { error: 'This app cannot be quit from Clearspace.' };
  const ps = await run('ps', ['-axo', 'pid=,%cpu=,rss=,comm='], { timeout: 8000 });
  if (ps.code !== 0 || !ps.stdout.trim()) return { error: `Clearspace could not check whether ${app.name} is running.` };
  if (!parseApps(ps.stdout).some((a) => a.bundle === app.bundle)) return { ok: true, already: true };
  const id = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app.bundle, 'Contents', 'Info.plist')], { timeout: 5000 });
  const bundleId = id.stdout.trim();
  if (id.code !== 0 || !/^[A-Za-z0-9.-]+$/.test(bundleId)) return { error: `Clearspace could not identify ${app.name}. Quit it from the Dock instead.` };
  const r = await run('osascript', ['-e', `tell application id ${asString(bundleId)} to quit`], { timeout: 60000 });
  if (r.code !== 0) {
    if (/-1743|not allowed/i.test(r.stderr)) {
      return { error: `macOS did not let Clearspace ask ${app.name} to quit. Allow it in System Settings → Privacy & Security → Automation, or quit it from the Dock.` };
    }
    if (/-128/.test(r.stderr)) return { error: `${app.name} did not quit (it was cancelled, perhaps at a "save changes" prompt).` };
    return { error: `${app.name} did not quit.` };
  }
  return { ok: true };
}

/**
 * macOS's `purge`: empties the file cache and inactive memory. Needs an administrator password
 * (macOS shows its own prompt). The effect is temporary and apps refill the cache as they work.
 */
async function purge({ selfBundle } = {}) {
  const before = await snapshot({ selfBundle });
  const r = await run('osascript', ['-e', 'do shell script "/usr/sbin/purge" with administrator privileges'], { timeout: 180000 });
  if (r.code !== 0) {
    if (/-128/.test(r.stderr)) return { cancelled: true };
    return { error: 'macOS did not run purge.' };
  }
  const after = await snapshot({ selfBundle });
  return { ok: true, freed: before.error || after.error ? null : Math.max(0, after.free - before.free), after };
}

module.exports = { parseVmStat, parseSwap, summarize, parseApps, parseProcesses, parsePsLine, bundleOf, asString, cpuUsage, snapshot, quitApp, purge };
