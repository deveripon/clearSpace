'use strict';
// Run with: node --test test/memory.test.js  (pure parsing and safety rules; no real processes are touched)
const test = require('node:test');
const assert = require('node:assert');
const { parseVmStat, parseSwap, summarize, parseApps, parseProcesses, parsePsLine, cpuUsage, bundleOf, asString, quitApp } = require('../engine/memory');

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                5000.
Pages active:                            200000.
Pages inactive:                          190000.
Pages speculative:                         3000.
Pages throttled:                              0.
Pages wired down:                         90000.
Pages purgeable:                          10000.
"Translation faults":                 900000000.
Pages copy-on-write:                   20000000.
Pages zero filled:                    500000000.
Pages reactivated:                      9000000.
Pages purged:                           3000000.
File-backed pages:                       150000.
Anonymous pages:                         243000.
Pages stored in compressor:              300000.
Pages occupied by compressor:             60000.
Decompressions:                        10000000.
Compressions:                          20000000.
Pageins:                               30000000.
Pageouts:                                100000.
Swapins:                                      0.
Swapouts:                                     0.
`;
const P = 16384;

test('vm_stat and swap parsing', () => {
  const vm = parseVmStat(VM_STAT);
  assert.strictEqual(vm.pageSize, P);
  assert.strictEqual(vm.wired, 90000 * P);
  assert.strictEqual(vm.compressed, 60000 * P);
  assert.strictEqual(vm.anonymous, 243000 * P);
  assert.strictEqual(vm.fileBacked, 150000 * P);
  const sw = parseSwap('total = 2048.00M  used = 1536.50M  free = 511.50M  (encrypted)');
  assert.strictEqual(sw.total, 2048 * 1024 ** 2);
  assert.strictEqual(sw.used, Math.round(1536.5 * 1024 ** 2));
  assert.deepStrictEqual(parseSwap(''), { total: 0, used: 0 });
});

test('summary matches the Activity Monitor split and never exceeds total', () => {
  const total = 16 * 1024 ** 3;
  const s = summarize(parseVmStat(VM_STAT), total, { total: 0, used: 0 }, 1);
  assert.strictEqual(s.app, (243000 - 10000) * P);
  assert.strictEqual(s.used, s.app + s.wired + s.compressed);
  assert.ok(s.used + s.cached + s.free <= total + 1);
  assert.strictEqual(s.pressure, 'normal');
  assert.strictEqual(summarize(parseVmStat(VM_STAT), total, { total: 0, used: 0 }, 2).pressure, 'warning');
  assert.strictEqual(summarize(parseVmStat(VM_STAT), total, { total: 0, used: 0 }, 4).pressure, 'critical');
  // a tiny machine: nothing goes negative
  const tiny = summarize(parseVmStat(VM_STAT), 1024 ** 3, { total: 0, used: 0 }, 1);
  assert.ok(tiny.used <= 1024 ** 3 && tiny.cached >= 0 && tiny.free >= 0);
});

const PS = `    1  12000 /sbin/launchd
  100 400000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  101 300000 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/A/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  102 200000 /Applications/Slack.app/Contents/MacOS/Slack
  103 900000 /System/Applications/Mail.app/Contents/MacOS/Mail
  104 500000 /System/Library/CoreServices/Finder.app/Contents/MacOS/Finder
  105  80000 /usr/libexec/trustd
  106 700000 /Users/you/Applications/Clearspace.app/Contents/MacOS/Clearspace
  107  50000 /opt/homebrew/bin/node
  108 250000 /Applications/Utilities/Finder.app/Contents/MacOS/Finder
