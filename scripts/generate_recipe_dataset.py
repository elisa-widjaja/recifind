import html
import json
import re
import subprocess
import unicodedata
import zlib
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.parse import urlparse, urlunparse

PDF_PATH = Path("Recipies.pdf")
OUTPUT_PATH = Path("recipes_from_pdf.json")

INGREDIENT_KEYWORDS = [
    "you need",
    "ingredients",
    "ingredient list",
    "what you need",
    "here's what you need",
    "you will need",
    "shopping list",
    "for the salad",
    "for the dressing",
    "for the sauce",
    "for the marinade",
]
INGREDIENT_STOPWORDS = [
    "how",
    "method",
    "instructions",
    "directions",
    "steps",
    "prep",
    "preparation",
    "makes",
    "serves",
    "macros",
    "calories",
    "enjoy",
    "note",
    "notes",
    "tip",
    "tips",
    "storage",
    "cook",
    "bake",
    "fry",
    "to make",
]

INSTRUCTION_KEYWORDS = [
    "how",
    "instructions",
    "method",
    "directions",
    "steps",
    "to make",
    "prep",
    "preparation",
    "cook",
    "bake",
    "finish",
]

INSTRUCTION_TERMINATORS = [
    "serves",
    "macros",
    "calories",
    "enjoy",
    "notes",
    "note",
    "tag",
    "share",
]

MEASUREMENT_TOKENS = [
    "cup",
    "cups",
    "tsp",
    "teaspoon",
    "teaspoons",
    "tbsp",
    "tablespoon",
    "tablespoons",
    "g",
    "gram",
    "grams",
    "kg",
    "ml",
    "l",
    "oz",
    "lb",
    "lbs",
    "clove",
    "cloves",
    "slice",
    "slices",
    "sprig",
    "sprigs",
    "bunch",
    "handful",
    "packet",
    "pack",
    "package",
    "can",
    "tin",
    "fillet",
    "fillets",
    "stick",
    "sticks",
]

MEASUREMENT_PATTERN = re.compile(r"\b(" + "|".join(MEASUREMENT_TOKENS) + r")\b")

MEAT_KEYWORDS = {
    "beef",
    "chicken",
    "turkey",
    "pork",
    "lamb",
    "mutton",
    "bacon",
    "ham",
    "sausage",
    "duck",
    "veal",
    "prosciutto",
    "salami",
    "anchovy",
    "anchovies",
    "tuna",
    "salmon",
    "cod",
    "trout",
    "shrimp",
    "prawn",
    "prawns",
    "lobster",
    "crab",
    "clam",
    "clams",
    "mussel",
    "mussels",
    "octopus",
    "squid",
    "calamari",
    "fish",
    "seafood",
    "oxtail",
    "short rib",
    "short ribs",
    "steak",
}

BREAKFAST_KEYWORDS = [
    "breakfast",
    "brunch",
    "pancake",
    "oat",
    "granola",
    "smoothie bowl",
    "overnight oats",
    "toast",
    "waffle",
    "frittata",
    "egg muffin",
    "omelette",
    "bagel",
]

DESSERT_KEYWORDS = [
    "cake",
    "brownie",
    "dessert",
    "cookie",
    "tart",
    "pie",
    "ice cream",
    "pudding",
    "cheesecake",
    "cupcake",
    "mousse",
    "custard",
    "sorbet",
    "lava cake",
    "sweet roll",
    "pastry",
    "crepe",
    "donut",
    "banana bread",
]

DRINK_KEYWORDS = [
    "sangria",
    "cocktail",
    "mocktail",
    "smoothie",
    "latte",
    "tea",
    "lemonade",
    "juice",
    "spritz",
    "punch",
    "margarita",
    "mojito",
    "paloma",
]

MEAL_KEYWORDS = {
    "lunch": ["lunch", "snack", "nibbles", "bites"],
    "dinner": ["dinner"],
    "brunch": ["brunch"],
}

COURSE_KEYWORDS = {
    "soup": ["soup", "ramen", "pho", "bisque"],
    "salad": ["salad"],
    "pasta": ["pasta", "spaghetti", "lasagna", "tagliatelle", "penne", "pappardelle", "mac"],
    "noodles": ["noodle", "udon", "lo mein", "pad thai", "yakisoba"],
    "stew": ["stew", "braise"],
    "curry": ["curry"],
    "stir-fry": ["stir fry", "stir-fry"],
    "bowl": ["bowl"],
    "sandwich": ["sandwich", "wrap", "burger"],
    "rice": ["rice", "risotto", "paella", "pilaf"],
    "pizza": ["pizza", "flatbread"],
    "tacos": ["taco"],
    "appetizer": ["appetizer", "starter", "bites"],
}


