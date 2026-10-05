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
    blurb: 'Files that build tools create while you work: Next.js, Rust, Gradle, Swift, Flutter, Python test caches and more. They are rebuilt automatically.',
  },
  {
    id: 'deps',
    name: 'Dependencies',
    blurb: 'Packages installed inside each project: node_modules, Python virtual environments, CocoaPods, Composer and more. They can be installed again from your project files.',
  },
  {
    id: 'leftovers',
    name: 'Leftover copies',
    blurb: 'Extra working copies of projects: AI-agent worktrees and duplicated project folders.',
  },
  {
    id: 'pkg',
    name: 'Developer caches',
    blurb: 'Download caches for npm, pip, Cargo, Gradle, Maven, Homebrew, Xcode and similar tools. They refill only with what you use.',
  },
  {
    id: 'apps',
    name: 'App caches & logs',
    blurb: 'Temporary files that apps keep in your Library. Only caches known to be safe are selected for you. Apple system caches are never touched.',
  },
  {
    id: 'files',
    name: 'Downloads, backups & Trash',
    blurb: 'Large files in Downloads, old iPhone and iPad backups, and what is already in your Trash. Nothing here is selected for you.',
  },
];

/**
 * Folders inside a project that Clearspace may offer to remove. Scan and clean both use this list,
 * so a folder is only ever removed if it matches one entry here at both times.
 *
 *   name     folder name
 *   markers  at least one of these files must sit next to the folder (proves it is a real project)
 *   inside   if set, at least one of these must exist inside the folder (proves it is really output)
 *   insideAnyChild  a file that one of its child folders must contain
 *   heavy    slow to rebuild: recommended only when the project has not been used for a while
 *   generic  a name people also use for their own folders (build, vendor, deps...): only "Safe"
 *            when git ignores the folder; otherwise "Check first"
 *   nestedGitOkUnder / nestedGitDepth  where the tool itself keeps git clones / how deep to look for repos
 *   locks    (dependencies) [file, install command] pairs; the first one present is used
 *   exactLocks  lockfiles that pin exact versions
 *   knownTop    (generic build folders) what the tool writes at the top level; anything else => "Check first"
 *   noAutoSelect (dependencies) never preselected: the tool keeps no per-package record to prove nothing was edited
 *   notOutput   entries inside that are not re-creatable output, with the reason => "Check first"
 */
const PY = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'tox.ini'];
const GRADLE = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'];
const COVERAGE_FILES = ['lcov.info', 'coverage-final.json', 'coverage-summary.json', 'clover.xml', 'lcov-report', 'cobertura-coverage.xml'];
const rebuilt = (tool) => `The next ${tool} run is slower once while it rebuilds.`;

