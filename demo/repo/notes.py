#!/usr/bin/env python3
"""notes.py — a tiny CLI notes app. The demo agents modify this file."""
import argparse
import json
import os
import sys

STORE = os.environ.get("NOTES_FILE", os.path.expanduser("~/.notes.json"))


def load():
    if not os.path.exists(STORE):
        return []
    with open(STORE) as f:
        return json.load(f)


def save(notes):
    with open(STORE, "w") as f:
        json.dump(notes, f, indent=2)


def cmd_add(args):
    notes = load()
    note = {"id": len(notes) + 1, "text": args.text}
    notes.append(note)
    save(notes)
    print(f"added note #{note['id']}")


def cmd_list(args):
    notes = load()
    if not notes:
        print("no notes yet")
        return
    for n in notes:
        print(f"#{n['id']}: {n['text']}")


def cmd_delete(args):
    notes = load()
    kept = [n for n in notes if n["id"] != args.id]
    if len(kept) == len(notes):
        print(f"no note #{args.id}", file=sys.stderr)
        sys.exit(1)
    save(kept)
    print(f"deleted note #{args.id}")


def main():
    parser = argparse.ArgumentParser(prog="notes", description="tiny notes CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_add = sub.add_parser("add", help="add a note")
    p_add.add_argument("text", help="note text")
    p_add.set_defaults(func=cmd_add)

    p_list = sub.add_parser("list", help="list notes")
    p_list.set_defaults(func=cmd_list)

    p_del = sub.add_parser("delete", help="delete a note")
    p_del.add_argument("id", type=int, help="note id")
    p_del.set_defaults(func=cmd_delete)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