def keyword_in_text(text: str, keyword: str) -> bool:
    if " " in keyword:
        return keyword in text
    return re.search(rf"\b{re.escape(keyword)}s?\b", text) is not None


def normalize_instagram_url(url: str) -> str:
    try:
        parsed = urlparse(url)
    except Exception:
        return url

    segments = [segment for segment in parsed.path.split("/") if segment]
    shortcode = None
    content_type = None

    if "reel" in segments:
        idx = segments.index("reel")
        if idx + 1 < len(segments):
            content_type = "reel"
            shortcode = segments[idx + 1]
    elif "p" in segments:
        idx = segments.index("p")
        if idx + 1 < len(segments):
            content_type = "p"
            shortcode = segments[idx + 1]

    if content_type and shortcode:
        return f"https://www.instagram.com/{content_type}/{shortcode}/"

    # Fallback to original without query parameters
    cleaned = parsed._replace(query="", fragment="")
    return urlunparse(cleaned)


def decode_pdf_string(data: str) -> str:
    """Decode a PDF string literal."""
    out = []
    i = 0
    while i < len(data):
        ch = data[i]
        if ch == "\\":
            i += 1
            if i >= len(data):
                break
            esc = data[i]
            if esc in "()\\":
                out.append(esc)
            elif esc == "n":
                out.append("\n")
            elif esc == "r":
                out.append("\r")
            elif esc == "t":
                out.append("\t")
            elif esc == "b":
                out.append("\b")
            elif esc == "f":
                out.append("\f")
            elif esc in "01234567":
                oct_digits = esc
                j = 1
                while j < 3 and i + j < len(data) and data[i + j] in "01234567":
                    oct_digits += data[i + j]
                    j += 1
                i += j - 1
                out.append(chr(int(oct_digits, 8)))
            else:
                out.append(esc)
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def parse_pdf_pairs(pdf_path: Path) -> List[Tuple[str, str]]:
    """Extract (title, url) pairs from the PDF file."""
    raw = pdf_path.read_bytes()
    streams: List[str] = []
    for match in re.finditer(br"stream\r?\n(.*?)endstream", raw, re.DOTALL):
        stream_data = match.group(1).lstrip(b"\r\n")
        try:
            stream_data = zlib.decompress(stream_data)
        except Exception:
            pass
        streams.append(stream_data.decode("latin-1", errors="ignore"))

    texts: List[str] = []
    for content in streams:
        for array in re.findall(r"\[(.*?)\]\s*TJ", content, flags=re.DOTALL):
            parts = re.findall(r"\((.*?)\)", array)
            text = "".join(decode_pdf_string(p) for p in parts)
            if text.strip():
                texts.append(text)
        for string in re.findall(r"\((.*?)\)\s*Tj", content):
            text = decode_pdf_string(string)
            if text.strip():
                texts.append(text)

    lines: List[str] = []
    for text in texts:
        for line in text.split("\n"):
            trimmed = line.strip()
            if trimmed:
                lines.append(trimmed)

    pairs: List[Tuple[str, str]] = []
    title: Optional[str] = None
    i = 0
    while i < len(lines):
        line = lines[i]
        lower = line.lower()
        if lower in {"recipies", "recipes"} or lower.startswith("page "):
            title = None
            i += 1
            continue
        if re.match(r"\d{1,2}/\d{1,2}/\d{2}", line) or re.match(r"\d{1,2}:\d{2}", line):
            i += 1
            continue
        if line.startswith("https://"):
            url = line
            j = i + 1
            while j < len(lines):
                nxt = lines[j]
                if nxt.startswith("https://"):
                    break
                if " " in nxt:
                    break
                if nxt.lower().startswith("page "):
                    break
                if re.match(r"\d{1,2}/\d{1,2}/\d{2}", nxt) or re.match(r"\d{1,2}:\d{2}", nxt):
                    break
                url += nxt
                j += 1
            i = j
            if title and url:
                pairs.append((title, url))
                title = None
            continue
        else:
            title = line
            i += 1
    return pairs


def to_ascii(text: str) -> str:
    """Normalize string to ASCII, dropping unsupported characters."""
    normalized = unicodedata.normalize("NFKD", text)
    return normalized.encode("ascii", "ignore").decode("ascii")


def fetch_html(url: str) -> Optional[str]:
    """Fetch HTML using curl to avoid certificate issues."""
    result = subprocess.run(
        ["curl", "-sL", url],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=False,
    )
    if result.returncode != 0:
        return None
    return result.stdout.decode("utf-8", errors="ignore")


META_PATTERN_TEMPLATE = r'<meta\s+[^>]*property=(["\']){property}\1[^>]*content=(["\'])(.*?)\2'


