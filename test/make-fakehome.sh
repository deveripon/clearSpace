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
# ---- other stacks
S=$P/stacks; mkdir -p $S
TAG='Signature: 8a477f597d28d172789f06886806bc55'
mkdir -p $S/rust-cli/src; echo '[package]' > $S/rust-cli/Cargo.toml; echo 'fn main(){}' > $S/rust-cli/src/main.rs; mk $S/rust-cli/target/debug/app.bin 3; echo "$TAG" > $S/rust-cli/target/CACHEDIR.TAG
old 40 $S/rust-cli/Cargo.toml $S/rust-cli/src/main.rs
mkdir -p $S/rust-live/src; echo '[package]' > $S/rust-live/Cargo.toml; echo 'fn main(){}' > $S/rust-live/src/main.rs; mk $S/rust-live/target/debug/app.bin 2; echo "$TAG" > $S/rust-live/target/CACHEDIR.TAG
mkdir -p $S/rust-odd; echo '[package]' > $S/rust-odd/Cargo.toml; mk $S/rust-odd/target/mine.bin 2          # no CACHEDIR.TAG: not offered
mk $S/photos/target/pic.bin 2                                                                              # no Cargo.toml: not offered
SP=lib/python3.12/site-packages
mkdir -p $S/py-app; echo '[project]' > $S/py-app/pyproject.toml; printf '[[package]]\nname = "requests"\n' > $S/py-app/uv.lock; mk $S/py-app/.venv/$SP/requests/x.bin 2; echo 'home = /usr/bin' > $S/py-app/.venv/pyvenv.cfg
mkdir -p $S/py-app/.venv/$SP/requests-2.32.dist-info; printf 'requests/x.bin,sha256=x,2097152\nrequests-2.32.dist-info/RECORD,,\n' > $S/py-app/.venv/$SP/requests-2.32.dist-info/RECORD
mk $S/py-app/.pytest_cache/v/x.bin 1; echo "$TAG" > $S/py-app/.pytest_cache/CACHEDIR.TAG; old 30 $S/py-app/pyproject.toml $S/py-app/uv.lock
mkdir -p $S/py-req; echo 'requests' > $S/py-req/requirements.txt; mk $S/py-req/venv/$SP/req/y.bin 2; echo 'home = /usr/bin' > $S/py-req/venv/pyvenv.cfg; old 30 $S/py-req/requirements.txt
mkdir -p $S/py-req/venv/$SP/req-1.0.dist-info; printf 'req/y.bin,sha256=x,2097152\n' > $S/py-req/venv/$SP/req-1.0.dist-info/RECORD
# a package file patched after install => Check first, named
mkdir -p $S/py-patched; echo '[project]' > $S/py-patched/pyproject.toml; printf '[[package]]\nname = "lib1"\n' > $S/py-patched/uv.lock; mk $S/py-patched/.venv/$SP/lib1/core.bin 2; echo 'home = /usr/bin' > $S/py-patched/.venv/pyvenv.cfg
mkdir -p $S/py-patched/.venv/$SP/lib1-1.0.dist-info; printf 'lib1/core.bin,sha256=x,2097152\n' > $S/py-patched/.venv/$SP/lib1-1.0.dist-info/RECORD; old 2 $S/py-patched/.venv/pyvenv.cfg $S/py-patched/.venv/$SP/lib1/core.bin $S/py-patched/.venv/$SP/lib1-1.0.dist-info/RECORD $S/py-patched/.venv/$SP/lib1-1.0.dist-info
echo 'print("debug")' > $S/py-patched/.venv/$SP/lib1/patched.py; old 30 $S/py-patched/pyproject.toml $S/py-patched/uv.lock
# an older edit (size differs from RECORD) hidden behind a later install of another package
mkdir -p $S/py-older; echo '[project]' > $S/py-older/pyproject.toml; printf '[[package]]\nname = "lib1"\n[[package]]\nname = "lib2"\n' > $S/py-older/uv.lock; mkdir -p $S/py-older/.venv; echo 'home = /usr/bin' > $S/py-older/.venv/pyvenv.cfg
mk $S/py-older/.venv/$SP/lib1/core.bin 2; mkdir -p $S/py-older/.venv/$SP/lib1-1.0.dist-info; printf 'lib1/core.bin,sha256=x,1000\n' > $S/py-older/.venv/$SP/lib1-1.0.dist-info/RECORD
mk $S/py-older/.venv/$SP/lib2/b.bin 1; mkdir -p $S/py-older/.venv/$SP/lib2-1.0.dist-info; printf 'lib2/b.bin,sha256=x,1048576\n' > $S/py-older/.venv/$SP/lib2-1.0.dist-info/RECORD
old 30 $S/py-older/pyproject.toml $S/py-older/uv.lock
# hand files in .venv/bin and .venv/share (not the environment's own scripts, not in any RECORD)
mkdir -p $S/py-bin/.venv/bin $S/py-bin/.venv/share/mine; echo '[project]' > $S/py-bin/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-bin/uv.lock; echo 'home = /usr/bin' > $S/py-bin/.venv/pyvenv.cfg
mk $S/py-bin/.venv/$SP/m/m.bin 1; mkdir -p $S/py-bin/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n../../../bin/mtool,sha256=x,3\n' > $S/py-bin/.venv/$SP/m-1.0.dist-info/RECORD
echo hi > $S/py-bin/.venv/bin/mtool; touch $S/py-bin/.venv/bin/activate $S/py-bin/.venv/bin/python3; echo 'deploy' > $S/py-bin/.venv/bin/deploy.sh; echo n > $S/py-bin/.venv/share/mine/notes.txt; old 30 $S/py-bin/pyproject.toml $S/py-bin/uv.lock
# fourth review: edited activate script, look-alike script name, loose file in lib/, package not in the lockfile
mkdir -p $S/py-act/.venv/bin; echo '[project]' > $S/py-act/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-act/uv.lock; echo 'home = /usr/bin' > $S/py-act/.venv/pyvenv.cfg; touch $S/py-act/.venv/bin/activate
mk $S/py-act/.venv/$SP/m/m.bin 1; mkdir -p $S/py-act/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n' > $S/py-act/.venv/$SP/m-1.0.dist-info/RECORD
old 2 $S/py-act/.venv/pyvenv.cfg $S/py-act/.venv/bin/activate $S/py-act/.venv/$SP/m/m.bin $S/py-act/.venv/$SP/m-1.0.dist-info/RECORD; old 30 $S/py-act/pyproject.toml $S/py-act/uv.lock
echo 'export API_KEY=secret' >> $S/py-act/.venv/bin/activate
mkdir -p $S/py-name/.venv/bin; echo '[project]' > $S/py-name/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-name/uv.lock; echo 'home = /usr/bin' > $S/py-name/.venv/pyvenv.cfg; touch $S/py-name/.venv/bin/activate
mk $S/py-name/.venv/$SP/m/m.bin 1; mkdir -p $S/py-name/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n' > $S/py-name/.venv/$SP/m-1.0.dist-info/RECORD
old 2 $S/py-name/.venv/pyvenv.cfg $S/py-name/.venv/bin/activate $S/py-name/.venv/$SP/m/m.bin $S/py-name/.venv/$SP/m-1.0.dist-info/RECORD; old 30 $S/py-name/pyproject.toml $S/py-name/uv.lock
echo 'deploy' > $S/py-name/.venv/bin/activate-deploy.sh; old 2 $S/py-name/.venv/bin/activate-deploy.sh
mkdir -p $S/py-lib/.venv/bin; echo '[project]' > $S/py-lib/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-lib/uv.lock; echo 'home = /usr/bin' > $S/py-lib/.venv/pyvenv.cfg; touch $S/py-lib/.venv/bin/activate
mk $S/py-lib/.venv/$SP/m/m.bin 1; mkdir -p $S/py-lib/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n' > $S/py-lib/.venv/$SP/m-1.0.dist-info/RECORD
old 2 $S/py-lib/.venv/pyvenv.cfg $S/py-lib/.venv/bin/activate $S/py-lib/.venv/$SP/m/m.bin $S/py-lib/.venv/$SP/m-1.0.dist-info/RECORD; old 30 $S/py-lib/pyproject.toml $S/py-lib/uv.lock
echo notes > $S/py-lib/.venv/lib/NOTES.txt; old 2 $S/py-lib/.venv/lib/NOTES.txt
mkdir -p $S/py-extra/.venv/bin; echo '[project]' > $S/py-extra/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-extra/uv.lock; echo 'home = /usr/bin' > $S/py-extra/.venv/pyvenv.cfg; touch $S/py-extra/.venv/bin/activate
mk $S/py-extra/.venv/$SP/m/m.bin 1; mkdir -p $S/py-extra/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n' > $S/py-extra/.venv/$SP/m-1.0.dist-info/RECORD
old 2 $S/py-extra/.venv/pyvenv.cfg $S/py-extra/.venv/bin/activate $S/py-extra/.venv/$SP/m/m.bin $S/py-extra/.venv/$SP/m-1.0.dist-info/RECORD; old 30 $S/py-extra/pyproject.toml $S/py-extra/uv.lock
mk $S/py-extra/.venv/$SP/extra/e.bin 1; mkdir -p $S/py-extra/.venv/$SP/extra-0.1.dist-info; printf 'extra/e.bin,sha256=x,1048576\n' > $S/py-extra/.venv/$SP/extra-0.1.dist-info/RECORD
old 2 $S/py-extra/.venv/$SP/extra/e.bin $S/py-extra/.venv/$SP/extra-0.1.dist-info/RECORD
mkdir -p $S/py-ok/.venv/bin; echo '[project]' > $S/py-ok/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-ok/uv.lock; echo 'home = /usr/bin' > $S/py-ok/.venv/pyvenv.cfg; touch $S/py-ok/.venv/bin/activate
mk $S/py-ok/.venv/$SP/m/m.bin 1; mkdir -p $S/py-ok/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n' > $S/py-ok/.venv/$SP/m-1.0.dist-info/RECORD
old 2 $S/py-ok/.venv/pyvenv.cfg $S/py-ok/.venv/bin/activate $S/py-ok/.venv/$SP/m/m.bin $S/py-ok/.venv/$SP/m-1.0.dist-info/RECORD; old 30 $S/py-ok/pyproject.toml $S/py-ok/uv.lock
# a Poetry project installs itself into the venv; poetry.lock does not list it
mkdir -p $S/py-poetry/.venv/$SP/acme_api-0.1.0.dist-info $S/py-poetry/.venv/$SP/requests-2.0.dist-info $S/py-poetry/.venv/$SP/requests
printf '[tool.poetry]\nname = "acme-api"\n' > $S/py-poetry/pyproject.toml; printf '[[package]]\nname = "requests"\n' > $S/py-poetry/poetry.lock; echo 'home = /usr/bin' > $S/py-poetry/.venv/pyvenv.cfg
mk $S/py-poetry/.venv/$SP/requests/r.bin 1; printf 'requests/r.bin,sha256=x,1048576\n' > $S/py-poetry/.venv/$SP/requests-2.0.dist-info/RECORD
echo "{\"url\": \"file://$S/py-poetry\", \"dir_info\": {\"editable\": true}}" > $S/py-poetry/.venv/$SP/acme_api-0.1.0.dist-info/direct_url.json
echo "$S/py-poetry/src" > $S/py-poetry/.venv/$SP/acme_api.pth
printf 'acme_api.pth,sha256=x,%s\n' $(wc -c < $S/py-poetry/.venv/$SP/acme_api.pth | tr -d ' ') > $S/py-poetry/.venv/$SP/acme_api-0.1.0.dist-info/RECORD; old 30 $S/py-poetry/pyproject.toml $S/py-poetry/poetry.lock
mkdir -p $S/rs-crit/src; echo '[package]' > $S/rs-crit/Cargo.toml; echo 'fn main(){}' > $S/rs-crit/src/main.rs; mk $S/rs-crit/target/debug/a.bin 1; echo "$TAG" > $S/rs-crit/target/CACHEDIR.TAG
mkdir -p $S/rs-crit/target/criterion/base; echo '{}' > $S/rs-crit/target/criterion/base/estimates.json; old 40 $S/rs-crit/Cargo.toml $S/rs-crit/src/main.rs
# a hand script in .venv/src (pip only clones git checkouts there)
mkdir -p $S/py-src; echo '[project]' > $S/py-src/pyproject.toml; printf '[[package]]\nname = "m"\n' > $S/py-src/uv.lock; mkdir -p $S/py-src/.venv/src; echo x > $S/py-src/.venv/src/myscript.py; echo 'home = /usr/bin' > $S/py-src/.venv/pyvenv.cfg
mk $S/py-src/.venv/$SP/m/m.bin 1; mkdir -p $S/py-src/.venv/$SP/m-1.0.dist-info; printf 'm/m.bin,sha256=x,1048576\n' > $S/py-src/.venv/$SP/m-1.0.dist-info/RECORD; old 30 $S/py-src/pyproject.toml $S/py-src/uv.lock
mkdir -p $S/py-fake; echo '[project]' > $S/py-fake/pyproject.toml; mk $S/py-fake/.venv/data.bin 2        # no pyvenv.cfg: not offered
mkdir -p $S/android-app; echo '' > $S/android-app/build.gradle.kts; mk $S/android-app/build/intermediates/i.bin 2; mk $S/android-app/.gradle/buildOutputCleanup/x.bin 1; old 30 $S/android-app/build.gradle.kts
mkdir -p $S/gradle-libs; echo '' > $S/gradle-libs/build.gradle; mk $S/gradle-libs/build/libs/vendor-sdk.jar 2      # hand-dropped jar, no Gradle output: not offered
AG=$S/android-git; mkdir -p $AG; cd $AG; git init -q -b main; git config user.email t@t; git config user.name t; echo '' > build.gradle; printf 'build/\n' > .gitignore; git add .; git commit -qm init; cd $T
mk $AG/build/tmp/t.bin 2                                                                                    # ignored by git: Safe
NG=$S/gradle-notes; mkdir -p $NG; cd $NG; git init -q -b main; git config user.email t@t; git config user.name t; echo '' > build.gradle; printf 'build/\n' > .gitignore; git add .; git commit -qm init; cd $T
mk $NG/build/tmp/t.bin 1; mkdir -p $NG/build/notes; echo 'my notes' > $NG/build/notes/n.md                     # ignored, but holds notes: Check first
NG2=$S/gradle-docs; mkdir -p $NG2; cd $NG2; git init -q -b main; git config user.email t@t; git config user.name t; echo '' > build.gradle; printf 'build/\n' > .gitignore; git add .; git commit -qm init; cd $T
mk $NG2/build/tmp/t.bin 1; mkdir -p $NG2/build/docs; echo 'notes' > $NG2/build/docs/notes.md                   # docs/ is a name people use: Check first
JA=$S/java-app; mkdir -p $JA/src/main/java/com/acme; cd $JA; git init -q -b main; git config user.email t@t; git config user.name t
echo '<project/>' > pom.xml; echo 'class App {}' > src/main/java/com/acme/App.java; printf 'target/\n' > .gitignore; git add .
GIT_COMMITTER_DATE='2024-01-01T00:00:00' GIT_AUTHOR_DATE='2024-01-01T00:00:00' git commit -qm init; cd $T
old 60 $JA/pom.xml $JA/.gitignore; mk $JA/target/maven-status/m.bin 2; echo 'class App { int x; }' > $JA/src/main/java/com/acme/App.java   # edited today, 5 levels deep
# a big repo with many changes elsewhere must not hide an edit in this project
MO=$S/mono400; mkdir -p $MO/svc/src/main/java/com/acme $MO/aaa; cd $MO; git init -q -b main; git config user.email t@t; git config user.name t
echo '<project/>' > svc/pom.xml; echo 'class A {}' > svc/src/main/java/com/acme/A.java; printf 'target/\n' > .gitignore; for i in $(seq 1 500); do echo $i > aaa/f$i.txt; done; git add .
GIT_COMMITTER_DATE='2024-01-01T00:00:00' GIT_AUTHOR_DATE='2024-01-01T00:00:00' git commit -qm init; cd $T
for i in $(seq 1 500); do echo changed > $MO/aaa/f$i.txt; done; old 60 $MO/aaa/f*.txt $MO/svc/pom.xml $MO/.gitignore
mk $MO/svc/target/maven-status/m.bin 1; echo 'class A { int y; }' > $MO/svc/src/main/java/com/acme/A.java
for v in uni untr; do
  J=$S/java-$v; mkdir -p $J/src/main/java/com/acme; cd $J; git init -q -b main; git config user.email t@t; git config user.name t
  echo '<project/>' > pom.xml; echo 'class App {}' > src/main/java/com/acme/App.java; printf 'target/\n' > .gitignore; git add .
  GIT_COMMITTER_DATE='2024-01-01T00:00:00' GIT_AUTHOR_DATE='2024-01-01T00:00:00' git commit -qm init; cd $T
  old 60 $J/pom.xml $J/.gitignore $J/src/main/java/com/acme/App.java; mk $J/target/maven-status/m.bin 1
