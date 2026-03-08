#!/usr/bin/env python3
"""
Returns statistics for a given Quran surah:
- Number of ayahs
- Number of pages (in the standard Madani mushaf)
- Number of Arabic letters
"""

import sys
import re
import urllib.request
import json


ARABIC_LETTERS = re.compile(r'[\u0621-\u063A\u0641-\u064A\u0671-\u06B7\u06BA-\u06BE\u06C0-\u06CE\u06D0-\u06D3\u06D5]')


def fetch_surah(surah_number: int) -> dict:
    url = f"https://api.alquran.cloud/v1/surah/{surah_number}/quran-simple"
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read())["data"]


def count_letters(ayahs: list) -> int:
    full_text = " ".join(ayah["text"] for ayah in ayahs)
    return len(ARABIC_LETTERS.findall(full_text))


def get_stats(surah_number: int) -> dict:
    if not 1 <= surah_number <= 114:
        raise ValueError(f"Surah number must be between 1 and 114, got {surah_number}")

    data = fetch_surah(surah_number)
    ayahs = data["ayahs"]

    pages = sorted({ayah["page"] for ayah in ayahs})

    return {
        "number": data["number"],
        "name": data["name"],
        "english_name": data["englishName"],
        "ayahs": data["numberOfAyahs"],
        "pages": len(pages),
        "page_range": f"{pages[0]}–{pages[-1]}",
        "letters": count_letters(ayahs),
    }


def main():
    if len(sys.argv) != 2:
        print("Usage: python surah_stats.py <surah_number>")
        print("Example: python surah_stats.py 2")
        sys.exit(1)

    try:
        surah_number = int(sys.argv[1])
    except ValueError:
        print(f"Error: '{sys.argv[1]}' is not a valid surah number")
        sys.exit(1)

    try:
        stats = get_stats(surah_number)
    except ValueError as e:
        print(f"Error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Failed to fetch surah data: {e}")
        sys.exit(1)

    print(f"Surah {stats['number']}: {stats['name']} ({stats['english_name']})")
    print(f"  Ayahs  : {stats['ayahs']}")
    print(f"  Pages  : {stats['pages']}  ({stats['page_range']})")
    print(f"  Letters: {stats['letters']}")


if __name__ == "__main__":
    main()
