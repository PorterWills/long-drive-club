#!/usr/bin/env python3
"""Push the LDC content calendar to the Google Sheet the dashboard reads.

Lives next to (a copy of) the calendar markdown in the Campaigns folder.
Claude Cowork runs it after every calendar edit; it can also be run by hand.

What it does:
  1. Finds the calendar markdown (first .md in this folder whose name starts
     with "LDC Social Content Calendar", or the path passed as an argument).
  2. Extracts the LAST fenced ```json block in the file — the machine-readable
     copy of Section 7 that Cowork maintains at the file's foot. The block
     must be a JSON array of row objects whose keys match the IG Calendar
     sheet columns (either the header names or their slugs), e.g.:
       [{"date": "13/07/2026", "format": "Image", "theme": "The Morning,
         inst. 1", ..., "status": "Planned"}, ...]
     A held milestone post has an empty "date" and "status": "Held".
  3. POSTs it to the Apps Script backend, which replaces the IG Calendar
     rows. The sheet keeps its own Status values for rows it already has
     (matched on date, or theme when dateless), so posted/logged flips are
     never undone by a strategy edit.

Setup (once):
  - Put the shared secret in a file named .ldc-sync-secret next to this
    script. The same value goes in the Apps Script's IG_SYNC_SECRET Script
    Property. Generate one with:  openssl rand -hex 24
  - Nothing else. Uses only the Python standard library.

Usage:
  python3 sync-ig-calendar.py [path-to-calendar.md]
"""
import json
import os
import re
import sys
import urllib.request

APPS_SCRIPT_URL = ("https://script.google.com/macros/s/"
                   "AKfycbzOFXxYWecTLBcC6T_z8KdnzHUsAT5NBAekuQnFqGrqPJpuO9C1YXih_xe43yfCMkYMDg/exec")

HERE = os.path.dirname(os.path.abspath(__file__))

# Keys the sheet knows, as slugs. Header-name keys are accepted too; anything
# else in a row is rejected so a drifted block fails loudly instead of writing
# junk into the sheet.
KNOWN_KEYS = {
    "date", "format", "theme", "peg_milestone", "concept", "asset_to_produce",
    "feeling", "the_remark", "caption_first_line", "final_copy",
    "confirm_before_posting", "status",
}


def slug(name):
    s = str(name).strip().lower()
    s = re.sub(r"\(s\)", "_s", s)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def find_calendar():
    if len(sys.argv) > 1:
        return sys.argv[1]
    for name in sorted(os.listdir(HERE)):
        if name.startswith("LDC Social Content Calendar") and name.endswith(".md"):
            return os.path.join(HERE, name)
    sys.exit("No calendar markdown found next to this script and no path given.")


def read_secret():
    path = os.path.join(HERE, ".ldc-sync-secret")
    try:
        with open(path) as f:
            secret = f.read().strip()
    except FileNotFoundError:
        sys.exit("Missing .ldc-sync-secret next to this script. See the setup note at the top.")
    if not secret:
        sys.exit(".ldc-sync-secret is empty.")
    return secret


def extract_rows(md_path):
    with open(md_path, encoding="utf-8") as f:
        text = f.read()
    blocks = re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
    if not blocks:
        sys.exit("No fenced ```json block found in " + md_path)
    try:
        rows = json.loads(blocks[-1])
    except json.JSONDecodeError as e:
        sys.exit("The sync block is not valid JSON: %s" % e)
    if not isinstance(rows, list) or not rows:
        sys.exit("The sync block must be a non-empty JSON array of row objects.")
    clean = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            sys.exit("Row %d is not an object." % (i + 1))
        rec = {slug(k): ("" if v is None else str(v)) for k, v in row.items()}
        unknown = set(rec) - KNOWN_KEYS
        if unknown:
            sys.exit("Row %d has unknown fields: %s. Sheet columns (as slugs): %s"
                     % (i + 1, ", ".join(sorted(unknown)), ", ".join(sorted(KNOWN_KEYS))))
        if rec.get("date", "").strip().lower() == "(none)":
            rec["date"] = ""
        clean.append(rec)
    return clean


def main():
    md_path = find_calendar()
    rows = extract_rows(md_path)
    payload = json.dumps({"igsync": 1, "secret": read_secret(), "rows": rows}).encode()
    req = urllib.request.Request(APPS_SCRIPT_URL, data=payload,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode())
    if body.get("ok"):
        print("Synced %d rows to the IG Calendar tab (%s statuses preserved)."
              % (body.get("rows", len(rows)), body.get("statusesKept", "?")))
    else:
        sys.exit("Sync refused: %s" % body.get("error", "unknown error"))


if __name__ == "__main__":
    main()
