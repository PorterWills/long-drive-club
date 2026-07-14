#!/usr/bin/env python3
"""Push the LDC content calendar AND post log to the Google Sheet the
dashboard reads.

Lives next to (a copy of) the calendar markdown in the Campaigns folder.
Claude Cowork runs it (or Michael double-clicks the .command wrapper) after
every calendar edit or stats hand-off; it can also be run by hand.

What it does:
  1. Finds the calendar markdown (first .md in this folder whose name starts
     with "LDC Social Content Calendar", or the path passed as an argument).
  2. Scans every fenced ```json block in the file and classifies each array
     of objects by shape:
       - rows with "theme"/"format" fields  -> the CALENDAR block
         (replaces the IG Calendar tab; the sheet keeps its own Status for
         rows it already has, matched on date or theme when dateless)
       - rows with a "post" number          -> the POST LOG block
         (UPSERT into IG Post Log keyed on post number: known posts get the
         provided fields updated, new posts append, nothing is deleted)
     The last block of each kind wins. Either may be absent.
  3. POSTs whatever it found to the Apps Script backend.

Calendar row keys (sheet columns as slugs): date, format, theme,
peg_milestone, concept, asset_to_produce, feeling, the_remark,
caption_first_line, final_copy, confirm_before_posting, status.
A held milestone post has an empty "date" and "status": "Held".

Post log row keys: post (required, whole number), date, format,
content_type, car_subject, cta, feeling, views, reach, profile_visits,
link_taps, follows, likes, comments, saves, watch_time_s, posted_time
(HH:MM), reposts.

Setup (once):
  - Put the shared secret in a file named .ldc-sync-secret next to this
    script. The same value goes in the Apps Script's IG_SYNC_SECRET Script
    Property.
  - Nothing else. Uses only the Python standard library.

Usage:
  python3 sync-ig-calendar.py [--dry-run] [path-to-calendar.md]
"""
import json
import os
import re
import sys
import urllib.request

APPS_SCRIPT_URL = ("https://script.google.com/macros/s/"
                   "AKfycbzOFXxYWecTLBcC6T_z8KdnzHUsAT5NBAekuQnFqGrqPJpuO9C1YXih_xe43yfCMkYMDg/exec")

HERE = os.path.dirname(os.path.abspath(__file__))

CAL_KEYS = {
    "date", "format", "theme", "peg_milestone", "concept", "asset_to_produce",
    "feeling", "the_remark", "caption_first_line", "final_copy",
    "confirm_before_posting", "status",
}
LOG_KEYS = {
    "post", "date", "format", "content_type", "car_subject", "cta", "feeling",
    "views", "reach", "profile_visits", "link_taps", "follows", "likes",
    "comments", "saves", "watch_time_s", "posted_time", "reposts",
}
LOG_NUMERIC = {"views", "reach", "profile_visits", "link_taps", "follows",
               "likes", "comments", "saves", "watch_time_s", "reposts"}
DATE_RE = re.compile(r"^(\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2})$")
TIME_RE = re.compile(r"^\d{1,2}:\d{2}$")


def slug(name):
    s = str(name).strip().lower()
    s = re.sub(r"\(s\)", "_s", s)
    s = re.sub(r"[^a-z0-9]+", "_", s).strip("_")
    return s


def find_calendar():
    args = [a for a in sys.argv[1:] if a != "--dry-run"]
    if args:
        return args[0]
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


def sluggify(rows, label):
    out = []
    for i, row in enumerate(rows):
        if not isinstance(row, dict):
            sys.exit("%s row %d is not an object." % (label, i + 1))
        out.append({slug(k): ("" if v is None else str(v)) for k, v in row.items()})
    return out


