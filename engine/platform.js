'use strict';
/**
 * Everything that differs between macOS and Windows: where things live, what they are called,
 * and how paths compare. The rest of the engine asks this module instead of hard-coding either system.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const SEP = path.sep;

/** The canonical spelling of a folder (true letter case on Windows), or the input when it does not exist. */
function real(p) {
  if (!IS_WIN) return p;
  try { return fs.realpathSync.native(p); } catch { return p; }
}

const HOME = real(os.homedir());
const LOCAL = IS_WIN ? real(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local')) : null;
const ROAMING = IS_WIN ? real(process.env.APPDATA || path.join(HOME, 'AppData', 'Roaming')) : null;
const SYSTEM_DRIVE = IS_WIN ? (process.env.SystemDrive || 'C:').toUpperCase() + '\\' : '/';

/** Windows paths compare without letter case (NTFS is case-insensitive); macOS paths compare exactly as before. */
const key = (p) => (IS_WIN ? p.toLowerCase() : p);
const samePath = (a, b) => key(a) === key(b);
function isInside(child, parent) {
  const c = key(child);
  const p = key(parent);
  return c !== p && c.startsWith(p.endsWith(SEP) ? p : p + SEP);
}
/** `child` is `parent` or inside it. */
const within = (child, parent) => samePath(child, parent) || isInside(child, parent);

/** Path segments below `base` (for "is this inside a hidden or system folder" checks). */
const segmentsBelow = (p, base) => p.slice(base.length).split(SEP).filter(Boolean);

// ---------------------------------------------------------------- where things live
const DOWNLOADS = path.join(HOME, 'Downloads');
/** macOS: ~/.Trash. Windows: the Recycle Bin of the system drive (emptied through the Windows shell, never by hand). */
const TRASH = IS_WIN ? path.join(SYSTEM_DRIVE, '$Recycle.Bin') : path.join(HOME, '.Trash');
/** Where iTunes / Finder / Apple Devices keep iPhone and iPad backups. */
const BACKUPS = IS_WIN
  ? [path.join(ROAMING, 'Apple Computer', 'MobileSync', 'Backup'), path.join(HOME, 'Apple', 'MobileSync', 'Backup')]
  : [path.join(HOME, 'Library', 'Application Support', 'MobileSync', 'Backup')];
/** macOS: one folder per app in ~/Library/Caches. Windows has no such folder (see WIN_APP_CACHES in catalog.js). */
const MAC_CACHES = IS_WIN ? null : path.join(HOME, 'Library', 'Caches');
/** Logs and crash reports apps write. */
const LOGS = IS_WIN ? path.join(LOCAL, 'CrashDumps') : path.join(HOME, 'Library', 'Logs');
/** The first folder under home that holds app and system data. */
const APP_DATA_NAME = IS_WIN ? 'AppData' : 'Library';

/** Folders that must never be removed or emptied themselves, whatever an item says. */
function systemProtected() {
  const h = (...p) => path.join(HOME, ...p);
  const common = [HOME, DOWNLOADS, h('Desktop'), h('Documents'), h('.cache'), h('.ssh'), h('.config'),
    h('.cargo'), h('.m2'), h('.gradle'), ...BACKUPS, ...BACKUPS.map((b) => path.dirname(b))];
  if (!IS_WIN) {
    return ['/', h('Library'), MAC_CACHES, TRASH, h('Library', 'Application Support'), h('Library', 'Mobile Documents'),
      h('Library', 'CloudStorage'), ...common];
  }
  return [SYSTEM_DRIVE, h('AppData'), LOCAL, ROAMING, h('AppData', 'LocalLow'), h('OneDrive'), h('Pictures'), h('Music'),
    h('Videos'), h('Favorites'), h('Contacts'), h('Links'), h('Saved Games'), h('Searches'), h('.nuget'), h('scoop'),
    path.join(LOCAL, 'Microsoft'), path.join(ROAMING, 'Microsoft'), path.join(LOCAL, 'Packages'), path.join(LOCAL, 'Programs'), ...common];
}

/** Top-level folders of a Windows drive that hold the system, programs or other users' data. */
const WIN_SYSTEM_TOP = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'users', 'recovery',
  'system volume information', '$recycle.bin', 'config.msi', 'perflogs', 'msocache', 'intel', 'amd', 'nvidia', 'boot',
  'games', 'docker data', 'wsl']);
/**
 * Folders that hold installed programs and games, at any depth on a Windows drive. Their node_modules or build
 * folders belong to the installed program, so Clearspace never looks inside them.
 */
