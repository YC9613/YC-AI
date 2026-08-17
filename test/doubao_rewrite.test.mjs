import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSourceMessage,
  findJsonCandidates,
  findNewValidResult,
  parseArgs,
  validateResult
} from "../scripts/doubao_rewrite.mjs";

test("help does not require rewrite paths", () => {
  assert.equal(parseArgs(["--help"]).help, true);
});

test("source message contains only public source fields and copy", () => {
  const message = buildSourceMessage({
    sourceUrl: "https://example.com/source-video",
    title: "示例标题",
    copy: "这是一段足够长、用于验证自动改写输入构造的完整示例文案。"
  });
  assert.match(message, /来源链接/);
  assert.match(message, /完整原文/);
  assert.doesNotMatch(message, /password|cookie|token|api[_ -]?key/i);
});

test("JSON candidate parser ignores braces inside strings", () => {
  const candidates = findJsonCandidates('前文 {"versions":[{"title":"标题","body":"正文中包含 { 花括号 }，但仍是有效字符串。正文长度也足够用于测试。"}]} 后文');
  assert.equal(validateResult(candidates.at(-1)).versions[0].title, "标题");
});

test("prompt example cannot be mistaken for a new Doubao result", () => {
  const example = '{"versions":[{"angle":"内容角度","title":"改写标题","body":"完整改写正文"}]}';
  const generated = '{"versions":[{"angle":"新的表达角度","title":"这是新的改写标题","body":"这是豆包在发送原文之后生成的完整正文，内容长度足够，并且不会被示例结果误判覆盖。"}]}';
  assert.equal(findNewValidResult(`${example}\n用户原文`, example), null);
  assert.equal(findNewValidResult(`${example}\n${generated}`, example)?.versions[0].title, "这是新的改写标题");
});
