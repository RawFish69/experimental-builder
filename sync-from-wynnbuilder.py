"""
Sync data from wynnbuilder-beta into build-solver.

Modes:
  GitHub (default) — fetches directly from GitHub, no local clone needed:
      python sync-from-wynnbuilder.py
      python sync-from-wynnbuilder.py --dry-run
      python sync-from-wynnbuilder.py --token ghp_xxxx   # avoids 60 req/hr rate limit

  Local clone — uses a local wynnbuilder-beta repo:
      python sync-from-wynnbuilder.py --local <path-to-wynnbuilder-repo>
      python sync-from-wynnbuilder.py --local <path> --no-pull

  Both modes support:
      --bump-version 2.2.0.25   update the 3 code constants to that version
      --dry-run                 print what would change, write nothing

How it works (GitHub mode):
  1. Fetches the full repo file tree in ONE API call (blob SHAs included).
  2. Computes the Git blob SHA of each tracked local file.
  3. Downloads only files whose SHA differs from local — skips unchanged files.
  4. Reads wynn_version_names from js/load_item.js to derive WYNN_VERSION_LATEST index.
"""

import argparse
import hashlib
import re
import shutil
import subprocess
import sys
import urllib.request
import urllib.error
import json
from pathlib import Path

SOLVER_ROOT = Path(__file__).parent

GITHUB_REPO  = "wynnbuilder-beta/wynnbuilder-beta.github.io"
GITHUB_BRANCH = "master"
RAW_BASE = f"https://raw.githubusercontent.com/{GITHUB_REPO}/{GITHUB_BRANCH}"
API_BASE  = f"https://api.github.com/repos/{GITHUB_REPO}"

ROOT_FILES_TO_SYNC = [
    "compress.json",
    "clean.json",
    "ingreds_clean.json",
    "ingreds_compress.json",
    "recipes_clean.json",
    "recipes_compress.json",
    "tomes.json",
    "tome_map.json",
    "dps_data.json",
    "items_compress.json",
    "recipes.json",
    "maploc_clean.json",
    "maploc_compress.json",
    "terrs_clean.json",
    "terrs_compress.json",
    "skillpoints.csv",
]

VERSION_FOLDER_FILES = [
    "items.json",
    "ingreds.json",
    "atree.json",
    "aspects.json",
    "majid.json",
    "tomes.json",
    "recipes.json",
    "dps_data.json",
    "encoding_consts.json",
]

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+\.\d+$")

CODE_FILES = [
    (
        SOLVER_ROOT / "frontend/src/domain/ability-tree/catalog-service.ts",
        r"(const LATEST_ATREE_VERSION = ')[^']+(')",
    ),
    (
        SOLVER_ROOT / "frontend/vite.config.ts",
        r"(const latestAtreeVersion = ')[^']+(')",
    ),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def is_version(name: str) -> bool:
    return bool(VERSION_RE.match(name))


def sorted_versions(dirs):
    return sorted(dirs, key=lambda v: tuple(int(x) for x in v.split(".")))


def local_versions() -> list[str]:
    data_dir = SOLVER_ROOT / "data"
    return sorted_versions([d.name for d in data_dir.iterdir() if d.is_dir() and is_version(d.name)])


def git_blob_sha(data: bytes) -> str:
    header = f"blob {len(data)}\0".encode()
    return hashlib.sha1(header + data).hexdigest()


def local_blob_sha(path: Path) -> str | None:
    if not path.exists():
        return None
    return git_blob_sha(path.read_bytes())


def api_request(url: str, token: str | None) -> dict:
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read().decode())


def fetch_raw(path: str, token: str | None) -> bytes:
    url = f"{RAW_BASE}/{path}"
    req = urllib.request.Request(url)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req) as resp:
        return resp.read()


def write_file(dst: Path, data: bytes, dry: bool, label: str):
    if dry:
        print(f"  [dry] would update {label}")
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(data)
        print(f"  updated {label}")


# ---------------------------------------------------------------------------
# Version index lookup (reads wynn_version_names from load_item.js)
# ---------------------------------------------------------------------------

def find_version_index_from_text(js_text: str, version: str) -> int | None:
    m = re.search(r"const wynn_version_names\s*=\s*\[(.*?)\];", js_text, re.DOTALL)
    if not m:
        return None
    names = re.findall(r"'([^']+)'", m.group(1))
    try:
        return names.index(version)
    except ValueError:
        return None