def extract_meta_value(html_text: str, property_name: str) -> Optional[str]:
    pattern = re.compile(
        META_PATTERN_TEMPLATE.format(property=re.escape(property_name)),
        re.IGNORECASE | re.DOTALL,
    )
    match = pattern.search(html_text)
    if not match:
        return None
    return html.unescape(match.group(3))


def prepare_lines(description: str) -> List[str]:
    text = description.replace("\r", "\n")
    raw_lines = [ln.strip() for ln in text.split("\n")]
    lines: List[str] = []
    for line in raw_lines:
        if not line:
            continue
        if lines and lines[-1] == line:
            continue
        lines.append(line)
    return lines


def extract_ingredients_section(lines: List[str]) -> Tuple[List[str], int]:
    start_idx = 0
    for idx, line in enumerate(lines):
        lower = line.lower()
        if any(keyword in lower for keyword in INGREDIENT_KEYWORDS):
            start_idx = idx + 1
            break

    ingredients: List[str] = []
    i = start_idx
    while i < len(lines):
        line = lines[i]
        lower = line.lower()

        if lower.startswith("#") or lower.startswith("http"):
            if ingredients:
                break
            i += 1
            continue

        if any(lower.startswith(stop) or lower == stop for stop in INGREDIENT_STOPWORDS):
            if ingredients:
                break
            i += 1
            continue

        if re.match(r"^[0-9]+[).]", line) and ingredients:
            break

        bullet = re.match(r"^[\-•–—]\s*(.+)$", line)
        if bullet:
            ingredients.append(bullet.group(1).strip())
            i += 1
            continue

        if any(
            lower.startswith(prefix)
            for prefix in (
                "optional toppings",
                "optional:",
                "toppings",
                "garnish",
                "for the",
            )
        ):
            ingredients.append(line)
            i += 1
            continue

        if MEASUREMENT_PATTERN.search(lower) or re.search(r"\d", line):
            ingredients.append(line)
            i += 1
            continue

        if ingredients:
            break

        i += 1

    if ingredients:
        return ingredients, i

    fallback_match = re.search(
        r"(ingredients[^:]*:)(.+)",
        "\n".join(lines),
        flags=re.IGNORECASE | re.DOTALL,
    )
    if fallback_match:
        rest = fallback_match.group(2).split("\n")[0]
        tokens = [
            token.strip(" .;-")
            for token in rest.split(",")
            if token.strip(" .;-")
        ]
        if tokens:
            return tokens, start_idx

    return [], start_idx


def extract_steps_section(lines: List[str], start_idx: int) -> List[str]:
    steps: List[str] = []
    i = start_idx
    while i < len(lines):
        line = lines[i]
        lower = line.lower()

        if lower.startswith("#") or lower.startswith("http"):
            break

        if any(term in lower for term in INSTRUCTION_TERMINATORS):
            if steps:
                break

        if any(keyword in lower for keyword in INSTRUCTION_KEYWORDS) and not re.match(
            r"^[0-9]+[).]", line
        ):
            i += 1
            continue

        numeric = re.match(r"^(?:step\s*)?(\d+)[)\.:\-]?\s*(.+)$", line, re.IGNORECASE)
        if numeric:
            steps.append(numeric.group(2).strip())
            i += 1
            continue

        bullet = re.match(r"^[\-•–—]\s*(.+)$", line)
        if bullet and steps:
            steps.append(bullet.group(1).strip())
            i += 1
            continue

        if steps:
            steps[-1] = f"{steps[-1]} {line}".strip()
            i += 1
            continue

        i += 1

    return steps


def extract_recipe_content(description: str) -> Tuple[List[str], List[str]]:
    lines = prepare_lines(description)
    ingredients, idx = extract_ingredients_section(lines)
    steps = extract_steps_section(lines, idx)
    return ingredients, steps


def infer_tags(title: str, ingredients: List[str]) -> List[str]:
    text = f"{title} {' '.join(ingredients)}".lower()
    tags = set()

    for tag, keywords in MEAL_KEYWORDS.items():
        if any(keyword_in_text(text, keyword) for keyword in keywords):
            tags.add(tag)

    if any(keyword_in_text(text, keyword) for keyword in BREAKFAST_KEYWORDS):
        tags.add("breakfast")
    if any(keyword_in_text(text, keyword) for keyword in DESSERT_KEYWORDS):
        tags.add("dessert")
    if any(keyword_in_text(text, keyword) for keyword in DRINK_KEYWORDS):
        tags.add("drink")

    for tag, keywords in COURSE_KEYWORDS.items():
        if any(keyword_in_text(text, keyword) for keyword in keywords):
            tags.add(tag)

    if any(keyword_in_text(text, word) for word in ["roast", "sheet pan", "tray bake", "roasted"]):
        tags.add("roast")
    if any(keyword_in_text(text, word) for word in ["grill", "grilled", "bbq", "barbecue"]):
        tags.add("grill")

    meat_present = any(keyword_in_text(text, word) for word in MEAT_KEYWORDS)
    if not meat_present:
        tags.add("vegetarian")

    if keyword_in_text(text, "vegan"):
        tags.add("vegan")

    return sorted(tags)


