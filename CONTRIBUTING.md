# Contributing to Clearspace

Thanks for helping. Clearspace deletes files, so its contribution rules are stricter than usual. Please read the safety rules before you change anything in `engine/`.

## Getting set up

```bash
git clone https://github.com/deveripon/clearSpace.git
cd clearSpace
npm install
npm start     # runs the app from source
npm test      # must pass before you open a pull request
```

The tests create throwaway "fake home" folders (paths containing `fakehome`) and refuse to run anywhere else. **Never point the engine at your real home folder while experimenting.** Use the fixtures in `test/` or build your own fake home.

## Safety rules (non-negotiable)

1. **Fail closed.** If the code can't tell whether something is safe (git error, timeout, unreadable folder, unexpected file type), the item is locked or not offered. Never default to "safe".
2. **Checked twice.** Every target must pass the scan's checks and again pass `check()` in `engine/clean.js` right before it is touched. A new kind of item needs rules in both places.
3. **No symlinks.** A path must resolve to itself (`realpath(p) === p`), and it must still be the same folder (device and inode) at the moment it is removed.
4. **Opt-in for anything uncertain.** New items default to `risk: 'check'` and `recommended: false`. Only data that can be recreated with no user effort may be `safe` and preselected.
5. **Recoverable when in doubt.** Prefer moving to the Trash over deleting, for anything that could contain user files.
6. **Git is read-only during scans.** Use `git()` from `engine/util.js`, which disables hooks and fsmonitor and takes no locks. Never run git commands that change a repository, except `git worktree remove` without `--force` and the backup refs in `backupHistory()`.
7. **Honest text.** Every item answers "What it is", "After cleaning" and "Will you lose anything?". Don't understate a risk.
8. **A test for every fix.** Every safety bug fix comes with a regression test in `test/safety.test.js` that fails without the fix.

## Adding a cache to the known-safe list

`SAFE_APP_CACHES` in `engine/catalog.js` decides which `~/Library/Caches` folders are preselected. To add one, explain in your pull request:

- which app owns it,
- that it holds only re-creatable data (no offline downloads, history, databases, models or sync state),
- where that app keeps its real data instead (usually Application Support or Group Containers).

## Code style

- Plain Node.js and browser JavaScript, no build step, and no runtime dependencies in `engine/`.
- Small functions with comments that explain *why*.
- UI text in sentence case, plain words, active voice.

## Pull requests

1. Fork, then create a branch from `main`.
2. Keep each pull request focused on one change.
3. Run `npm test`. For UI changes, include a screenshot. `python3 test/shots.py` renders the UI with mock data.
4. Describe what changed and, for engine changes, how you made sure nothing necessary can be deleted.

## Reporting a safety or security problem

If Clearspace offered, or could offer, to delete something it shouldn't, please report it through GitHub's **private vulnerability reporting** (Security tab → Report a vulnerability), or open an issue if it isn't sensitive. Include the folder layout needed to reproduce it. Real data isn't required: a script that builds a fake home is ideal.