done
mkdir -p "$S/java-uni/src/main/java/com/café"; echo 'class F {}' > "$S/java-uni/src/main/java/com/café/F.java"   # new, non-ASCII path
old 60 $S/java-uni/src $S/java-uni/src/main $S/java-uni/src/main/java $S/java-uni/src/main/java/com
mkdir -p $S/java-untr/src/main/java/com/acme/deep/er/still; echo 'class D {}' > $S/java-untr/src/main/java/com/acme/deep/er/still/D.java
old 60 $S/java-untr/src/main/java/com/acme/deep $S/java-untr/src/main/java/com/acme $S/java-untr/src/main/java/com $S/java-untr/src/main/java $S/java-untr/src/main $S/java-untr/src
mkdir -p $S/docs-site; echo '# docs' > $S/docs-site/README.md; mk $S/docs-site/build/index.bin 2       # build/ with no Gradle or Flutter project: not offered
mkdir -p $S/ios-app; touch $S/ios-app/Podfile $S/ios-app/Podfile.lock; mk $S/ios-app/Pods/Alamofire/a.bin 2; printf 'PODS:\n  - Alamofire (5.9.0)\n\nDEPENDENCIES:\n  - Alamofire\n' > $S/ios-app/Pods/Manifest.lock; old 30 $S/ios-app/Podfile $S/ios-app/Podfile.lock
mkdir -p $S/ios-patched; touch $S/ios-patched/Podfile $S/ios-patched/Podfile.lock; mk $S/ios-patched/Pods/Alamofire/a.bin 2; printf 'PODS:\n  - Alamofire (5.9.0)\n' > $S/ios-patched/Pods/Manifest.lock
old 3 $S/ios-patched/Pods/Manifest.lock $S/ios-patched/Pods/Alamofire/a.bin; echo '// debug' > $S/ios-patched/Pods/Alamofire/Session.swift; old 30 $S/ios-patched/Podfile $S/ios-patched/Podfile.lock
mkdir -p $S/ios-extra; touch $S/ios-extra/Podfile $S/ios-extra/Podfile.lock; mk $S/ios-extra/Pods/Alamofire/a.bin 2; mk $S/ios-extra/Pods/MyHelpers/h.bin 1; printf 'PODS:\n  - Alamofire (5.9.0)\n' > $S/ios-extra/Pods/Manifest.lock
mkdir -p $S/ios-top; touch $S/ios-top/Podfile $S/ios-top/Podfile.lock; mk $S/ios-top/Pods/Alamofire/a.bin 2; echo '// mine' > $S/ios-top/Pods/MyHelpers.swift; printf 'PODS:\n  - Alamofire (5.9.0)\n' > $S/ios-top/Pods/Manifest.lock
mkdir -p $S/php-site; echo '{}' > $S/php-site/composer.json; touch $S/php-site/composer.lock; mk $S/php-site/vendor/acme/lib/c.bin 2; touch $S/php-site/vendor/autoload.php
mkdir -p $S/php-site/vendor/composer $S/php-site/vendor/bin; echo '{"packages":[{"name":"acme/lib"}]}' > $S/php-site/vendor/composer/installed.json
printf "<?php\ninclude __DIR__ . '/..'.'/acme/lib/bin/tool';\n" > $S/php-site/vendor/bin/tool        # Composer proxy script: fine
for v in topfile bin; do mkdir -p $S/php-$v/vendor/composer $S/php-$v/vendor/bin; echo '{}' > $S/php-$v/composer.json; touch $S/php-$v/composer.lock; mk $S/php-$v/vendor/acme/lib/c.bin 1
  echo '{"packages":[{"name":"acme/lib"}]}' > $S/php-$v/vendor/composer/installed.json; touch $S/php-$v/vendor/autoload.php; done
