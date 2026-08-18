# YC/AI Douyin Full Copy Extraction & Rewrite Module

English | [中文](README.md)

An AI software dedicated to fully automated Douyin account operation.

A local copy extraction and Doubao web auto-rewrite tool centered on source links.

The program reads source links, titles, and corresponding audio files, extracts complete voice transcripts, uniformly converts them to Simplified Chinese, generates rewrite context, and automatically opens Doubao in the local browser to complete the rewrite.

## Features

- Read source link manifest
- Extract complete voice transcripts from audio
- Convert to Simplified Chinese
- Save source links, titles, transcripts, and timelines
- Output in JSON, TXT, Markdown
- Generate ready-to-use rewrite context
- Automatically open Doubao web and submit rewrite requests
- Wait for Doubao to return JSON and save rewrite results

## Input Manifest

See [manifest.example.json](examples/manifest.example.json) for the format:

```json
{
  "records": [
    {
      "group": "CategoryA",
      "videoId": "video-001",
      "sourceUrl": "https://example.com/source-video",
      "title": "Example Title",
      "audioPath": "./input/audio/video-001.mp3"
    }
  ]
}
```

Field descriptions:

- `group`: Output category
- `videoId`: Content identifier
- `sourceUrl`: Source link
- `title`: Title
- `audioPath`: Local audio file path

## Installation

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
py -3 -m pip install -r requirements.txt
npm.cmd install
```

## Extract Copy

```powershell
.\run_windows.ps1 `
  -Manifest ".\input\manifest.json" `
  -OutputDir ".\output\20260817" `
  -Date "2026-08-17"
```

Or run directly:

```powershell
py -3 .\scripts\extract_link_copy.py `
  --manifest ".\input\manifest.json" `
  --out-dir ".\output\20260817" `
  --date "2026-08-17"
```

Existing results are reused automatically; add `--force` to reprocess.

## Prepare Rewrite Context

After extraction, use the generated JSON file to prepare rewrite context:

```powershell
py -3 .\scripts\prepare_rewrite_context.py `
  --input ".\output\20260817\benchmark_transcripts\CategoryA\video-001.json" `
  --output ".\output\20260817\rewrite_context\video-001.md"
```

Hand the generated context to Doubao for processing. See [rewrite_prompt.md](references/rewrite_prompt.md) for rewrite rules.

## Auto-Invoke Doubao Web Rewrite

This step uses Playwright to control Doubao in your local Chrome — it does **not** use the Doubao API. First time, open the login window and complete login manually in the browser:

```powershell
npm.cmd run login -- --headed
```

Login state is saved in an external browser profile directory on your local machine, determined by the system's `LOCALAPPDATA` by default — it is never written into the project directory. After login, run:

```powershell
npm.cmd run rewrite -- `
  --context ".\output\20260817\rewrite_context\video-001.md" `
  --output ".\output\20260817\rewrite_results\video-001.json" `
  --headed
```

The script sends the rewrite instruction first, then the full transcript within the same Doubao session, and waits for valid JSON before saving the result. To switch browser login state, use `--profile` to specify a different external directory:

```powershell
npm.cmd run rewrite -- `
  --context ".\output\20260817\rewrite_context\video-001.md" `
  --output ".\output\20260817\rewrite_results\video-001.json" `
  --profile ".\runtime\doubao-profile-2" `
  --headed
```

The project does not contain account lists, passwords, cookies, API keys, or browser login data — these exist only in the local profile directory you specify at runtime.

## Output Fields

Each JSON record contains:

- `source_url`: Source link
- `original_title`: Original title
- `complete_copy`: Complete Simplified Chinese transcript
- `segments`: Transcript segments with start and end timestamps
- `duration_seconds`: Audio duration
- `language`: Output language
- `extracted_at`: Processing timestamp

## Output Structure

The output directory contains:

- One JSON file per content item
- One TXT file per content item
- One Markdown summary file per category
- Rewrite context files (when generated)
- Doubao rewrite result JSON files (when generated)

## Disclaimer

> ⚠️ This tool is intended for efficiency assistance in personal content creation only. Please comply with the terms of service of respective platforms (Douyin, Doubao, etc.). Do not use for bulk reposting, plagiarism, or any platform-policy-violating activities.
