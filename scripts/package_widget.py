#!/usr/bin/env python3
"""Create a clean, reproducible FortiSOAR widget TGZ."""

from __future__ import annotations

import argparse
import gzip
import json
import os
from pathlib import Path
import tarfile
import tempfile


REQUIRED_FILES = {
    "info.json",
    "view.html",
    "view.controller.js",
    "edit.html",
    "edit.controller.js",
}
IGNORED_NAMES = {".DS_Store"}


def normalized_tarinfo(info: tarfile.TarInfo) -> tarfile.TarInfo | None:
    name = Path(info.name).name
    if name in IGNORED_NAMES or name.startswith("._"):
        return None
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = 0
    info.pax_headers = {}
    return info


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir():
        parser.error(f"source directory does not exist: {source}")

    missing = sorted(REQUIRED_FILES - {path.name for path in source.iterdir()})
    if missing:
        parser.error(f"missing required files: {', '.join(missing)}")

    info = json.loads((source / "info.json").read_text(encoding="utf-8"))
    expected_root = f"{info['name']}-{info['version']}"
    if source.name != expected_root:
        parser.error(f"source directory must be named {expected_root!r}")

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(delete=False, dir=output.parent) as temp_file:
        temp_path = Path(temp_file.name)
    try:
        with temp_path.open("wb") as raw:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w", format=tarfile.GNU_FORMAT) as archive:
                    archive.add(source, arcname=expected_root, filter=normalized_tarinfo)
        os.replace(temp_path, output)
    finally:
        temp_path.unlink(missing_ok=True)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