echo '<?php // mine' > $S/php-topfile/vendor/helpers.php; echo 'deploy' > $S/php-bin/vendor/bin/deploy.sh
mkdir -p $S/php-legacy; echo '{}' > $S/php-legacy/composer.json; touch $S/php-legacy/composer.lock; mk $S/php-legacy/vendor/acme/lib/c.bin 1; mk $S/php-legacy/vendor/acme-legacy/Lib.bin 1
mkdir -p $S/php-legacy/vendor/composer; echo '{"packages":[{"name":"acme/lib"}]}' > $S/php-legacy/vendor/composer/installed.json   # acme-legacy is not a Composer package: locked
mkdir -p $S/ex-app; echo 'defmodule' > $S/ex-app/mix.exs; printf '%%{\n  "jason": {:hex, :jason, "1.4.0"},\n}\n' > $S/ex-app/mix.lock
mk $S/ex-app/deps/jason/j.bin 1; touch $S/ex-app/deps/jason/.hex; mk $S/ex-app/deps/hiredis/hiredis.bin 1   # hiredis is not in mix.lock: locked
mkdir -p $S/ex-notes; echo 'defmodule' > $S/ex-notes/mix.exs; mk $S/ex-notes/_build/my-release-notes.bin 1   # no _build/<env>/lib: not offered
G=$S/vendored; mkdir -p $G; cd $G; git init -q -b main; git config user.email t@t; git config user.name t
echo '{}' > composer.json; mk vendor/acme/lib/lib.bin 2; mkdir -p vendor/composer; echo '{"packages":[{"name":"acme/lib"}]}' > vendor/composer/installed.json; git add .; git commit -qm init; cd $T   # vendor tracked by git: never offered
mkdir -p $S/swift-pkg; touch $S/swift-pkg/Package.swift; mk $S/swift-pkg/.build/debug/x.bin 2; echo '{}' > $S/swift-pkg/.build/workspace-state.json
B="$T/Library/Application Support/MobileSync/Backup"
mk "$B/00008030-TEST/aa/f.bin" 60
printf '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Device Name</key><string>Test iPhone</string><key>Product Name</key><string>iPhone 13</string><key>Last Backup Date</key><date>2025-01-01T10:00:00Z</date></dict></plist>\n' > "$B/00008030-TEST/Info.plist"
mk "$B/not-a-backup/x.bin" 60                                                                              # no Info.plist: not listed
mk $T/.cargo/registry/cache/c.bin 2; mk $T/.m2/repository/r.bin 2; mk $T/.gradle/wrapper/dists/g.bin 2
cd $T; ln -s $P $T/devlink   # same folder reachable through a second path
echo "fake home ready at $T"
