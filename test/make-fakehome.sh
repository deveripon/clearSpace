#!/bin/bash
# Builds a throwaway fake home folder for engine tests. Usage: test/make-fakehome.sh <dir>
set -e
T="$1"; [ -n "$T" ] || { echo "usage: $0 <dir>"; exit 1; }
case "$T" in *fakehome*) ;; *) echo "dir must contain 'fakehome'"; exit 1;; esac
rm -rf "$T"; mkdir -p "$T"; export HOME="$T"; cd "$T"
old(){ local d=$1; shift; local t; if date -v-1d >/dev/null 2>&1; then t=$(date -v-${d}d +%Y%m%d%H%M); else t=$(date -d "$d days ago" +%Y%m%d%H%M); fi; touch -t "$t" "$@"; }
mk(){ mkdir -p "$(dirname "$1")"; head -c $(( $2 * 1024 * 1024 )) /dev/urandom > "$1"; }
P=$T/Projects
mkdir -p $P/projA/src; echo '{}' > $P/projA/package.json; touch $P/projA/pnpm-lock.yaml; echo x > $P/projA/src/a.ts
mk $P/projA/node_modules/pkg/big.bin 3; mk $P/projA/.next/cache/c.bin 2; mk $P/projA/coverage/r.bin 1; echo TN: > $P/projA/coverage/lcov.info
old 60 $P/projA/package.json $P/projA/pnpm-lock.yaml $P/projA/src/a.ts
mkdir -p $P/projB; echo '{}' > $P/projB/package.json; echo '{}' > $P/projB/turbo.json; touch $P/projB/package-lock.json
mk $P/projB/node_modules/x/x.bin 2; mk $P/projB/.turbo/cache/t.bin 2
M=$P/mono; mkdir -p $M/apps/web $M/packages/ui; echo '{}' > $M/package.json; touch $M/pnpm-lock.yaml; echo '{}' > $M/apps/web/package.json; echo '{}' > $M/packages/ui/package.json; printf 'packages:\n  - apps/*\n  - packages/*\n' > $M/pnpm-workspace.yaml
mk $M/node_modules/a/a.bin 2; mk $M/apps/web/node_modules/b/b.bin 1; mk $M/apps/web/.next/dev/d.bin 3; mk $M/packages/ui/.turbo/x.bin 1; mk $M/.turbo/cache/y.bin 2
old 30 $M/package.json $M/pnpm-lock.yaml $M/apps/web/package.json $M/packages/ui/package.json
mkdir -p $P/nolock; echo '{}' > $P/nolock/package.json; mk $P/nolock/node_modules/z.bin 2; old 90 $P/nolock/package.json
R=$P/repo; mkdir -p $R; cd $R; git init -q -b main; git config user.email t@t; git config user.name t; echo '{}' > package.json; printf 'node_modules\n' > .gitignore; git add .; git commit -qm init
git worktree add -q .claude/worktrees/agent-clean -b wt-clean; cd .claude/worktrees/agent-clean; echo hi > f.txt; git add .; git commit -qm 'wt commit'; mk node_modules/n.bin 2; cd $R
git worktree add -q .claude/worktrees/agent-dirty -b wt-dirty; echo dirty > .claude/worktrees/agent-dirty/package.json; mk .claude/worktrees/agent-dirty/big.bin 1
cd $P; cp -a repo "repo copy"
ln -s /etc $P/linkdir; ln -s $P/projA/src $P/projB/node_modules_link
mk $T/Library/Caches/com.google.Chrome/c.bin 6; mk $T/Library/Caches/com.apple.Safari/s.bin 6; mk $T/Library/Caches/Yarn/y.bin 2; mk $T/Library/Caches/tiny/t.bin 1
mk $T/Library/Logs/l.log 6; mk $T/.npm/_cacache/c.bin 2
mk $T/Downloads/big.dmg 60; mk $T/Downloads/note.txt 1; mkdir -p $T/.Trash
# ---- edge cases from the safety review
touch $P/package-lock.json   # stray lockfile at the scan root must not swallow other projects
E=$P/edge; mkdir -p $E; cd $E; git init -q -b main; git config user.email t@t; git config user.name t
echo '{}' > package.json; printf 'node_modules\n.env\n' > .gitignore; echo 'SECRET=1' > .env
mk coverage/report.bin 2; git add -f .gitignore package.json coverage; git commit -qm init   # tracked coverage: never cleaned
# relative back-pointer + uncommitted change
git worktree add -q .claude/worktrees/rel-dirty -b rel-dirty; echo change > .claude/worktrees/rel-dirty/package.json; mk .claude/worktrees/rel-dirty/node_modules/x.bin 1
echo "gitdir: ../../../.git/worktrees/rel-dirty" > .claude/worktrees/rel-dirty/.git
echo "../../../.claude/worktrees/rel-dirty/.git" > .git/worktrees/rel-dirty/gitdir
# untracked file while the repo hides untracked files
git worktree add -q .claude/worktrees/hidden-untracked -b hidden-untracked; echo notes > .claude/worktrees/hidden-untracked/notes.md
# detached HEAD with a commit on no branch
git worktree add -q --detach .claude/worktrees/detached; (cd .claude/worktrees/detached && echo d > d.txt && git add d.txt && git commit -qm detached)
# ignored .env: unique vs identical to the main project
git worktree add -q .claude/worktrees/env-unique -b env-unique; echo 'SECRET=only-here' > .claude/worktrees/env-unique/.env
git worktree add -q .claude/worktrees/env-same -b env-same; cp .env .claude/worktrees/env-same/.env; mk .claude/worktrees/env-same/node_modules/n.bin 1
# a full clone sitting in the worktrees folder
git clone -q $E .claude/worktrees/clone; echo mine > .claude/worktrees/clone/notes.txt
# hand-written note inside an ignored build/ folder => not preselected, named
printf 'build/\n' >> .git/info/exclude
git worktree add -q .claude/worktrees/build-notes -b build-notes; mkdir -p .claude/worktrees/build-notes/build; echo 'my notes' > .claude/worktrees/build-notes/build/notes.md
# tracked file hidden with skip-worktree
git worktree add -q .claude/worktrees/skipwt -b skipwt; (cd .claude/worktrees/skipwt && echo 'token=SECRET' > package.json && git update-index --skip-worktree package.json)
git config status.showUntrackedFiles no
cd $T; ln -s $P $T/devlink   # same folder reachable through a second path
echo "fake home ready at $T"
