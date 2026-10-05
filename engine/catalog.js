'use strict';
/**
 * Plain-language knowledge about everything Clearspace can clean.
 * Every item the user sees answers three questions:
 *   what   – what is this?
 *   after  – what happens after cleaning?
 *   lose   – will I lose anything?
 */

const CATEGORIES = [
  {
    id: 'build',
    name: 'Build caches',
    blurb: 'Files that Next.js, Turborepo and other tools generate while you build or run a project. They are rebuilt automatically.',
  },
  {
    id: 'deps',
    name: 'node_modules',
    blurb: 'Installed packages for each project. Your lockfile lets you reinstall the exact same versions in a minute or two.',
  },
  {
    id: 'leftovers',
    name: 'Leftover copies',
    blurb: 'Extra working copies of projects: AI-agent worktrees and duplicated project folders.',
  },
  {
    id: 'pkg',
    name: 'Developer caches',
    blurb: 'Download caches for npm, pnpm, Bun, Homebrew, Playwright and similar tools. They refill only with what you use.',
  },
  {
    id: 'apps',
    name: 'App caches & logs',
    blurb: 'Temporary files that apps keep in your Library. Only caches known to be safe are selected for you. Apple system caches are never touched.',
  },
  {
    id: 'files',
    name: 'Downloads & Trash',
    blurb: 'Large files in Downloads and what is already in your Trash. Nothing here is selected for you.',
  },
];

/** Generated folders inside a project. `marker` = file that must exist next to it so we know it is really a project. */
const BUILD_DIRS = {
  '.next': {
    label: 'Next.js build cache',
    markers: ['package.json'],
    what: 'Compiled pages and the development cache that Next.js writes while you run `next dev` or `next build`.',
    after: 'The next `dev` or `build` run is slower once while Next.js rebuilds it.',
  },
  '.turbo': {
    label: 'Turborepo cache',
    markers: ['package.json', 'turbo.json'],
    what: 'Saved results of earlier builds, lints and tests so Turborepo can skip repeated work.',
    after: 'The next `turbo` run does the full work once, then the cache refills.',
  },
  '.nuxt': {
    label: 'Nuxt build output',
    markers: ['package.json'],
    what: 'Generated files from Nuxt development and builds.',
    after: 'Nuxt regenerates them on the next run.',
  },
  '.svelte-kit': {
    label: 'SvelteKit build output',
    markers: ['package.json'],
    what: 'Generated files from SvelteKit development and builds.',
    after: 'SvelteKit regenerates them on the next run.',
  },
  '.parcel-cache': {
    label: 'Parcel cache',
    markers: ['package.json'],
    what: 'Parcel bundler cache.',
    after: 'The next build is slower once.',
  },
  '.angular': {
    label: 'Angular cache',
    markers: ['package.json', 'angular.json'],
    what: 'Angular CLI build cache.',
    after: 'The next build is slower once.',
  },
  coverage: {
    label: 'Test coverage report',
    markers: ['package.json'],
    what: 'HTML and JSON reports produced by a test coverage run.',
    after: 'They come back the next time you run tests with coverage.',
  },
};

const H = '~';
/** Known developer caches (absolute paths are resolved at scan time). */
const DEV_CACHES = [
  {
    key: 'npm', path: `${H}/.npm/_cacache`, name: 'npm download cache', action: 'delete',
    what: 'Every package npm has ever downloaded, kept so repeat installs are faster.',
    after: 'npm downloads packages again the next time a project needs them.',
  },
  {
    key: 'pnpm-prune', path: `${H}/Library/pnpm/store`, name: 'Unused packages in the pnpm store', action: 'pnpm-prune',
    sizeLabel: 'Up to',
    what: 'pnpm keeps one shared copy of every package on your Mac. After node_modules folders are deleted, their packages stay here until pruned.',
    after: 'Packages no project uses are removed. Projects you still have installed keep working.',
    note: 'This is where the space from deleted node_modules is actually freed.',
  },
  {
    key: 'bun', path: `${H}/.bun/install/cache`, name: 'Bun download cache', action: 'delete',
    what: 'Packages downloaded by `bun install`.',
    after: 'Bun downloads packages again when a project needs them.',
  },
  {
    key: 'yarn', path: `${H}/Library/Caches/Yarn`, name: 'Yarn download cache', action: 'empty',
    what: 'Packages downloaded by Yarn.',
    after: 'Yarn downloads packages again when a project needs them.',
  },
  {
    key: 'homebrew', path: `${H}/Library/Caches/Homebrew`, name: 'Homebrew downloads', action: 'empty',
    what: 'Installer files Homebrew downloaded for packages that are already installed.',
    after: 'Nothing changes for installed tools. Reinstalls download again.',
  },
  {
    key: 'pip', path: `${H}/Library/Caches/pip`, name: 'pip download cache', action: 'empty',
    what: 'Python packages downloaded by pip.',
    after: 'pip downloads packages again when needed.',
  },
  {
    key: 'turbo-global', path: `${H}/Library/Caches/turbo`, name: 'Turborepo global cache', action: 'empty',
    what: 'Turborepo files shared between projects.',
    after: 'Turborepo rebuilds them on the next run.',
  },
  {
    key: 'electron', path: `${H}/Library/Caches/electron`, name: 'Electron downloads', action: 'empty',
    what: 'Electron runtime zips downloaded while installing Electron apps.',
    after: 'Downloaded again the next time an Electron project is installed.',
  },
  {
    key: 'electron-builder', path: `${H}/Library/Caches/electron-builder`, name: 'electron-builder downloads', action: 'empty',
    what: 'Tools downloaded while packaging Electron apps.',
    after: 'Downloaded again on the next packaging run.',
  },
  {
    key: 'playwright', path: `${H}/Library/Caches/ms-playwright`, name: 'Playwright browsers', action: 'empty', risk: 'check',
    what: 'Chromium, Firefox and WebKit builds used by Playwright tests and browser tools.',
    after: 'Run `npx playwright install` before running browser tests again.',
  },
  {
    key: 'cypress', path: `${H}/Library/Caches/Cypress`, name: 'Cypress app', action: 'empty', risk: 'check',
    what: 'The Cypress test runner binaries.',
    after: 'Cypress downloads itself again on the next install.',
  },
  {
    key: 'cocoapods', path: `${H}/Library/Caches/CocoaPods`, name: 'CocoaPods cache', action: 'empty',
    what: 'Downloaded iOS pods.',
    after: 'Downloaded again on the next `pod install`.',
  },
  {
    key: 'xcode-derived', path: `${H}/Library/Developer/Xcode/DerivedData`, name: 'Xcode DerivedData', action: 'empty',
    what: 'Xcode build products and indexes.',
    after: 'Xcode rebuilds and re-indexes projects the next time you open them.',
  },
  {
    key: 'sim-caches', path: `${H}/Library/Developer/CoreSimulator/Caches`, name: 'iOS Simulator caches', action: 'empty',
    what: 'Temporary simulator files.',
    after: 'Simulators recreate them on next launch.',
  },
  {
    key: 'gradle', path: `${H}/.gradle/caches`, name: 'Gradle caches', action: 'delete',
    what: 'Downloaded Android/Java dependencies and build caches.',
    after: 'The next Gradle build downloads dependencies again.',
  },
];