const WIN_PROGRAM_DIRS = new Set(['windows', 'program files', 'program files (x86)', 'programdata', 'system volume information',
  '$recycle.bin', 'config.msi', 'msocache', 'steamlibrary', 'steamapps', 'steam', 'epic games', 'xboxgames', 'windowsapps',
  'wpsystem', 'riot games', 'ea games', 'ubisoft', 'gog galaxy', 'battle.net']);
const isProgramDir = (name) => IS_WIN && WIN_PROGRAM_DIRS.has(name.toLowerCase());
/** Off limits on a Windows drive: system folders at its top, and program folders at any depth. `segs` are below the drive root. */
const inSystemArea = (segs) => IS_WIN && segs.length > 0 && (WIN_SYSTEM_TOP.has(segs[0].toLowerCase()) || segs.some(isProgramDir));

/**
 * Why a folder cannot be used as a project folder, or null when it can.
 * macOS: inside home only. Windows: inside home, or on another drive (many people keep code on D:),
 * but never a whole drive, a system or program folder, or the system drive outside home.
 */
function rootProblem(realPath) {
  if (IS_WIN && realPath.startsWith('\\\\')) return 'network folders are not supported';
  if (isInside(realPath, HOME)) {
    const segs = segmentsBelow(realPath, HOME);
    if (segs[0].toLowerCase() === APP_DATA_NAME.toLowerCase()) return `the ${APP_DATA_NAME} folder holds app and system data`;
    if (segs[0].startsWith('.')) return 'hidden folders hold tools and settings';
    if (segs.some((seg) => seg.endsWith('.app'))) return 'it is inside an application';
    return null;
  }
  if (!IS_WIN || samePath(realPath, HOME)) return 'choose a folder inside your home folder, not the home folder itself';
  if (isInside(HOME, realPath)) return 'it contains your home folder; choose a folder inside it instead';
  const root = path.parse(realPath).root;
  if (samePath(root, SYSTEM_DRIVE)) return 'on the system drive, choose a folder inside your home folder';
  // A whole data drive (D:\) is fine: system and program folders on it are skipped while scanning.
  if (samePath(root, realPath)) return null;
  const segs = segmentsBelow(realPath, root);
  if (inSystemArea(segs)) return 'it holds Windows, programs, games or system data';
  if (segs.some((seg) => seg.startsWith('.') || seg.startsWith('$'))) return 'hidden folders hold tools and settings';
  return null;
}

/** The folder whose subfolders decide whether `p` is in a tool or system area: home, or the drive for other drives. */
const areaBase = (p) => (isInside(p, HOME) ? HOME : path.parse(p).root);

// ---------------------------------------------------------------- words
const WORDS = IS_WIN
  ? { os: 'Windows', computer: 'PC', trash: 'Recycle Bin', fileManager: 'File Explorer', appData: 'AppData' }
  : { os: 'macOS', computer: 'Mac', trash: 'Trash', fileManager: 'Finder', appData: 'Library' };

/** Folders a file manager made by copying: "name copy", "name copy 2" (Finder), "name - Copy", "name - Copy (2)" (File Explorer). */
const COPY_RE = IS_WIN ? /^(.+?)(?: - Copy(?: \(\d+\))?| copy(?: \d+)?)$/ : /^(.+?) copy(?: \d+)?$/;

/**
 * The on-disk letter case of a path Clearspace built itself (C:\Users\me\AppData\Local\pip\Cache, not ...\pip\cache).
 * Only the case is taken over: when the real path differs in more than case (a link or junction), `p` is kept
 * unchanged, so the "no link anywhere along the path" checks still refuse it.
 */
function canonicalCase(p) {
  if (!IS_WIN) return p;
  try { const r = fs.realpathSync.native(p); return samePath(r, p) ? r : p; } catch { return p; }
}

/** A name for the disk that holds `p` (home by default). */
const diskName = (p = HOME) => (IS_WIN ? `Local Disk (${path.parse(p).root.slice(0, 2).toUpperCase()})` : 'Macintosh HD');

module.exports = {
  IS_WIN, SEP, HOME, LOCAL, ROAMING, SYSTEM_DRIVE, DOWNLOADS, TRASH, BACKUPS, MAC_CACHES, LOGS, APP_DATA_NAME, WORDS, COPY_RE,
  key, samePath, isInside, within, segmentsBelow, systemProtected, rootProblem, areaBase, diskName, real, canonicalCase, isProgramDir, inSystemArea, WIN_SYSTEM_TOP,
};
