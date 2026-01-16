#!/usr/bin/env python3
"""Download recipe images locally and rewrite image URLs.

This script reads `recipes.json`, downloads each remote image into
`public/images/recipes/`, and rewrites the `imageUrl` field to point at
the cached copy. It skips empty/data URLs and preserves existing local
paths. Run it from the project root:

    python scripts/cache_recipe_images.py

Use `--help` for additional options.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import sys
from pathlib import Path
from typing import Dict, Iterable, Tuple
from urllib.error import URLError, HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


DEFAULT_RECIPES_PATH = Path("recipes.json")
DEFAULT_OUTPUT_PATH = DEFAULT_RECIPES_PATH
DEFAULT_IMAGE_DIR = Path("public/images/recipes")
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/118.0 Safari/537.36"
)

SAFE_SLUG_RE = re.compile(r"[^a-z0-9]+")
VALID_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


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
        help="Directory to store cached images (default: public/images/recipes)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip downloading if the target file already exists",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not download or modify files; just report planned actions",
    )
    return parser.parse_args()


def load_recipes(recipes_path: Path) -> Dict:
    with recipes_path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def slugify(title: str) -> str:
    slug = SAFE_SLUG_RE.sub("-", title.lower()).strip("-")
    if not slug:
        slug = f"recipe-{hashlib.sha1(title.encode('utf-8')).hexdigest()[:10]}"
    return slug[:60]


def guess_extension(url: str, content_type: str | None) -> str:
    parsed = urlparse(url)
    url_ext = Path(parsed.path).suffix.lower()
    if url_ext in VALID_EXTENSIONS:
        return url_ext

    if content_type:
        ext = mimetypes.guess_extension(content_type.split(";")[0].strip())
        if ext in VALID_EXTENSIONS:
            return ext

    return ".jpg"


def download_image(url: str) -> Tuple[bytes, str]:
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=30) as response:
        content = response.read()
        content_type = response.headers.get("Content-Type")
    return content, content_type


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def _to_public_path(path: Path) -> str | None:
    try:
        rel = path.relative_to(Path("public"))
    except ValueError:
        return None
    return f"/{rel.as_posix()}"


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
        image_url = (entry.get("imageUrl") or "").strip()
        title = entry.get("title", "").strip() or "recipe"

        if not image_url or image_url.startswith(("data:", "/")):
            continue

        slug = slugify(title)
        slug_counts.setdefault(slug, 0)
        slug_counts[slug] += 1
        final_slug = slug if slug_counts[slug] == 1 else f"{slug}-{slug_counts[slug]}"

        try:
            ext = guess_extension(image_url, None)
            target_file = image_dir / f"{final_slug}{ext}"

            if skip_existing and target_file.exists():
                new_url = _to_public_path(target_file)
                if new_url and entry.get("imageUrl") != new_url:
                    entry["imageUrl"] = new_url
                    changed = True
                continue

            if dry_run:
                print(f"[dry-run] Would download {image_url} -> {target_file}")
                continue

            content, content_type = download_image(image_url)
            ext = guess_extension(image_url, content_type)
            target_file = image_dir / f"{final_slug}{ext}"

            target_file.write_bytes(content)
            new_url = _to_public_path(target_file)
            if new_url:
                entry["imageUrl"] = new_url
            else:
                entry["imageUrl"] = str(target_file.as_posix())
            changed = True
            print(f"Downloaded {image_url} -> {target_file}")
        except HTTPError as error:
            print(f"[warning] HTTP error {error.code} for {image_url}", file=sys.stderr)
        except URLError as error:
            print(f"[warning] URL error for {image_url}: {error.reason}", file=sys.stderr)
        except Exception as exc:  # pylint: disable=broad-except
            print(f"[warning] Failed to cache {image_url}: {exc}", file=sys.stderr)

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
