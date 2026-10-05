#!/bin/sh
# A small DataLad dataset to click through by hand: history, a datalad run record, a marked version,
# and unsaved changes. Usage: scripts/make-sample-project.sh [folder]   (default ~/dlad-sample)
# Uses its own git identity via env, so your ~/.gitconfig is untouched.
set -eu
root="${1:-$HOME/dlad-sample}"
[ -e "$root" ] && { echo "$root exists; remove it or pass another folder" >&2; exit 1; }
export GIT_AUTHOR_NAME=Sample GIT_AUTHOR_EMAIL=sample@example.org GIT_COMMITTER_NAME=Sample GIT_COMMITTER_EMAIL=sample@example.org
mkdir -p "$root"
study="$root/study"
datalad create -c text2git "$study" >/dev/null
cd "$study"
mkdir code data results
printf 'participant_id,age\nsub-01,24\nsub-02,31\n' > data/participants.csv
head -c 2000000 /dev/urandom > data/scan.bin
printf '# Sample study\nTry: Save, Publish, Free Up Space, Time Machine.\n' > README.md
datalad save -m 'Add data and README' >/dev/null
printf 'import csv\nrows = list(csv.DictReader(open("data/participants.csv")))\nopen("results/mean_age.txt", "w").write(str(sum(int(r["age"]) for r in rows) / len(rows)))\n' > code/mean_age.py
datalad save -m 'Add analysis script' >/dev/null
datalad run -m 'Compute mean age' -i data/participants.csv -o results/mean_age.txt python3 code/mean_age.py >/dev/null
git tag -a v1.0 -m 'First version'
# left unsaved on purpose
echo 'sub-03,29' >> data/participants.csv
echo 'scratch notes' > notes.txt
mkdir -p "$root/backup"   # an empty folder to use as "Add a Remote" target
echo "Open this in the app: $study"
echo "Backup target folder: $root/backup/copy  (choose a NEW folder inside backup)"
