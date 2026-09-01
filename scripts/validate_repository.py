#!/usr/bin/env python3
"""Validate catalog entries and reusable FortiSOAR widget artifacts."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile


ROOT = Path(__file__).resolve().parents[1]
REQUIRED_CATEGORIES = {"widgets", "connectors", "playbooks", "solution-packs"}
REQUIRED_CONTENT_FIELDS = {
    "id",
    "type",
    "title",
    "version",
    "compatibility",
    "features",
    "verifiedOn",
    "applicationGuide",
}
REQUIRED_README_HEADINGS = {
    "## 지원 기능",
    "## 검증된 FortiSOAR 버전",
    "## 적용 가이드",
}
REQUIRED_WIDGET_FILES = {
    "info.json",
    "view.html",
    "view.controller.js",
    "edit.html",
    "edit.controller.js",
}


def fail(message: str) -> None:
    raise ValueError(message)


def load_json(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"invalid JSON {path.relative_to(ROOT)}: {exc}")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_javascript(source: Path) -> None:
    node = shutil.which("node")
    if not node:
        print("WARN: node not found; JavaScript syntax checks skipped")
        return
    for filename in ("view.controller.js", "edit.controller.js"):
        subprocess.run([node, "--check", str(source / filename)], check=True)


def validate_content_documentation(directory: Path, manifest: dict) -> None:
    missing_fields = sorted(REQUIRED_CONTENT_FIELDS - manifest.keys())
    if missing_fields:
        fail(f"{directory.relative_to(ROOT)}/content.json missing: {', '.join(missing_fields)}")

    features = manifest.get("features")
    if not isinstance(features, list) or not features or any(not isinstance(item, str) or not item.strip() for item in features):
        fail(f"{directory.relative_to(ROOT)}/content.json requires a non-empty features list")

    verified = manifest.get("verifiedOn")
    if not isinstance(verified, list) or not verified:
        fail(f"{directory.relative_to(ROOT)}/content.json requires verifiedOn records")
    for index, record in enumerate(verified):
        if not isinstance(record, dict):
            fail(f"verifiedOn[{index}] must be an object in {directory.relative_to(ROOT)}")
        required = {"fortiSOARVersion", "date", "result", "scope"}
        missing = sorted(required - record.keys())
        if missing:
            fail(f"verifiedOn[{index}] missing {', '.join(missing)} in {directory.relative_to(ROOT)}")
        if not isinstance(record["fortiSOARVersion"], str) or not record["fortiSOARVersion"].strip():
            fail(f"verifiedOn[{index}] requires a FortiSOAR version in {directory.relative_to(ROOT)}")
        if record["result"] != "passed":
            fail(f"verifiedOn[{index}] is not a passed verification in {directory.relative_to(ROOT)}")
        if not isinstance(record["scope"], list) or not record["scope"]:
            fail(f"verifiedOn[{index}] requires a verification scope in {directory.relative_to(ROOT)}")

    guide_reference = manifest.get("applicationGuide")
    if not isinstance(guide_reference, str) or "#" not in guide_reference:
        fail(f"applicationGuide must point to a README section in {directory.relative_to(ROOT)}")
    guide_path = directory / guide_reference.split("#", 1)[0]
    if not guide_path.is_file():
        fail(f"application guide not found: {guide_path.relative_to(ROOT)}")
    readme = guide_path.read_text(encoding="utf-8")
    missing_headings = sorted(heading for heading in REQUIRED_README_HEADINGS if heading not in readme)
    if missing_headings:
        fail(f"{guide_path.relative_to(ROOT)} missing headings: {', '.join(missing_headings)}")


def validate_widget(directory: Path, manifest: dict) -> None:
    required_fields = {"source", "package", "sha256"}
    missing_fields = sorted(required_fields - manifest.keys())
    if missing_fields:
        fail(f"{directory.relative_to(ROOT)}/content.json missing: {', '.join(missing_fields)}")
    if manifest["type"] != "widget":
        fail(f"{directory.relative_to(ROOT)} has non-widget type")

    source = directory / manifest["source"]
    package = directory / manifest["package"]
    if not source.is_dir() or not package.is_file():
        fail(f"missing source or package under {directory.relative_to(ROOT)}")

    source_names = {path.name for path in source.iterdir()}
    missing_files = sorted(REQUIRED_WIDGET_FILES - source_names)
    if missing_files:
        fail(f"{source.relative_to(ROOT)} missing: {', '.join(missing_files)}")

    info = load_json(source / "info.json")
    expected_root = f"{info.get('name')}-{info.get('version')}"
    if source.name != expected_root:
        fail(f"source root {source.name!r} must equal {expected_root!r}")
    if info.get("name") != manifest["id"] or info.get("version") != manifest["version"]:
        fail(f"info.json and content.json identity mismatch in {directory.relative_to(ROOT)}")
    compatibility = info.get("metadata", {}).get("compatibility", [])
    if compatibility != manifest["compatibility"]:
        fail(f"compatibility mismatch in {directory.relative_to(ROOT)}")

    actual_sha = sha256(package)
    if actual_sha != manifest["sha256"]:
        fail(f"SHA-256 mismatch for {package.relative_to(ROOT)}: {actual_sha}")

    with tarfile.open(package, "r:gz") as archive:
        members = archive.getmembers()
        roots = {member.name.split("/", 1)[0] for member in members}
        if roots != {expected_root}:
            fail(f"invalid TGZ root(s) for {package.relative_to(ROOT)}: {sorted(roots)}")
        if any(Path(member.name).name == ".DS_Store" or Path(member.name).name.startswith("._") for member in members):
            fail(f"macOS metadata found in {package.relative_to(ROOT)}")
        if any(member.pax_headers for member in members):
            fail(f"PAX/xattr metadata found in {package.relative_to(ROOT)}")
        archive_files = {
            member.name.split("/", 1)[1]
            for member in members
            if member.isfile() and "/" in member.name
        }
        source_files = {
            path.relative_to(source).as_posix()
            for path in source.rglob("*")
            if path.is_file() and path.name != ".DS_Store" and not path.name.startswith("._")
        }
        if archive_files != source_files:
            fail(f"source/package file list mismatch in {directory.relative_to(ROOT)}")
        for relative in sorted(source_files):
            extracted = archive.extractfile(f"{expected_root}/{relative}")
            if extracted is None or extracted.read() != (source / relative).read_bytes():
                fail(f"source/package content mismatch: {directory.relative_to(ROOT)}/{relative}")

    validate_javascript(source)
    print(f"OK widget {manifest['id']} {manifest['version']} ({actual_sha[:12]})")


def main() -> int:
    catalog = load_json(ROOT / "catalog.json")
    categories = set(catalog.get("categories", []))
    if not REQUIRED_CATEGORIES.issubset(categories):
        fail("catalog.json does not declare all supported categories")

    seen: set[tuple[str, str]] = set()
    for entry in catalog.get("contents", []):
        key = (entry.get("type", ""), entry.get("id", ""))
        if key in seen:
            fail(f"duplicate catalog entry: {key}")
        seen.add(key)
        directory = ROOT / entry["path"]
        manifest = load_json(directory / "content.json")
        for field in ("id", "type", "title", "version", "compatibility"):
            if entry.get(field) != manifest.get(field):
                fail(f"catalog/content mismatch for {entry['path']}: {field}")
        validate_content_documentation(directory, manifest)
        if entry.get("features") != manifest.get("features"):
            fail(f"catalog/content mismatch for {entry['path']}: features")
        verified_versions = [record["fortiSOARVersion"] for record in manifest["verifiedOn"]]
        if entry.get("verifiedFortiSOARVersions") != verified_versions:
            fail(f"catalog/content mismatch for {entry['path']}: verifiedFortiSOARVersions")
        expected_guide = f"{entry['path']}/{manifest['applicationGuide']}"
        if entry.get("guide") != expected_guide:
            fail(f"catalog/content mismatch for {entry['path']}: guide")
        if entry["type"] == "widget":
            validate_widget(directory, manifest)
        else:
            print(f"OK catalog {entry['type']} {entry['id']}")

    print(f"OK repository: {len(seen)} content item(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, subprocess.CalledProcessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
