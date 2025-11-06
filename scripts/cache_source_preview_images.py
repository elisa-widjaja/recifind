#!/usr/bin/env python3
"""Cache preview images resolved from recipe source URLs.

This script visits each recipe's ``sourceUrl``, attempts to extract a preview
image (``og:image`` and related meta tags), downloads the image into the local
``public/images/recipes`` directory, and rewrites the recipe's ``imageUrl`` to
reference the cached copy.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import mimetypes
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, Optional, Tuple
from urllib.parse import urljoin, urlparse

import requests


DEFAULT_RECIPES_PATH = Path("recipes.json")
DEFAULT_OUTPUT_PATH = DEFAULT_RECIPES_PATH
DEFAULT_IMAGE_DIR = Path("public/images/recipes")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/118.0 Safari/537.36"
)

META_CANDIDATES: Tuple[Tuple[str, str], ...] = (
    ("property", "og:image:secure_url"),
    ("property", "og:image:url"),
    ("property", "og:image"),
    ("name", "og:image"),
    ("property", "twitter:image"),
    ("name", "twitter:image"),
    ("property", "twitter:image:src"),
    ("name", "twitter:image:src"),
    ("itemprop", "image"),
    ("name", "thumbnail"),
)

SAFE_SLUG_RE = re.compile(r"[^a-z0-9]+")

PAGE_HEADER_VARIANTS = (
    {
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
    },
    {
        "User-Agent": USER_AGENT,
    },
    None,
)

IMAGE_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Pragma": "no-cache",
    "Cache-Control": "no-cache",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--recipes-file",
        type=Path,
        default=DEFAULT_RECIPES_PATH,
        help="Path to recipes JSON file (default: recipes.json)",
    )
    parser.add_argument(
        "--output-file",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help="Where to write the updated JSON (default: overwrite recipes file)",
    )
    parser.add_argument(
        "--image-dir",
        type=Path,
        default=DEFAULT_IMAGE_DIR,
        help="Directory to write cached images (default: public/images/recipes)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Reuse existing cached files when available",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Describe planned actions without downloading or writing files",
    )
    return parser.parse_args()


def load_recipes(path: Path) -> Dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def slugify(value: str) -> str:
    slug = SAFE_SLUG_RE.sub("-", value.lower()).strip("-")
    if slug:
        return slug[:60]
    return f"recipe-{hashlib.sha1(value.encode('utf-8')).hexdigest()[:10]}"


def guess_extension(url: str, content_type: Optional[str]) -> str:
    parsed = urlparse(url)
    suffix = Path(parsed.path).suffix.lower()
    if suffix and not suffix.endswith(".php"):
        if suffix in {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"}:
            return ".jpg" if suffix == ".jpeg" else suffix

    if content_type:
        ctype = content_type.split(";")[0].strip()
        guess = mimetypes.guess_extension(ctype)
        if guess:
            if guess == ".jpe":
                return ".jpg"
            return guess

    return ".jpg"


def to_public_path(path: Path) -> Optional[str]:
    try:
        relative = path.relative_to(Path("public"))
    except ValueError:
        return None
    return f"/{relative.as_posix()}"


def _meta_regex(attr: str, value: str) -> re.Pattern[str]:
    pattern = rf'<meta[^>]*{attr}\s*=\s*(["\']){re.escape(value)}\1[^>]*>'
    return re.compile(pattern, re.IGNORECASE)


def _extract_content(tag: str) -> Optional[str]:
    match = re.search(r'content\s*=\s*(["\'])(.*?)\1', tag, re.IGNORECASE)
    if not match:
        return None
    return html.unescape(match.group(2).strip())


def _extract_preview_from_html(html_text: str, base_url: str) -> Optional[str]:
    snippet = html_text[:200_000]

    for attr, value in META_CANDIDATES:
        match = _meta_regex(attr, value).search(snippet)
        if match:
            content = _extract_content(match.group(0))
            if content:
                return urljoin(base_url, content)

    link_match = re.search(
        r'<link[^>]*rel\s*=\s*(["\'])(?:image_src|thumbnail)\1[^>]*>',
        snippet,
        re.IGNORECASE,
    )
    if link_match:
        href_match = re.search(r'href\s*=\s*(["\'])(.*?)\1', link_match.group(0), re.IGNORECASE)
        if href_match:
            return urljoin(base_url, html.unescape(href_match.group(2).strip()))

    return None


def resolve_preview_url(source_url: str) -> Tuple[Optional[str], Optional[str]]:
    last_final_url: Optional[str] = None
    for headers in PAGE_HEADER_VARIANTS:
        try:
            response = requests.get(source_url, headers=headers, timeout=30)
            response.raise_for_status()
        except requests.RequestException as exc:
            last_final_url = source_url
            print(f"[warning] Failed to fetch {source_url}: {exc}", file=sys.stderr)
            continue

        final_url = response.url or source_url
        last_final_url = final_url
        preview_url = _extract_preview_from_html(response.text, final_url)
        if preview_url:
            return preview_url, final_url

    return None, last_final_url


def download_image(url: str, referer: Optional[str]) -> Tuple[bytes, Optional[str]]:
    headers = dict(IMAGE_HEADERS)
    if referer:
        headers["Referer"] = referer
    try:
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        return response.content, response.headers.get("Content-Type")
    except requests.RequestException as exc:
        raise RuntimeError(str(exc)) from exc


def update_recipes(
    recipes: Dict,
    image_dir: Path,
    skip_existing: bool,
    dry_run: bool,
) -> bool:
    ensure_directory(image_dir)
    changed = False
    slug_counts: Dict[str, int] = {}

    for entry in recipes.get("recipes", []):
        source_url = (entry.get("sourceUrl") or "").strip()
        title = (entry.get("title") or "recipe").strip() or "recipe"

        if not source_url:
            continue

        slug = slugify(title)
        slug_counts[slug] = slug_counts.get(slug, 0) + 1
        final_slug = slug if slug_counts[slug] == 1 else f"{slug}-{slug_counts[slug]}"

        existing_local = (entry.get("imageUrl") or "").strip().startswith("/")
        if skip_existing and existing_local:
            continue

        preview_url, referer = resolve_preview_url(source_url)
        candidates: Iterable[Tuple[str, Optional[str], str]] = []
        if preview_url:
            candidates = [(preview_url, referer, "preview")]
        else:
            fallback = (entry.get("imageUrl") or "").strip()
            if fallback:
                candidates = [(fallback, source_url, "fallback imageUrl")]

        saved_path: Optional[Path] = None
        last_error: Optional[str] = None

        for candidate_url, candidate_referer, label in candidates:
            target_ext = guess_extension(candidate_url, None)
            target_path = image_dir / f"{final_slug}{target_ext}"

            if skip_existing and target_path.exists():
                saved_path = target_path
                break

            if dry_run:
                print(f"[dry-run] Would download {candidate_url} ({label}) -> {target_path}")
                saved_path = target_path
                break

            try:
                content, content_type = download_image(candidate_url, candidate_referer)
                target_ext = guess_extension(candidate_url, content_type)
                target_path = image_dir / f"{final_slug}{target_ext}"
                target_path.write_bytes(content)
                print(f"Downloaded {candidate_url} ({label}) -> {target_path}")
                saved_path = target_path
                break
            except Exception as exc:  # noqa: BLE001
                last_error = str(exc)
                print(f"[warning] Failed to download {candidate_url} ({label}): {exc}", file=sys.stderr)

        if not saved_path:
            if last_error:
                print(f"[warning] No image cached for {source_url}: {last_error}", file=sys.stderr)
            continue

        if dry_run:
            continue

        mapped = to_public_path(saved_path)
        if mapped:
            if entry.get("imageUrl") != mapped:
                entry["imageUrl"] = mapped
                changed = True
        else:
            entry["imageUrl"] = saved_path.as_posix()
            changed = True

    return changed


def main() -> int:
    args = parse_args()

    recipes = load_recipes(args.recipes_file)
    changed = update_recipes(recipes, args.image_dir, args.skip_existing, args.dry_run)

    if args.dry_run:
        return 0

    if changed:
        with args.output_file.open("w", encoding="utf-8") as handle:
            json.dump(recipes, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        print(f"Wrote updated recipes to {args.output_file}")
    else:
        print("No changes made.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