const APP_CACHE_TEXT = {
  what: 'Temporary files this app keeps to load faster.',
  after: 'The app recreates what it needs. It may be a little slower the first time. Quit the app first.',
  lose: 'Usually not: this app is on Clearspace\'s list of caches known to hold only temporary files, not documents, settings or logins.',
};

/** Library/Caches folders known to hold only re-creatable data. Only these are preselected. */
const SAFE_APP_CACHES = [
  /^com\.google\.Chrome$/, /^com\.microsoft\.VSCode$/, /^com\.todesktop\.230313mzl4w4u92$/, /^com\.tinyspeck\.slackmacgap$/,
  /^com\.hnc\.Discord$/, /^us\.zoom\.xos$/, /^com\.brave\.Browser$/, /^BraveSoftware$/, /^company\.thebrowser\.Browser$/,
  /^org\.mozilla\.firefox$/, /^Firefox$/, /^com\.openai\.chat$/, /^com\.anthropic\.claudefordesktop$/, /^dev\.warp\.Warp-Stable$/,
  /^com\.exafunction\.windsurf$/, /^notion\.id$/, /^com\.github\.GitHubClient$/, /^node-gyp$/, /^typescript$/, /^next-swc$/,
  /^com\.microsoft\.teams2$/, /^com\.microsoft\.edgemac$/, /^com\.operasoftware\.Opera$/, /^com\.vivaldi\.Vivaldi$/, /^go-build$/,
];

/** Caches that need a specific warning. First match wins. */
const APP_CACHE_WARNINGS = [
  [/ShipIt$/i, 'Holds app updates while they install, including the backup of the old version. Clean it only when the app is not updating.'],
  [/jetbrains|androidstudio|^Google$/i, 'May contain Local History from JetBrains IDEs or Android Studio, which can recover code you never committed.'],
  [/dropbox|drivefs|onedrive|^mega|(^|\.)box(\.|$)|pcloud|nextcloud|synology|(^|\.)sync|sync(\.|$)|googledrive|icloud/i, 'A cloud-sync app. Clearing it can force a full re-sync and, while syncing, may hold changes not uploaded yet.'],
  [/llama|ollama|lm-?studio|whisper(\.cpp|kit)?$|huggingface|gguf|(^|[._-])models?([._-]|$)/i, 'May hold downloaded AI models, which are large and slow to download again.'],
  [/^deno$/i, 'Deno keeps app data here (localStorage and KV databases), not only cache.'],
  [/pypoetry|virtualenv|conda/i, 'Holds Python environments that your projects use.'],
  [/spotify/i, 'May hold music you downloaded for offline listening.'],
  [/adobe/i, 'May hold Adobe cloud-document and font caches.'],
];
const APP_CACHE_UNKNOWN = 'Not on Clearspace\'s list of known-safe caches. Some apps keep downloads, offline data or history here. Check what this app is before cleaning.';

/** Library/Caches folders we never list (system-managed or claimed elsewhere). */
const APP_CACHE_SKIP = [
  /^com\.apple\./i, /^CloudKit$/i, /^FamilyCircle$/i, /^GeoServices$/i, /^GameKit$/i,
  /^com\.crashlytics/i, /^Metadata$/i, /^PassKit$/i, /^AMSDataMigratorTool$/i,
  /^Yarn$/i, /^Homebrew$/i, /^pip$/i, /^turbo$/i, /^electron$/i, /^electron-builder$/i,
  /^ms-playwright$/i, /^Cypress$/i, /^CocoaPods$/i,
  /clearspace/i,
];

const INSTALLER_EXT = /\.(dmg|pkg|iso|xip|zip|tar|tgz|gz|rar|7z)$/i;

module.exports = { CATEGORIES, BUILD_DIRS, DEV_CACHES, APP_CACHE_TEXT, APP_CACHE_SKIP, INSTALLER_EXT, SAFE_APP_CACHES, APP_CACHE_WARNINGS, APP_CACHE_UNKNOWN };