def bump_code(version: str, dry: bool, load_item_js: str | None):
    changed = False
    for path, pattern in CODE_FILES:
        text = path.read_text(encoding="utf-8")
        new_text = re.sub(pattern, lambda m: m.group(1) + version + m.group(2), text)
        if new_text != text:
            if dry:
                print(f"  [dry] would update version string in {path.name} → '{version}'")
            else:
                path.write_text(new_text, encoding="utf-8")
                print(f"  updated {path.name} → '{version}'")
            changed = True

    encoder = SOLVER_ROOT / "frontend/src/domain/build/build-encoder.ts"
    idx = None
    if load_item_js:
        idx = find_version_index_from_text(load_item_js, version)
    if idx is not None:
        text = encoder.read_text(encoding="utf-8")
        new_text = re.sub(
            r"(const WYNN_VERSION_LATEST\s*=\s*)\d+(;.*)",
            lambda m: f"{m.group(1)}{idx}{m.group(2)}",
            text,
        )
        if new_text != text:
            if dry:
                print(f"  [dry] would set WYNN_VERSION_LATEST = {idx} in build-encoder.ts")
            else:
                encoder.write_text(new_text, encoding="utf-8")
                print(f"  set WYNN_VERSION_LATEST = {idx} in build-encoder.ts")
            changed = True
    else:
        print(f"  WARNING: could not resolve index for '{version}' in wynn_version_names — update build-encoder.ts manually")

    if not changed:
        print("  (version constants already up to date)")


# ---------------------------------------------------------------------------
# GitHub mode
# ---------------------------------------------------------------------------

def sync_github(dry: bool, token: str | None, bump_version: str | None):
    print(f"Fetching repo tree from GitHub ({GITHUB_REPO})…")
    try:
        tree_data = api_request(
            f"{API_BASE}/git/trees/{GITHUB_BRANCH}?recursive=1", token
        )
    except urllib.error.HTTPError as e:
        if e.code == 403:
            sys.exit("ERROR: GitHub rate limit hit. Pass --token <ghp_...> to authenticate (5000 req/hr).")
        raise

    if tree_data.get("truncated"):
        print("  WARNING: tree was truncated by GitHub — some files may be missed")

    # Build a path → sha map for tracked files
    remote: dict[str, str] = {}
    for entry in tree_data.get("tree", []):
        if entry["type"] == "blob":
            remote[entry["path"]] = entry["sha"]

    # Discover remote versions
    remote_versions = sorted_versions({
        p.split("/")[1]
        for p in remote
        if p.startswith("data/") and p.count("/") >= 2 and is_version(p.split("/")[1])
    })
    solver_versions = set(local_versions())
    latest_version = remote_versions[-1] if remote_versions else None

    print(f"Remote versions : {remote_versions}")
    print(f"Local versions  : {sorted_versions(solver_versions)}")
    print(f"Latest          : {latest_version}\n")

    changed_any = False

    # --- Version folders ---
    print("--- Version folders ---")
    for ver in remote_versions:
        is_missing = ver not in solver_versions
        is_latest  = ver == latest_version
        if not is_missing and not is_latest:
            continue
        for fname in VERSION_FOLDER_FILES:
            remote_path = f"data/{ver}/{fname}"
            local_path  = SOLVER_ROOT / "data" / ver / fname
            remote_sha  = remote.get(remote_path)
            if remote_sha is None:
                continue
            if local_blob_sha(local_path) != remote_sha:
                if dry:
                    print(f"  [dry] would fetch {remote_path}")
                else:
                    data = fetch_raw(remote_path, token)
                    write_file(local_path, data, dry=False, label=remote_path)
                changed_any = True
    if not changed_any:
        print("  (all version folders up to date)")

    # --- Root files ---
    print("\n--- Root-level files ---")
    root_changed = False
    for fname in ROOT_FILES_TO_SYNC:
        remote_sha = remote.get(fname)
        if remote_sha is None:
            continue
        local_path = SOLVER_ROOT / fname
        if local_blob_sha(local_path) != remote_sha:
            if dry:
                print(f"  [dry] would fetch {fname}")
            else:
                data = fetch_raw(fname, token)
                write_file(local_path, data, dry=False, label=fname)
            root_changed = True
    if not root_changed:
        print("  (all root files up to date)")

    # --- Code bump ---
    load_item_js = None
    if bump_version:
        print(f"\n--- Bumping code to version {bump_version} ---")
        raw_js = remote.get("js/load_item.js")
        if raw_js:
            try:
                load_item_js = fetch_raw("js/load_item.js", token).decode("utf-8")
            except Exception:
                pass
        bump_code(bump_version, dry, load_item_js)


