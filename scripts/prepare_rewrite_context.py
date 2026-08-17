from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a rewrite context from extracted copy.")
    parser.add_argument("--input", required=True, type=Path, help="Extracted JSON file")
    parser.add_argument("--output", required=True, type=Path, help="Markdown context file")
    args = parser.parse_args()

    record = json.loads(args.input.read_text(encoding="utf-8"))
    if isinstance(record, list):
        if not record:
            raise SystemExit("Input JSON is empty.")
        record = record[0]
    copy = str(record.get("complete_copy", "")).strip()
    if not copy:
        raise SystemExit("Input JSON has no complete_copy.")

    content = "\n".join(
        [
            "# 文案改写上下文",
            "",
            f"来源链接：{record.get('source_url', '')}",
            f"原始标题：{record.get('original_title', '')}",
            "",
            "## 原始文案",
            "",
            copy,
            "",
            "## 改写要求",
            "",
            "保留原文事实、数字、逻辑和结论，正文有效信息量不得低于原文的 90%。根据内容选择合适角度，重新组织标题、开头、句式、段落结构和表达顺序，不新增原文没有的信息，不做近似复制，输出适合口播的完整正文。",
            "输出 JSON 格式：{\"versions\":[{\"angle\":\"内容角度\",\"title\":\"改写标题\",\"body\":\"完整改写正文\"}]}。",
            "",
        ]
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(content, encoding="utf-8")
    print(json.dumps({"status": "ok", "output": str(args.output.resolve())}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
