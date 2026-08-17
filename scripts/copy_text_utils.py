from __future__ import annotations

import json
from pathlib import Path


SIMPLIFIER = None


def to_simplified(text: str) -> str:
    global SIMPLIFIER
    if SIMPLIFIER is None:
        from opencc import OpenCC

        SIMPLIFIER = OpenCC("t2s")
    return SIMPLIFIER.convert(text or "")


def normalize_record_to_simplified(record: dict) -> tuple[dict, bool]:
    changed = False
    next_record = dict(record)
    copy = to_simplified(str(next_record.get("complete_copy", "")))
    if copy != str(next_record.get("complete_copy", "")):
        next_record["complete_copy"] = copy
        changed = True

    segments = []
    for segment in next_record.get("segments", []) or []:
        next_segment = dict(segment)
        text = to_simplified(str(next_segment.get("text", "")))
        if text != str(next_segment.get("text", "")):
            next_segment["text"] = text
            changed = True
        segments.append(next_segment)
    if segments:
        next_record["segments"] = segments

    if next_record.get("language") != "zh-Hans":
        next_record["language"] = "zh-Hans"
        changed = True
    return next_record, changed


def write_author_exports(out_dir: Path, date: str, author: str, records: list[dict]) -> None:
    compact = date.replace("-", "")
    json_path = out_dir / f"copy_{author}_{compact}.json"
    md_path = out_dir / f"copy_{author}_{compact}.md"
    json_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [f"# 文案整理：{author} {date}", ""]
    for index, record in enumerate(records, 1):
        lines.extend(
            [
                f"## {index}. {record['video_id']}",
                "",
                f"- 来源链接：{record.get('source_url', '')}",
                f"- 标题：{record.get('original_title', '')}",
                "",
                to_simplified(record.get("complete_copy", "")),
                "",
            ]
        )
    md_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
