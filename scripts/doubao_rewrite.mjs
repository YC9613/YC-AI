import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";

const DOUBAO_URL = "https://www.doubao.com/chat/";
const DEFAULT_TIMEOUT_MS = 360000;
const MAX_CONTEXT_BYTES = 5 * 1024 * 1024;
const MAX_COPY_CHARS = 200000;

function usage() {
  return `用法：
  npm run login -- --headed
  npm run rewrite -- --context <上下文.md> --output <结果.json> [选项]

选项：
  --context <path>       prepare_rewrite_context.py 生成的 Markdown 或提取 JSON
  --output <path>        改写结果 JSON 输出路径
  --profile <path>       豆包浏览器配置目录；默认放在用户本机的应用数据目录
  --headed               显示浏览器窗口（默认）
  --headless             隐藏浏览器窗口；首次运行不能用它登录
  --login-only           只打开豆包并等待登录，不发送文案
  --timeout <ms>         等待豆包返回的最长时间，默认 ${DEFAULT_TIMEOUT_MS}
  --help                 显示帮助
`;
}

function parseArgs(argv) {
  const args = { headed: true, timeout: DEFAULT_TIMEOUT_MS };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") args.help = true;
    else if (token === "--headed") args.headed = true;
    else if (token === "--headless") args.headed = false;
    else if (token === "--login-only") args.loginOnly = true;
    else if (["--context", "--output", "--profile", "--timeout"].includes(token)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${token} 缺少参数`);
      args[token.slice(2)] = value;
      index += 1;
    } else {
      throw new Error(`未知参数：${token}`);
    }
  }
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout < 10000) throw new Error("--timeout 必须是不小于 10000 的毫秒数");
  if (args.help) return args;
  if (!args.loginOnly && (!args.context || !args.output)) throw new Error("改写模式必须提供 --context 和 --output");
  return args;
}

function defaultProfileDir() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  return path.join(localAppData, "DouyinLinkRewriter", "doubao-profile");
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readContext(file) {
  const absolute = path.resolve(file);
  if (!fs.existsSync(absolute)) throw new Error(`上下文文件不存在：${absolute}`);
  if (fs.statSync(absolute).size > MAX_CONTEXT_BYTES) throw new Error("上下文文件超过 5 MB，已拒绝处理");
  let context;
  if (path.extname(absolute).toLowerCase() === ".json") {
    const record = readJson(absolute);
    const item = Array.isArray(record) ? record[0] : record;
    if (!item || typeof item !== "object") throw new Error("上下文 JSON 不是对象");
    context = {
      sourceUrl: String(item.source_url || item.sourceUrl || "").trim(),
      title: String(item.original_title || item.title || "").trim(),
      copy: String(item.complete_copy || item.copy || "").trim()
    };
  } else {
    const markdown = fs.readFileSync(absolute, "utf8");
    const sourceUrl = markdown.match(/^来源链接：\s*(.*)$/m)?.[1]?.trim() || "";
    const title = markdown.match(/^原始标题：\s*(.*)$/m)?.[1]?.trim() || "";
    const copy = markdown.match(/## 原始文案\s*\r?\n\s*([\s\S]*?)(?=\r?\n## |$)/)?.[1]?.trim() || "";
    context = { sourceUrl, title, copy };
  }
  if (!context.copy) throw new Error("上下文中没有找到完整原文，请先运行 prepare_rewrite_context.py");
  if (context.copy.length > MAX_COPY_CHARS) throw new Error("完整原文超过 200000 字符，已拒绝发送");
  return context;
}

function readRewritePrompt() {
  const file = new URL("../references/rewrite_prompt.md", import.meta.url);
  return fs.readFileSync(file, "utf8").trim();
}

function buildInstructionPrompt() {
  return [
    readRewritePrompt(),
    "",
    "你将收到一条完整原文。先阅读并理解本条要求，收到后只回复：已准备好。",
    "不要在确认消息中提前改写正文。"
  ].join("\n");
}

function buildSourceMessage(context) {
  return [
    context.sourceUrl ? `来源链接：${context.sourceUrl}` : "",
    context.title ? `原始标题：${context.title}` : "",
    "",
    "完整原文：",
    context.copy,
    "",
    "请按上一条要求直接返回合法 JSON，不要输出 Markdown 代码围栏、解释或改写过程。"
  ].filter(Boolean).join("\n");
}

async function isVisible(locator) {
  try { return await locator.isVisible(); } catch { return false; }
}

async function findTextbox(page) {
  const textboxes = page.getByRole("textbox");
  for (let index = await textboxes.count() - 1; index >= 0; index -= 1) {
    if (await isVisible(textboxes.nth(index))) return textboxes.nth(index);
  }
  const selectors = [
    'textarea[placeholder*="发消息"]',
    'textarea[placeholder*="空格说话"]',
    '[contenteditable="true"][data-placeholder*="发消息"]',
    '[contenteditable="true"][aria-placeholder*="发消息"]',
    '[contenteditable="true"][data-lexical-editor="true"]',
    'div[contenteditable="true"]',
    "textarea"
  ];
  for (const selector of selectors) {
    const editors = page.locator(selector);
    for (let index = await editors.count() - 1; index >= 0; index -= 1) {
      if (await isVisible(editors.nth(index))) return editors.nth(index);
    }
  }
  throw new Error("未找到豆包聊天输入框，页面结构可能已更新");
}

async function textboxValue(textbox) {
  return String(await textbox.evaluate((element) => {
    if ("value" in element) return element.value;
    return element.innerText || element.textContent || "";
  }).catch(() => ""));
}

async function sendMessage(page, textbox, message) {
  await textbox.fill(message);
  await textbox.press("Enter");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (!(await textboxValue(textbox)).trim()) return;
    await page.waitForTimeout(150);
  }
  const buttons = [
    page.getByRole("button", { name: /^(发送|send)$/i }),
    page.locator('button[aria-label*="发送"], button[title*="发送"], button[data-testid*="send"]')
  ];
  for (const locator of buttons) {
    for (let index = await locator.count() - 1; index >= 0; index -= 1) {
      const button = locator.nth(index);
      if (!await isVisible(button) || !await button.isEnabled().catch(() => false)) continue;
      await button.click({ timeout: 5000 }).catch(() => {});
      if (!(await textboxValue(textbox)).trim()) return;
    }
  }
  throw new Error("未能触发豆包发送，请检查聊天输入框或发送按钮");
}

function findJsonCandidates(text) {
  const source = String(text || "");
  const candidates = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of source.matchAll(fenced)) {
    try { candidates.push(JSON.parse(match[1].trim())); } catch {}
  }
  for (let start = source.length - 1; start >= 0; start -= 1) {
    if (source[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < source.length; index += 1) {
      const character = source[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') quoted = true;
      else if (character === "{") depth += 1;
      else if (character === "}" && --depth === 0) {
        try { candidates.push(JSON.parse(source.slice(start, index + 1))); } catch {}
        break;
      }
    }
  }
  return candidates;
}

function validateResult(value) {
  const versions = Array.isArray(value) ? value : value?.versions;
  if (!Array.isArray(versions) || versions.length === 0) throw new Error("豆包返回结果缺少 versions 数组");
  const normalized = versions.map((item, index) => {
    const title = String(item?.title || "").trim();
    const body = String(item?.body || item?.content || "").trim();
    const angle = String(item?.angle || "").trim();
    if (!title || !body) throw new Error(`豆包返回的第 ${index + 1} 篇缺少标题或正文`);
    if (["改写标题", "完整改写正文"].includes(title) || body === "完整改写正文") {
      throw new Error(`豆包返回的第 ${index + 1} 篇仍是格式示例`);
    }
    if (body.length < 20) throw new Error(`豆包返回的第 ${index + 1} 篇正文过短`);
    return { angle, title, body };
  });
  return { versions: normalized };
}

function candidateFingerprint(value) {
  try { return JSON.stringify(value); } catch { return ""; }
}

function findNewValidResult(body, baseline) {
  const previous = new Set(findJsonCandidates(baseline).map(candidateFingerprint).filter(Boolean));
  const candidates = findJsonCandidates(body);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    if (previous.has(candidateFingerprint(candidates[index]))) continue;
    try { return validateResult(candidates[index]); } catch {}
  }
  return null;
}

async function waitForLogin(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const loginButton = page.getByRole("button", { name: "登录", exact: true });
    if (!await isVisible(loginButton)) {
      await findTextbox(page);
      return;
    }
    await page.waitForTimeout(1000);
  }
  throw new Error("等待豆包登录超时；请在打开的浏览器窗口中完成登录后重试");
}

async function openDoubao(profileDir, headed) {
  fs.mkdirSync(profileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: !headed,
    channel: "chrome",
    viewport: { width: 1450, height: 960 },
    slowMo: headed ? 80 : 0,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-session-crashed-bubble"]
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(DOUBAO_URL, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(1800);
  return { context, page };
}

function ensureNoRiskPage(body) {
  if (/验证码|安全验证|访问过于频繁|账号存在风险/.test(body)) {
    throw new Error("豆包页面出现验证或风控提示，请稍后在浏览器中处理后重试");
  }
}

async function waitForAck(page, baseline, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 90000);
  const startedAt = Date.now();
  const baselineReadyCount = (String(baseline).match(/已准备好/g) || []).length;
  let lastBody = String(baseline);
  let stableRounds = 0;
  let changed = false;
  while (Date.now() < deadline) {
    await page.waitForTimeout(800);
    const body = await page.locator("body").innerText().catch(() => "");
    ensureNoRiskPage(body);
    if (body !== baseline && Math.abs(body.length - baseline.length) > 2) changed = true;
    if (changed && body === lastBody) stableRounds += 1;
    else stableRounds = 0;
    lastBody = body;
    const readyCount = (body.match(/已准备好/g) || []).length;
    if (readyCount > baselineReadyCount) return;
    if (changed && Date.now() - startedAt >= 10000 && stableRounds >= 3) return;
  }
  throw new Error("豆包未确认改写要求，请检查页面是否正常响应");
}

async function waitForResult(page, baseline, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let latestBody = baseline;
  while (Date.now() < deadline) {
    await page.waitForTimeout(2000);
    latestBody = await page.locator("body").innerText().catch(() => "");
    ensureNoRiskPage(latestBody);
    if (latestBody === baseline) continue;
    const result = findNewValidResult(latestBody, baseline);
    if (result) return result;
  }
  const tail = latestBody.replace(/\s+/g, " ").slice(-500);
  throw new Error(`豆包未返回符合格式的改写结果。页面末尾：${tail}`);
}

function writeJson(file, payload) {
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, absolute);
  return absolute;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const profileDir = path.resolve(args.profile || defaultProfileDir());
  const { context, page } = await openDoubao(profileDir, args.headed);
  try {
    const loginButton = page.getByRole("button", { name: "登录", exact: true });
    if (await isVisible(loginButton)) {
      if (args.loginOnly) {
        console.log("浏览器已打开，请在豆包页面中完成登录；登录成功后脚本会继续检查页面。");
        await waitForLogin(page, args.timeout);
        console.log("豆包登录状态已就绪。以后可复用同一个 profile 目录运行改写。");
        return;
      }
      throw new Error("豆包当前未登录。先运行 npm run login -- --headed，在浏览器中手动完成登录后再改写。");
    }
    await findTextbox(page);
    if (args.loginOnly) {
      console.log("当前 profile 已有可用的豆包登录状态，无需重复登录。");
      return;
    }
    const source = readContext(args.context);
    const firstTextbox = await findTextbox(page);
    await sendMessage(page, firstTextbox, buildInstructionPrompt());
    const promptBaseline = await page.locator("body").innerText().catch(() => "");
    await waitForAck(page, promptBaseline, args.timeout);
    const secondTextbox = await findTextbox(page);
    await sendMessage(page, secondTextbox, buildSourceMessage(source));
    const resultBaseline = await page.locator("body").innerText().catch(() => "");
    const result = await waitForResult(page, resultBaseline, args.timeout);
    const output = {
      source_url: source.sourceUrl,
      original_title: source.title,
      provider: "doubao-web",
      generated_at: new Date().toISOString(),
      versions: result.versions
    };
    const outputFile = writeJson(args.output, output);
    console.log(JSON.stringify({ status: "ok", output: outputFile, versions: result.versions.length }, null, 2));
  } finally {
    await context.close().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`失败：${error.message}`);
    process.exitCode = 1;
  });
}

export { buildSourceMessage, findJsonCandidates, findNewValidResult, parseArgs, readContext, validateResult };
