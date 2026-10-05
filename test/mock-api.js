// Browser-only mock of window.api for UI screenshots. Data mirrors a real scan of this Mac.
(() => {
  const GB = 1e9, MB = 1e6;
  const H = '~/devripon/Final & Running Project';
  const item = (o) => ({ tags: [], paths: [o.subtitle.replace('~', '/Users/devripon')], ...o });
  const build = (id, title, kind, size, sub, tags = []) => item({
    id, category: 'build', title, kindLabel: kind, subtitle: sub, size, action: 'delete', risk: 'safe', recommended: true, tags,
    what: kind === 'Turborepo cache' ? 'Saved results of earlier builds, lints and tests so Turborepo can skip repeated work.' : 'Compiled pages and the development cache that Next.js writes while you run `next dev` or `next build`.',
    after: kind === 'Turborepo cache' ? 'The next `turbo` run does the full work once, then the cache refills.' : 'The next `dev` or `build` run is slower once while Next.js rebuilds it.',
    lose: 'No. Only generated files are removed. Your source code is untouched.',
  });
  const deps = (id, title, size, sub, ago, active, pm = 'pnpm') => item({
    id, category: 'deps', title, kindLabel: 'node_modules', subtitle: sub, size, action: 'delete', risk: 'safe', recommended: !active, active, pm, tags: [ago],
    what: 'Packages installed for this project.', after: `Run \`${pm} install\` before you work on it again. It restores the exact versions from pnpm-lock.yaml.`,
    lose: 'No. Your code, git history and .env files are not inside node_modules.',
    note: 'pnpm shares package files with its store, so most of this space is freed by "Unused packages in the pnpm store" in Developer caches.',
  });
  const wt = (id, name, branch, size, unpushed, dirty, base = 'island-tours') => item({
    id, category: 'leftovers', title: name, kindLabel: `worktree of ${base}`, subtitle: `${H}/${base}/.claude/worktrees/${name}`, size,
    group: 'worktree', action: 'worktree', risk: dirty ? 'locked' : (unpushed ? 'check' : 'safe'), recommended: !dirty && !unpushed,
    lockedReason: dirty ? `Has ${dirty} uncommitted changes. Commit or discard them first.` : null,
    tags: [...(branch === `worktree-${name}` ? [] : [`Branch ${branch}`]), 'Last commit 16 days ago'],
    what: `A separate working copy an AI coding agent created on branch ${branch}. Your main ${base} folder does not use it.`,
    after: `Removed with \`git worktree remove\`. The branch ${branch} stays in your repository.`,
    lose: unpushed ? `No. Its ${unpushed} commits not pushed yet stay on branch ${branch} in your main repo.` : 'No. Everything on this branch is already in your repository.',
  });
  const app = (id, title, size, sub) => item({
    id, category: 'apps', title, subtitle: sub, size, action: 'empty', risk: 'safe', recommended: true,
    what: 'Temporary files this app keeps to load faster.', after: 'The app recreates what it needs. It may be a little slower the first time. Quit the app first for best results.',
    lose: 'No. Caches never hold your documents, settings or logins.',
  });
  const items = [
    build('b1', 'veyro-app', 'Next.js build cache', 16.83 * GB, `${H}/veyro/veyro-app`),
    build('b2', 'veyro-app', 'Turborepo cache', 16.21 * GB, `${H}/veyro/veyro-app`),
    build('b3', 'wattup-proforma', 'Next.js build cache', 0.44 * GB, `${H}/wattup-usa/wattup-proforma`, ['Used today']),
    build('b4', 'wattup-frontend', 'Next.js build cache', 0.31 * GB, `${H}/wattup-usa/wattup-frontend`, ['Used today']),
    deps('d1', 'veyro-app', 1.65 * GB, `${H}/veyro/veyro-app`, 'Used 5 days ago', true),
    deps('d2', 'wattup-frontend', 1.37 * GB, `${H}/wattup-usa/wattup-frontend`, 'Used today', true),
    deps('d3', 'wattup-proforma', 0.94 * GB, `${H}/wattup-usa/wattup-proforma`, 'Used today', true),
    deps('d4', 'tw-comingsoon', 0.76 * GB, `${H}/tw-comingsoon`, 'Used 26 days ago', false),
    deps('d5', 'system-design', 0.76 * GB, '~/devripon/System Design and Enginnering/system-design', 'Used 7 days ago', true),
    wt('w1', 'agent-aa0d6f99e2f2c61b9', 'worktree-agent-aa0d6f99e2f2c61b9', 2.66 * GB, 1, 0),
    wt('w2', 'agent-aa8dd424320610d31', 'worktree-agent-aa8dd424320610d31', 2.51 * GB, 2, 0),
    wt('w3', 'agent-a79eed028521041b0', 'fix/tour-page-reviews-order', 2.2 * GB, 0, 0),
    wt('w4', 'agent-a4caf814f8e24bf6a', 'worktree-agent-a4caf814f8e24bf6a', 1.64 * GB, 1, 3),
    item({ id: 'c1', category: 'leftovers', title: 'island-tours copy', kindLabel: 'Duplicate of island-tours', subtitle: `${H}/island-tours copy`, size: 13.4 * GB,
      group: 'duplicate', action: 'trash', risk: 'check', recommended: false, tags: ['Same latest commit as the original'],
      what: 'A Finder copy of island-tours, including its own node_modules and worktrees.', after: 'The whole folder moves to the Trash. You can put it back from the Trash until you empty it.',
      lose: 'Probably not: it is at the same commit as the original. Check for files you changed only in the copy.' }),
    item({ id: 'p1', key: 'pnpm-prune', category: 'pkg', title: 'Unused packages in the pnpm store', subtitle: '~/Library/pnpm/store', size: 9.8 * GB, sizeLabel: 'Up to',
      action: 'pnpm-prune', risk: 'safe', recommended: false,
      what: 'pnpm keeps one shared copy of every package on your Mac. After node_modules folders are deleted, their packages stay here until pruned.',
      after: 'Packages no project uses are removed. Projects you still have installed keep working.', lose: 'No. These are downloads that can be fetched again.',
      note: 'This is where the space from deleted node_modules is actually freed.' }),
    item({ id: 'p2', key: 'npm', category: 'pkg', title: 'npm download cache', subtitle: '~/.npm/_cacache', size: 2.3 * GB, action: 'delete', risk: 'safe', recommended: true,
      what: 'Every package npm has ever downloaded, kept so repeat installs are faster.', after: 'npm downloads packages again the next time a project needs them.', lose: 'No. These are downloads that can be fetched again.' }),
    item({ id: 'p3', key: 'playwright', category: 'pkg', title: 'Playwright browsers', subtitle: '~/Library/Caches/ms-playwright', size: 1.1 * GB, action: 'empty', risk: 'check', recommended: false,
      what: 'Chromium, Firefox and WebKit builds used by Playwright tests and browser tools.', after: 'Run `npx playwright install` before running browser tests again.', lose: 'No. These are downloads that can be fetched again.' }),
    app('a1', 'Visual Studio Code', 0.9 * GB, '~/Library/Caches/com.microsoft.VSCode'),
    app('a2', 'Slack', 0.48 * GB, '~/Library/Caches/com.tinyspeck.slackmacgap'),
    { ...app('a3', 'Google (Chrome and others)', 1.9 * GB, '~/Library/Caches/Google'), risk: 'check', recommended: false, kindLabel: 'not on the known-safe list',
      lose: 'May contain Local History from JetBrains IDEs or Android Studio, which can recover code you never committed.' },
    { ...app('a4', 'Cursor updates', 0.62 * GB, '~/Library/Caches/com.todesktop.230313mzl4w4u92.ShipIt'), risk: 'check', recommended: false, kindLabel: 'not on the known-safe list',
      lose: 'Holds app updates while they install, including the backup of the old version. Clean it only when the app is not updating.' },
    item({ id: 'f1', category: 'files', title: 'Docker.dmg', kindLabel: 'Installer or archive', subtitle: '~/Downloads/Docker.dmg', size: 0.52 * GB, action: 'trash', risk: 'check', recommended: false, tags: ['Added 41 days ago'],
      what: 'A downloaded installer or archive. Once the app is installed or the files extracted, it is usually not needed.', after: 'It moves to the Trash. You can put it back until you empty the Trash.', lose: 'Only if you still need this file. Check before cleaning.' }),
  ];
  const cats = [
    ['build', 'Build caches', 'Files that Next.js, Turborepo and other tools generate while you build or run a project. They are rebuilt automatically.'],
    ['deps', 'node_modules', 'Installed packages for each project. Your lockfile lets you reinstall the exact same versions in a minute or two.'],
    ['leftovers', 'Leftover copies', 'Extra working copies of projects: AI-agent worktrees and duplicated project folders.'],
    ['pkg', 'Developer caches', 'Download caches for npm, pnpm, Bun, Homebrew, Playwright and similar tools. They refill only with what you use.'],
    ['apps', 'App caches & logs', 'Temporary files that apps keep in your Library. Apps recreate what they need. System caches from Apple are never touched.'],
    ['files', 'Downloads & Trash', 'Large files in Downloads and what is already in your Trash. Nothing here is selected for you.'],
  ].map(([id, name, blurb]) => {
    const l = items.filter((i) => i.category === id);
    return { id, name, blurb, count: l.length, size: l.reduce((a, i) => a + i.size, 0) };
  });
  const disk = { total: 245.1 * GB, free: 37.9 * GB, used: 207.2 * GB };
  const listeners = { scan: [], clean: [], menu: [] };
  const sub = (k) => (cb) => { listeners[k].push(cb); return () => { listeners[k] = listeners[k].filter((x) => x !== cb); }; };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let settings = { projectRoots: ['~/devripon'], inactiveDays: 14, scanOnLaunch: window.__MOCK_SCAN_ON_LAUNCH__ !== false };
  window.api = {
    getSettings: async () => settings,
    saveSettings: async (s) => (settings = { ...settings, ...s }),
    getHistory: async () => [{ at: Date.now() - 86400000, freed: 32.2 * GB, estimated: 33.7 * GB, items: 4 }, { at: Date.now() - 1.1 * 86400000, freed: 1.3 * GB, estimated: 22.7 * GB, items: 37 }],
    getDisk: async () => disk,
    pickFolder: async () => '~/Projects',
    reveal: async () => {},
    openFullDiskAccess: async () => {},
    onScanProgress: sub('scan'), onCleanProgress: sub('clean'), onMenu: sub('menu'),
    scan: async () => {
      const delay = window.__MOCK_SCAN_DELAY__ ?? 300;
      listeners.scan.forEach((f) => f({ phase: 'walk', detail: '~/devripon/Final & Running Project/veyro' }));
      await wait(delay);
      listeners.scan.forEach((f) => f({ phase: 'measure', detail: 'veyro-app', done: 9, total: 22 }));
      await wait(delay);
      return { items, categories: cats, warnings: [], disk, roots: ['~/devripon'], scannedAt: Date.now() - 60000 };
    },
    clean: async (ids) => {
      for (let i = 0; i < ids.length; i++) { listeners.clean.forEach((f) => f({ index: i + 1, total: ids.length, title: 'item ' + (i + 1) })); await wait(40); }
      return {
        results: ids.map((id) => ({ id, title: (items.find((x) => x.id === id) || {}).title, status: id === 'w2' ? 'error' : 'done', message: id === 'w2' ? 'fatal: cannot remove a locked working tree' : null })),
        before: disk, after: { ...disk, free: disk.free + 41.6 * GB }, freed: 41.6 * GB, estimated: 46 * GB, finishedAt: Date.now(),
      };
    },
  };
})();