def infer_meal_types(title: str, ingredients: List[str], tags: List[str]) -> List[str]:
    text = f"{title} {' '.join(ingredients)}".lower()
    lowered_tags = {tag.lower() for tag in tags}
    meal_types = set()

    if "breakfast" in lowered_tags or keyword_in_text(text, "breakfast"):
        meal_types.add("breakfast")
    if "brunch" in lowered_tags or keyword_in_text(text, "brunch"):
        meal_types.add("brunch")
    if "dessert" in lowered_tags or keyword_in_text(text, "dessert"):
        meal_types.add("dessert")
    for meal, keywords in MEAL_KEYWORDS.items():
        if any(keyword_in_text(text, keyword) for keyword in keywords):
            meal_types.add(meal)

    if not meal_types:
        if "salad" in lowered_tags or keyword_in_text(text, "salad"):
            meal_types.add("lunch")
        elif "soup" in lowered_tags or keyword_in_text(text, "soup"):
            meal_types.add("dinner")
        elif "dessert" in lowered_tags:
            meal_types.add("dessert")
        else:
            meal_types.add("dinner")

    return sorted(meal_types)


def main() -> None:
    if not PDF_PATH.exists():
        raise SystemExit(f"Missing {PDF_PATH}")

    pairs = parse_pdf_pairs(PDF_PATH)
    results = []
    failures = []

    for idx, (title, url) in enumerate(pairs, start=1):
        html_text = fetch_html(url)
        if not html_text:
            failures.append({"title": title, "url": url, "reason": "fetch_failed"})
            continue
        description = extract_meta_value(html_text, "og:description")
        if not description:
            failures.append({"title": title, "url": url, "reason": "no_description"})
            continue
        image_url = extract_meta_value(html_text, "og:image") or extract_meta_value(
            html_text, "og:image:secure_url"
        )
        if not image_url:
            failures.append({"title": title, "url": url, "reason": "no_image"})
            continue
        canonical_url = normalize_instagram_url(extract_meta_value(html_text, "og:url") or url)

        ingredients, steps = extract_recipe_content(description)
        ascii_title = to_ascii(title)
        ascii_ingredients = [to_ascii(item) for item in ingredients]
        ascii_image = to_ascii(image_url)
        ascii_steps = [to_ascii(step) for step in steps]
        ascii_source = to_ascii(canonical_url)
        inferred_tags = infer_tags(title, ingredients)
        ascii_tags = [to_ascii(tag) for tag in inferred_tags]
        ascii_meal_types = [to_ascii(meal) for meal in infer_meal_types(title, ingredients, inferred_tags)]
        entry = {
            "title": ascii_title,
            "sourceUrl": ascii_source,
            "imageUrl": ascii_image,
            "ingredients": ascii_ingredients,
        }
        if ascii_steps:
            entry["steps"] = ascii_steps
        if ascii_tags:
            entry["tags"] = ascii_tags
        if ascii_meal_types:
            entry["mealTypes"] = ascii_meal_types
        if not ascii_ingredients:
            entry["notes"] = "Ingredients not detected automatically."
            fragment = " ".join(description.splitlines()[:4])
            entry["descriptionPreview"] = to_ascii(fragment)[:280]
        results.append(entry)

    payload = {
        "meta": {
            "source": to_ascii(str(PDF_PATH)),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "totalRecipesDetected": len(results),
            "totalRecipesInPdf": len(pairs),
            "recipesWithMissingIngredients": sum(
                1 for item in results if not item["ingredients"]
            ),
            "recipesWithMissingSteps": sum(
                1 for item in results if not item.get("steps")
            ),
            "recipesWithTags": sum(
                1 for item in results if item.get("tags")
            ),
            "recipesWithMealTypes": sum(
                1 for item in results if item.get("mealTypes")
            ),
        },
        "recipes": results,
    }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2), encoding="ascii")

    if failures:
        failure_path = OUTPUT_PATH.with_name("recipes_fetch_failures.json")
        failure_payload = {
            "meta": {"totalFailures": len(failures)},
            "failures": failures,
        }
        failure_path.write_text(json.dumps(failure_payload, indent=2), encoding="ascii")


if __name__ == "__main__":
    main()
