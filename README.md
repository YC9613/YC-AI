# YC/AI抖音全获取文案-改写模块

一个以来源链接为核心的本地文案提取和豆包网页自动改写工具。

程序读取来源链接、标题和对应音频文件，提取完整语音文案，统一转换为简体中文，生成改写上下文，并通过本机浏览器自动打开豆包网页完成改写。

## 功能

- 读取来源链接清单
- 提取音频中的完整语音文案
- 转换为简体中文
- 保存来源链接、标题、文案和时间轴
- 输出 JSON、TXT、Markdown
- 生成可直接使用的改写上下文
- 自动打开豆包网页并提交改写要求
- 等待豆包返回 JSON 并保存改写结果

## 输入清单

清单格式见：[manifest.example.json](examples/manifest.example.json)

```json
{
  "records": [
    {
      "group": "分类A",
      "videoId": "video-001",
      "sourceUrl": "https://example.com/source-video",
      "title": "示例标题",
      "audioPath": "./input/audio/video-001.mp3"
    }
  ]
}
```

字段说明：

- `group`：输出分类
- `videoId`：内容编号
- `sourceUrl`：来源链接
- `title`：标题
- `audioPath`：本地音频文件路径

## 安装

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
py -3 -m pip install -r requirements.txt
npm.cmd install
```

## 提取文案

```powershell
.\run_windows.ps1 `
  -Manifest ".\input\manifest.json" `
  -OutputDir ".\output\20260817" `
  -Date "2026-08-17"
```

也可以直接运行：

```powershell
py -3 .\scripts\extract_link_copy.py `
  --manifest ".\input\manifest.json" `
  --out-dir ".\output\20260817" `
  --date "2026-08-17"
```

已有结果会自动复用；需要重新处理时增加 `--force`。

## 准备改写上下文

提取完成后，使用生成的 JSON 文件准备改写上下文：

```powershell
py -3 .\scripts\prepare_rewrite_context.py `
  --input ".\output\20260817\benchmark_transcripts\分类A\video-001.json" `
  --output ".\output\20260817\rewrite_context\video-001.md"
```

将生成的上下文交给豆包处理，改写规则见：[rewrite_prompt.md](references/rewrite_prompt.md)。

## 自动调用豆包网页改写

这一步使用 Playwright 控制本机 Chrome 中的豆包网页，不使用豆包 API。第一次使用时先打开登录窗口，在浏览器中手动完成登录：

```powershell
npm.cmd run login -- --headed
```

登录状态保存在用户本机的外部浏览器配置目录中，默认位置由系统的 `LOCALAPPDATA` 决定，不会写入项目目录。完成登录后，运行：

```powershell
npm.cmd run rewrite -- `
  --context ".\output\20260817\rewrite_context\video-001.md" `
  --output ".\output\20260817\rewrite_results\video-001.json" `
  --headed
```

脚本会在同一个豆包网页会话中先发送改写要求，再发送完整文案，等待合法 JSON 后保存结果。需要切换本机浏览器登录状态时，可用 `--profile` 指定另一个外部目录：

```powershell
npm.cmd run rewrite -- `
  --context ".\output\20260817\rewrite_context\video-001.md" `
  --output ".\output\20260817\rewrite_results\video-001.json" `
  --profile ".\runtime\doubao-profile-2" `
  --headed
```

项目不包含账号列表、密码、Cookie、API Key 或浏览器登录数据；这些只存在于你运行时指定的本机 profile 目录中。

## 输出字段

每条 JSON 记录包含：

- `source_url`：来源链接
- `original_title`：原始标题
- `complete_copy`：完整简体中文文案
- `segments`：带开始和结束时间的文案片段
- `duration_seconds`：音频时长
- `language`：输出语言
- `extracted_at`：处理时间

## 运行结果

输出目录包含：

- 每条内容一个 JSON 文件
- 每条内容一个 TXT 文件
- 每个分类一个 Markdown 汇总文件
- 需要时生成单条改写上下文文件
- 需要时生成豆包改写结果 JSON 文件