# ---------------------------------------------------------------------------
# Local mode
# ---------------------------------------------------------------------------

def sync_local(wynn: Path, dry: bool, no_pull: bool, bump_version: str | None):
    if not (wynn / "data").is_dir():
        sys.exit(f"ERROR: {wynn} doesn't look like a wynnbuilder repo (no data/ folder)")

    if not no_pull:
        print("Pulling wynnbuilder-beta…")
        result = subprocess.run(["git", "pull"], cwd=wynn, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"  WARNING: git pull failed:\n{result.stderr.strip()}")
        else:
            print(f"  {result.stdout.strip() or 'already up to date'}")

    wynn_versions = sorted_versions([
        d.name for d in (wynn / "data").iterdir()
        if d.is_dir() and is_version(d.name)
    ])
    solver_versions = set(local_versions())
    latest_version = wynn_versions[-1] if wynn_versions else None

    print(f"\nWynnbuilder versions: {wynn_versions}")
    print(f"Build-solver versions: {sorted_versions(solver_versions)}")
    print(f"Latest: {latest_version}\n")

    print("--- Version folders ---")
    changed_any = False
    for ver in wynn_versions:
        src_dir = wynn / "data" / ver
        dst_dir = SOLVER_ROOT / "data" / ver
        if ver not in solver_versions:
            if dry:
                print(f"  [dry] would add missing version folder: data/{ver}")
            else:
                shutil.copytree(src_dir, dst_dir, dirs_exist_ok=True)
                print(f"  added missing version folder: data/{ver}")
            changed_any = True
        elif ver == latest_version:
            for fname in VERSION_FOLDER_FILES:
                src, dst = src_dir / fname, dst_dir / fname
                if src.exists() and (not dst.exists() or src.read_bytes() != dst.read_bytes()):
                    if dry:
                        print(f"  [dry] would copy data/{ver}/{fname}")
                    else:
                        shutil.copy2(src, dst)
                        print(f"  copied data/{ver}/{fname}")
                    changed_any = True
    if not changed_any:
        print("  (all version folders up to date)")

    print("\n--- Root-level files ---")
    root_changed = False
    for fname in ROOT_FILES_TO_SYNC:
        src, dst = wynn / fname, SOLVER_ROOT / fname
        if src.exists() and (not dst.exists() or src.read_bytes() != dst.read_bytes()):
            if dry:
                print(f"  [dry] would copy {fname}")
            else:
                shutil.copy2(src, dst)
                print(f"  copied {fname}")
            root_changed = True
    if not root_changed:
        print("  (all root files up to date)")

    if bump_version:
        print(f"\n--- Bumping code to version {bump_version} ---")
        load_item_path = wynn / "js/load_item.js"
        load_item_js = load_item_path.read_text(encoding="utf-8") if load_item_path.exists() else None
        bump_code(bump_version, dry, load_item_js)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Sync wynnbuilder-beta data into build-solver.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--local", metavar="PATH", help="use a local clone instead of fetching from GitHub")
    parser.add_argument("--no-pull", action="store_true", help="(local mode) skip git pull")
    parser.add_argument("--token", metavar="TOKEN", help="GitHub personal access token (raises rate limit to 5000/hr)")
    parser.add_argument("--bump-version", metavar="VERSION", help="update code constants to this version (e.g. 2.2.0.25)")
    parser.add_argument("--dry-run", action="store_true", help="print what would change, write nothing")
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN — no files will be written ===\n")

    if args.local:
        sync_local(Path(args.local).resolve(), args.dry_run, args.no_pull, args.bump_version)
    else:
        sync_github(args.dry_run, args.token, args.bump_version)

    print("\nDone.")


if __name__ == "__main__":
    main()
