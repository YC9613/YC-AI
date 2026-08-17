from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from copy_text_utils import normalize_record_to_simplified, to_simplified, write_author_exports


def read_records(manifest_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    rows = payload if isinstance(payload, list) else payload.get("records", [])
    if not isinstance(rows, list):
        raise SystemExit("Temporary audio manifest must contain a records array.")
    return rows


def local_whisper_utterances(
    audio_path: Path,
    *,
    model_name: str,
    requested_device: str = "auto",
    requested_compute_type: str = "auto",
) -> tuple[list[dict[str, Any]], str, str, str]:
    from faster_whisper import WhisperModel

    candidates: list[tuple[str, str]] = []
    if requested_device in ("auto", "cuda"):
        candidates.append(("cuda", "float16" if requested_compute_type == "auto" else requested_compute_type))
    if requested_device in ("auto", "cpu"):
        candidates.append(("cpu", "int8" if requested_compute_type == "auto" else requested_compute_type))
    errors: list[str] = []
    for device, compute_type in candidates:
        try:
            print(f"Local transcription starting: model={model_name} device={device} compute_type={compute_type}", flush=True)
            model = WhisperModel(model_name, device=device, compute_type=compute_type)
            segments_iter, _ = model.transcribe(str(audio_path), language="zh", vad_filter=True, beam_size=3)
            utterances = [
                {
                    "start_time": round(float(segment.start) * 1000),
                    "end_time": round(float(segment.end) * 1000),
                    "transcript": str(segment.text or "").strip(),
                }
                for segment in segments_iter
                if str(segment.text or "").strip()
            ]
            if not utterances:
                raise RuntimeError("Local Whisper returned no utterances.")
            return utterances, "local-whisper-v1", device, compute_type
        except Exception as error:
            errors.append(f"{device}/{compute_type}: {error}")
            print(f"Local transcription {device}/{compute_type} failed: {error}", flush=True)
    raise RuntimeError("Local Whisper fallback failed: " + " | ".join(errors))


def source_utterances(
    audio_path: Path,
    *,
    model_name: str,
    requested_device: str = "auto",
    requested_compute_type: str = "auto",
) -> tuple[list[dict[str, Any]], str, str, str]:
    return local_whisper_utterances(
        audio_path,
        model_name=model_name,
        requested_device=requested_device,
        requested_compute_type=requested_compute_type,
    )


def transcribe_audio(
    item: dict[str, Any],
    date: str,
    *,
    model_name: str,
    requested_device: str,
    requested_compute_type: str,
) -> dict[str, Any]:
    utterances, engine, device, compute_type = source_utterances(
        Path(str(item["audioPath"])),
        model_name=model_name,
        requested_device=requested_device,
        requested_compute_type=requested_compute_type,
    )
    segments = []
    text_parts = []
    for utterance in utterances:
        text = to_simplified(str(utterance.get("transcript") or "").strip())
        if not text:
            continue
        start_ms = float(utterance.get("start_time") or 0)
        end_ms = float(utterance.get("end_time") or start_ms)
        text_parts.append(text)
        segments.append({
            "start": round(start_ms / 1000, 2),
            "end": round(end_ms / 1000, 2),
            "text": text,
        })
    duration = segments[-1]["end"] if segments else 0
    return {
        "date": date,
        "group": str(item.get("group") or item.get("author") or ""),
        "video_id": str(item["videoId"]),
        "video_path": "",
        "source_mode": "link-transcribe",
        "asr_engine": engine,
        "asr_device": device,
        "asr_compute_type": compute_type,
        "source_url": str(item.get("sourceUrl", "")),
        "original_title": str(item.get("title", "")),
        "duration_seconds": round(duration, 2),
        "language": "zh-Hans",
        "complete_copy": "\n".join(text_parts),
        "segments": segments,
        "extracted_at": datetime.now().isoformat(timespec="seconds"),
    }


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="Extract copy from linked source audio.")
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--date", required=True)
    parser.add_argument("--engine", choices=["source"], default="source")
    parser.add_argument("--model", default="small")
    parser.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    parser.add_argument("--compute-type", default="auto")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    transcript_root = out_dir / "benchmark_transcripts"
    transcript_root.mkdir(parents=True, exist_ok=True)
    rows = read_records(Path(args.manifest))
    if not rows:
        print(json.dumps({"transcribed": 0, "outDir": str(out_dir)}, ensure_ascii=False))
        return 0

    by_author: dict[str, list[dict[str, Any]]] = {}
    failures: list[dict[str, str]] = []
    for index, item in enumerate(rows, 1):
        author = str(item.get("group") or item.get("author") or "").strip()
        video_id = str(item["videoId"]).strip()
        audio_path = Path(str(item["audioPath"]))
        if not author or not video_id or not audio_path.is_file():
            failures.append({
                "author": author,
                "videoId": video_id,
                "error": f"Invalid temporary audio record at index {index}.",
            })
            print(f"[{index}/{len(rows)}] skipped invalid temporary audio record {author}/{video_id}", flush=True)
            continue
        author_dir = transcript_root / author
        author_dir.mkdir(parents=True, exist_ok=True)
        json_path = author_dir / f"{video_id}.json"
        txt_path = author_dir / f"{video_id}.txt"
        try:
            if json_path.exists() and not args.force:
                record = json.loads(json_path.read_text(encoding="utf-8"))
                record, changed = normalize_record_to_simplified(record)
                if changed:
                    json_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
                    txt_path.write_text(str(record.get("complete_copy", "")).rstrip() + "\n", encoding="utf-8")
                print(f"[{index}/{len(rows)}] reuse {author}/{video_id}")
            else:
                print(f"[{index}/{len(rows)}] extracting copy with local Whisper {author}/{video_id}", flush=True)
                record = transcribe_audio(
                    item,
                    args.date,
                    model_name=args.model,
                    requested_device=args.device,
                    requested_compute_type=args.compute_type,
                )
                if not str(record.get("complete_copy", "")).strip():
                    raise RuntimeError(f"Local Whisper returned empty copy for {author}/{video_id}.")
                json_path.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
                txt_path.write_text(record["complete_copy"].rstrip() + "\n", encoding="utf-8")
            by_author.setdefault(author, []).append(record)
        except Exception as error:
            failures.append({
                "author": author,
                "videoId": video_id,
                "error": str(error),
            })
            print(
                f"[{index}/{len(rows)}] deferred after retries {author}/{video_id}: {error}",
                file=sys.stderr,
                flush=True,
            )
            continue

    for author, records in by_author.items():
        write_author_exports(out_dir, args.date, author, sorted(records, key=lambda item: item["video_id"]))
    failure_path = out_dir / f"benchmark_transcription_failures_{args.date.replace('-', '')}.json"
    if failures:
        failure_path.write_text(json.dumps({
            "date": args.date,
            "failed": failures,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    elif failure_path.exists():
        failure_path.unlink()
    completed = sum(len(records) for records in by_author.values())
    print(json.dumps({
        "transcribed": completed,
        "failed": len(failures),
        "outDir": str(out_dir),
        "savedMp4": 0,
        "engines": sorted({str(record.get("asr_engine", "")) for records in by_author.values() for record in records if record.get("asr_engine")}),
        "devices": sorted({str(record.get("asr_device", "")) for records in by_author.values() for record in records if record.get("asr_device")}),
    }, ensure_ascii=False))
    if failures:
        print(
            f"{len(failures)} item(s) remain. Re-run the same task to reuse completed transcripts and continue failures.",
            file=sys.stderr,
            flush=True,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