def classify_blocks(md_path):
    """Returns (calendar_rows, log_rows), either possibly None."""
    with open(md_path, encoding="utf-8") as f:
        text = f.read()
    blocks = re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL)
    if not blocks:
        sys.exit("No fenced ```json block found in " + md_path)
    cal, log = None, None
    for raw in blocks:
        try:
            candidate = json.loads(raw)
        except json.JSONDecodeError:
            continue
        if not (isinstance(candidate, list) and candidate and all(isinstance(r, dict) for r in candidate)):
            continue
        keys = set()
        for r in candidate:
            keys |= {slug(k) for k in r}
        if "post" in keys:
            log = candidate
        elif "theme" in keys or "format" in keys:
            cal = candidate
    if cal is None and log is None:
        sys.exit("No json block looks like a calendar (theme/format fields) or a post log (post field).")
    return cal, log


def check_calendar(rows):
    clean = sluggify(rows, "Calendar")
    for i, rec in enumerate(clean):
        unknown = set(rec) - CAL_KEYS
        if unknown:
            sys.exit("Calendar row %d has unknown fields: %s. Allowed: %s"
                     % (i + 1, ", ".join(sorted(unknown)), ", ".join(sorted(CAL_KEYS))))
        if rec.get("date", "").strip().lower() == "(none)":
            rec["date"] = ""
        date = rec.get("date", "").strip()
        if date and not DATE_RE.match(date):
            sys.exit("Calendar row %d: date %r is not dd/mm/yyyy, yyyy-mm-dd or empty." % (i + 1, date))
        if not rec.get("format", "").strip() or not rec.get("theme", "").strip():
            sys.exit("Calendar row %d is missing format or theme — refusing to sync." % (i + 1))
    return clean


def check_log(rows):
    clean = sluggify(rows, "Log")
    for i, rec in enumerate(clean):
        unknown = set(rec) - LOG_KEYS
        if unknown:
            sys.exit("Log row %d has unknown fields: %s. Allowed: %s"
                     % (i + 1, ", ".join(sorted(unknown)), ", ".join(sorted(LOG_KEYS))))
        post = rec.get("post", "").strip()
        if not post.isdigit():
            sys.exit("Log row %d needs a whole post number." % (i + 1))
        date = rec.get("date", "").strip()
        if date and not DATE_RE.match(date):
            sys.exit("Log row %d: date %r is not dd/mm/yyyy or yyyy-mm-dd." % (i + 1, date))
        t = rec.get("posted_time", "").strip()
        if t and not TIME_RE.match(t):
            sys.exit("Log row %d: posted_time %r is not HH:MM." % (i + 1, t))
        for key in LOG_NUMERIC:
            v = rec.get(key, "").strip()
            if v:
                try:
                    float(v)
                except ValueError:
                    sys.exit("Log row %d: %s %r is not a number." % (i + 1, key, v))
    return clean


def main():
    dry = "--dry-run" in sys.argv
    md_path = find_calendar()
    cal_raw, log_raw = classify_blocks(md_path)
    payload = {"igsync": 1}
    if cal_raw is not None:
        payload["rows"] = check_calendar(cal_raw)
        print("Calendar block: %d rows." % len(payload["rows"]))
        for r in payload["rows"]:
            print("  %-12s %-9s %s" % (r.get("date") or "(held)", r.get("format", ""), r.get("theme", "")))
    if log_raw is not None:
        payload["log"] = check_log(log_raw)
        print("Post log block: %d rows." % len(payload["log"]))
        for r in payload["log"]:
            print("  post %-4s %-12s %s views · posted %s"
                  % (r.get("post"), r.get("date", ""), r.get("views", "—") or "—", r.get("posted_time", "") or "—"))
    if dry:
        print("Dry run: nothing was sent.")
        return
    payload["secret"] = read_secret()
    req = urllib.request.Request(APPS_SCRIPT_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read().decode())
    if body.get("ok"):
        bits = []
        if "rows" in body:
            bits.append("calendar: %s rows (%s statuses preserved)"
                        % (body.get("rows"), body.get("statusesKept", "?")))
        if body.get("logAdded") is not None:
            bits.append("post log: %s added, %s updated" % (body.get("logAdded"), body.get("logUpdated")))
        print("Synced — " + "; ".join(bits or ["done"]) + ".")
    else:
        sys.exit("Sync refused: %s" % body.get("error", "unknown error"))


if __name__ == "__main__":
    main()