const PROJECT_DIRS = [
  // ---- JavaScript / TypeScript
  { id: 'next', name: '.next', category: 'build', label: 'Next.js build cache', markers: ['package.json'],
    what: 'Compiled pages and the development cache that Next.js writes while you run `next dev` or `next build`.',
    after: 'The next `dev` or `build` run is slower once while Next.js rebuilds it.' },
  { id: 'turbo', name: '.turbo', category: 'build', label: 'Turborepo cache', markers: ['package.json', 'turbo.json'],
    what: 'Saved results of earlier builds, lints and tests so Turborepo can skip repeated work.',
    after: 'The next `turbo` run does the full work once, then the cache refills.' },
  { id: 'nuxt', name: '.nuxt', category: 'build', label: 'Nuxt build output', markers: ['package.json'],
    what: 'Generated files from Nuxt development and builds.', after: 'Nuxt regenerates them on the next run.' },
  { id: 'svelte-kit', name: '.svelte-kit', category: 'build', label: 'SvelteKit build output', markers: ['package.json'],
    what: 'Generated files from SvelteKit development and builds.', after: 'SvelteKit regenerates them on the next run.' },
  { id: 'parcel', name: '.parcel-cache', category: 'build', label: 'Parcel cache', markers: ['package.json'],
    what: 'Parcel bundler cache.', after: rebuilt('build') },
  { id: 'angular', name: '.angular', category: 'build', label: 'Angular cache', markers: ['package.json', 'angular.json'],
    what: 'Angular CLI build cache.', after: rebuilt('build') },
  { id: 'coverage', name: 'coverage', category: 'build', label: 'Test coverage report', markers: ['package.json', ...PY], inside: COVERAGE_FILES,
    what: 'HTML and JSON reports produced by a test coverage run.', after: 'They come back the next time you run tests with coverage.' },
  // ---- Rust, Java, Android, Kotlin
  { id: 'rust-target', name: 'target', category: 'build', label: 'Rust build output', markers: ['Cargo.toml'], inside: ['CACHEDIR.TAG'], heavy: true, nestedGitDepth: 3,
    notOutput: { criterion: 'target/criterion holds saved Criterion benchmark baselines, which cannot be re-created. Look at it before cleaning.' },
    what: 'Compiled code and build artifacts Cargo writes while you build, test or run this project.',
    after: 'The next `cargo build` compiles everything again, which can take a few minutes.' },
  { id: 'maven-target', name: 'target', category: 'build', label: 'Maven build output', markers: ['pom.xml'], inside: ['maven-status', 'maven-archiver'], heavy: true, generic: true,
    knownTop: ['classes', 'test-classes', 'generated-sources', 'generated-test-sources', 'maven-status', 'maven-archiver', 'surefire-reports', 'failsafe-reports',
      'antrun', 'dependency', 'jacoco.exec', 'checkstyle-result.xml', 'checkstyle-cachefile', 'checkstyle-checker.xml', /\.(jar|war|ear|pom)$/, /^jacoco/],
    what: 'Compiled classes, test reports and packaged files that Maven writes during a build.',
    after: 'The next `mvn` build compiles everything again.' },
  { id: 'gradle-build', name: 'build', category: 'build', label: 'Gradle build output', markers: GRADLE, inside: ['tmp', 'intermediates', 'kotlin', 'generated'], heavy: true, generic: true,
    knownTop: ['tmp', 'intermediates', 'kotlin', 'generated', 'classes', 'libs', 'reports', 'outputs', 'resources', 'test-results', 'jacoco', 'distributions',
      'scripts-tmp', 'kotlinToolingMetadata', '.transforms', 'snapshot', 'javadoc', 'native-libs', 'publications', 'xcode-frameworks', 'compose-cache'],
    what: 'Compiled code and build artifacts Gradle writes for this project (Android, Kotlin or Java).',
    after: 'The next Gradle build compiles everything again.' },
  { id: 'gradle-project', name: '.gradle', category: 'build', label: 'Gradle project cache', markers: GRADLE, inside: ['buildOutputCleanup', 'file-system.probe', 'vcs-1', 'checksums', 'configuration-cache', 'noVersion'],
    what: 'Gradle\'s per-project cache of build state and file hashes.', after: rebuilt('Gradle') },
  // ---- Apple
  { id: 'swiftpm', name: '.build', category: 'build', label: 'Swift package build', markers: ['Package.swift'], inside: ['workspace-state.json'], heavy: true, nestedGitOkUnder: ['checkouts', 'repositories'],
    what: 'Compiled code and checked-out package dependencies from Swift Package Manager.',
    after: 'The next `swift build` fetches and compiles dependencies again.' },
  // ---- Flutter / Dart
  { id: 'dart-tool', name: '.dart_tool', category: 'build', label: 'Dart tool cache', markers: ['pubspec.yaml'], inside: ['package_config.json'],
    what: 'Package configuration and build caches the Dart and Flutter tools create.',
    after: 'Run `flutter pub get` (or `dart pub get`) before working on it again.' },
  { id: 'flutter-build', name: 'build', category: 'build', label: 'Flutter build output', markers: ['pubspec.yaml'], inside: ['.last_build_id', 'flutter_assets', 'native_assets'], heavy: true, generic: true,
    knownTop: ['.last_build_id', 'flutter_assets', 'native_assets', 'app', 'ios', 'macos', 'web', 'windows', 'linux', 'android', 'tmp', 'intermediates', 'kotlin',
      'generated', 'outputs', 'reports', 'flutter_build', '.cxx', 'unit_test_assets', 'test_cache'],
    what: 'Apps and intermediate files Flutter builds for each platform.',
    after: 'The next `flutter run` or `flutter build` builds everything again.' },
  // ---- Python
  { id: 'pytest-cache', name: '.pytest_cache', category: 'build', label: 'pytest cache', markers: PY, inside: ['CACHEDIR.TAG'],
    what: 'Results pytest remembers between runs, such as which tests failed last time.', after: 'pytest starts with an empty cache next time.' },
  { id: 'mypy-cache', name: '.mypy_cache', category: 'build', label: 'mypy cache', markers: PY, inside: ['CACHEDIR.TAG'],
    what: 'Type-checking results mypy saves to run faster.', after: rebuilt('mypy') },
  { id: 'ruff-cache', name: '.ruff_cache', category: 'build', label: 'Ruff cache', markers: PY, inside: ['CACHEDIR.TAG'],
    what: 'Lint results Ruff saves to run faster.', after: 'Ruff rebuilds it on the next run.' },
  { id: 'tox', name: '.tox', category: 'build', label: 'tox test environments', markers: ['tox.ini', 'pyproject.toml', 'setup.cfg'], insideAnyChild: 'pyvenv.cfg',
    what: 'Separate Python environments tox creates to run your tests.', after: 'tox creates them again on the next run, which takes a while.' },
  // ---- Elixir, C/C++, Zig
  { id: 'mix-build', name: '_build', category: 'build', label: 'Elixir build output', markers: ['mix.exs'], inside: ['dev/lib', 'test/lib', 'prod/lib'], generic: true, knownTop: ['dev', 'test', 'prod', 'staging'],
    what: 'Compiled code from `mix compile`.', after: rebuilt('mix') },
  { id: 'cmake-debug', name: 'cmake-build-debug', category: 'build', label: 'CMake build folder', markers: ['CMakeLists.txt'], inside: ['CMakeCache.txt'], heavy: true,
    what: 'A CMake build folder (CLion creates these).', after: 'CMake configures and compiles again on the next build.' },
  { id: 'cmake-release', name: 'cmake-build-release', category: 'build', label: 'CMake build folder', markers: ['CMakeLists.txt'], inside: ['CMakeCache.txt'], heavy: true,
    what: 'A CMake build folder (CLion creates these).', after: 'CMake configures and compiles again on the next build.' },

  // ---- Dependencies installed inside a project
  { id: 'node-modules', name: 'node_modules', category: 'deps', label: 'node_modules', markers: ['package.json'] },
  { id: 'venv', name: '.venv', category: 'deps', label: 'Python virtual environment', markers: [...PY, 'uv.lock', 'poetry.lock'], inside: ['pyvenv.cfg'],
    locks: [['uv.lock', 'uv sync'], ['poetry.lock', 'poetry install'], ['Pipfile.lock', 'pipenv install'], ['requirements.txt', 'pip install -r requirements.txt']], exactLocks: ['uv.lock', 'poetry.lock', 'Pipfile.lock'] },
  { id: 'venv-plain', name: 'venv', category: 'deps', label: 'Python virtual environment', markers: [...PY, 'uv.lock', 'poetry.lock'], inside: ['pyvenv.cfg'],
    locks: [['uv.lock', 'uv sync'], ['poetry.lock', 'poetry install'], ['Pipfile.lock', 'pipenv install'], ['requirements.txt', 'pip install -r requirements.txt']], exactLocks: ['uv.lock', 'poetry.lock', 'Pipfile.lock'] },
  { id: 'pods', name: 'Pods', category: 'deps', label: 'CocoaPods', markers: ['Podfile'], inside: ['Manifest.lock'],
    locks: [['Podfile.lock', 'pod install']], exactLocks: ['Podfile.lock'], noAutoSelect: true },
  { id: 'composer', name: 'vendor', category: 'deps', label: 'Composer packages', markers: ['composer.json'], inside: ['composer/installed.json'], generic: true,
    locks: [['composer.lock', 'composer install']], exactLocks: ['composer.lock'], noAutoSelect: true },
  { id: 'mix-deps', name: 'deps', category: 'deps', label: 'Mix dependencies', markers: ['mix.exs'], generic: true,
    locks: [['mix.lock', 'mix deps.get']], exactLocks: ['mix.lock'], noAutoSelect: true },
];
const PROJECT_DIR_NAMES = new Set(PROJECT_DIRS.map((d) => d.name));
const specById = (id) => PROJECT_DIRS.find((d) => d.id === id) || null;
/** Entries whose name and markers fit a folder, given the names of the files next to it. */
const specCandidates = (name, siblings) => PROJECT_DIRS.filter((d) => d.name === name && d.markers.some((m) => siblings.has(m)));

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
  {
    key: 'gradle-wrapper', path: `${H}/.gradle/wrapper/dists`, name: 'Gradle versions', action: 'delete',
    what: 'Full copies of Gradle that the Gradle wrapper downloaded, often one per version your projects used.',
    after: 'A project downloads its Gradle version again the next time you build it.',
  },
  {
    key: 'cargo-registry', path: `${H}/.cargo/registry/cache`, name: 'Cargo downloaded crates', action: 'delete',
    what: 'Rust packages (crates) Cargo downloaded.',
    after: 'Cargo downloads crates again when a project needs them.',
  },
  {
    key: 'cargo-src', path: `${H}/.cargo/registry/src`, name: 'Cargo unpacked crates', action: 'delete',
    what: 'Unpacked source code of downloaded Rust crates.',
    after: 'Cargo unpacks them again on the next build.',
  },
  {
    key: 'cargo-git', path: `${H}/.cargo/git/checkouts`, name: 'Cargo git dependencies', action: 'delete',
    what: 'Checkouts of Rust dependencies that come from git repositories.',
    after: 'Cargo fetches them again on the next build.',
  },
  {
    key: 'maven', path: `${H}/.m2/repository`, name: 'Maven repository', action: 'empty', risk: 'check',
    what: 'Java libraries Maven downloaded, plus anything you installed yourself with `mvn install`.',
    after: 'Maven downloads libraries again on the next build.',
    note: 'Anything you installed by hand with `mvn install` or `install:install-file` (for example a vendor SDK or a database driver jar) cannot be downloaded again. Leave this alone unless you know everything here comes from a public repository.',
    lose: 'Possibly: libraries from public repositories download again, but anything you installed by hand cannot. See the note.',
  },
  {
    key: 'composer', path: `${H}/Library/Caches/composer`, name: 'Composer download cache', action: 'empty',
    what: 'PHP packages downloaded by Composer.',
    after: 'Composer downloads packages again when a project needs them.',
  },
  {
    key: 'xcode-device-support', path: `${H}/Library/Developer/Xcode/iOS DeviceSupport`, name: 'Xcode device support files', action: 'empty', risk: 'check',
    what: 'Debug symbols Xcode copies from each iPhone or iPad you connect, one folder per iOS version.',
    after: 'Xcode copies them again the next time you connect a device for debugging, which takes a few minutes.',
    lose: 'Only symbols for iOS versions that none of your devices run any more: those cannot be copied again. You need them only to read old crash reports.',
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
  /^ms-playwright$/i, /^Cypress$/i, /^CocoaPods$/i, /^composer$/i,
  /clearspace/i,
];

const INSTALLER_EXT = /\.(dmg|pkg|iso|xip|zip|tar|tgz|gz|rar|7z)$/i;

module.exports = { CATEGORIES, PROJECT_DIRS, PROJECT_DIR_NAMES, COVERAGE_FILES, specById, specCandidates, DEV_CACHES, APP_CACHE_TEXT, APP_CACHE_SKIP, INSTALLER_EXT, SAFE_APP_CACHES, APP_CACHE_WARNINGS, APP_CACHE_UNKNOWN };