`;

test('apps: helpers count toward their app; system, CLI and Clearspace itself are never listed', () => {
  const apps = parseApps(PS, ['/Users/you/Applications/Clearspace.app']);
  const names = apps.map((a) => a.name);
  assert.deepStrictEqual(names, ['Google Chrome', 'Slack']);
  assert.strictEqual(apps[0].bytes, (400000 + 300000) * 1024);
  assert.deepStrictEqual(apps[0].pids, [100, 101]);
  assert.match(apps[0].id, /^[0-9a-f]{12}$/);
});

test('bundleOf refuses system locations and protected apps', () => {
  assert.strictEqual(bundleOf('/Applications/Slack.app/Contents/MacOS/Slack'), '/Applications/Slack.app');
  for (const p of ['/System/Applications/Mail.app/x', '/System/Library/CoreServices/Finder.app/x', '/usr/libexec/x.app/x',
    '/Library/Apple/System/Foo.app/x', 'relative/Foo.app/x', '/Applications/Dock.app/x', '/opt/homebrew/bin/node']) {
    assert.strictEqual(bundleOf(p), null, p);
  }
});

test('AppleScript strings are escaped', () => {
  assert.strictEqual(asString('a"b\\c'), '"a\\"b\\\\c"');
});

test('quitApp refuses anything that is not a normal app bundle, before touching the system', async () => {
  for (const bad of [null, {}, { bundle: '/System/Applications/Mail.app', name: 'Mail' }, { bundle: '/Applications/Finder.app', name: 'Finder' },
    { bundle: 'Slack.app', name: 'Slack' }, { bundle: '/Applications/Slack.app/Contents', name: 'x' }]) {
    const r = await quitApp(bad);
    assert.ok(r.error, JSON.stringify(bad));
  }
});

const PS_CPU = `    1   0.0  12000 /sbin/launchd
  100  12.5 400000 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  101  30.0 300000 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Versions/A/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  102   0.3 200000 /Applications/Slack.app/Contents/MacOS/Slack
  200  45.1  90000 /System/Library/Frameworks/CoreServices.framework/Frameworks/Metadata.framework/Versions/A/Support/mds_stores
  201   2.0  50000 /opt/homebrew/bin/node
  202   1.0  40000 /opt/homebrew/bin/node
  203   9.0      0 kernel_task
`;

test('CPU: app CPU adds up across helpers; the old ps format still parses', () => {
  const apps = parseApps(PS_CPU);
  assert.deepStrictEqual(apps.map((a) => [a.name, a.cpu]), [['Google Chrome', 42.5], ['Slack', 0.3]]);
  assert.deepStrictEqual(parsePsLine('  102 200000 /Applications/Slack.app/Contents/MacOS/Slack'), { pid: 102, cpu: 0, bytes: 200000 * 1024, exe: '/Applications/Slack.app/Contents/MacOS/Slack' });
  assert.strictEqual(parsePsLine('garbage'), null);
  assert.strictEqual(parsePsLine('  100  12,5 400000 /Applications/Slack.app/Contents/MacOS/Slack').cpu, 12.5);
  assert.strictEqual(parsePsLine('  100  12,5 400000 /Applications/Slack.app/Contents/MacOS/Slack').bytes, 400000 * 1024);
});

test('background processes: never include app processes, group by name, explain well-known ones', () => {
  const procs = parseProcesses(PS_CPU);
  const by = Object.fromEntries(procs.map((p) => [p.name, p]));
  assert.ok(!procs.some((p) => /Chrome|Slack/.test(p.name)));
  assert.strictEqual(by.node.count, 2);
  assert.strictEqual(by.node.cpu, 3);
  assert.strictEqual(by.node.system, false);
  assert.strictEqual(by.mds_stores.system, true);
  assert.match(by.mds_stores.note, /Spotlight/);
  assert.strictEqual(by.kernel_task.system, true);
  assert.strictEqual(by.launchd.system, true);
  // these are information only: no id, so the window has nothing it could ask main to quit
  assert.ok(procs.every((p) => !('id' in p) && !('pids' in p)));
});

test('cpuUsage returns sane percentages', () => {
  const c = cpuUsage();
  assert.ok(c.cores >= 1);
  for (const k of ['user', 'system', 'idle']) assert.ok(c[k] >= 0 && c[k] <= 100.0001, k);
});
