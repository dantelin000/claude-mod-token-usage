[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

# token-usage

Claude Desktop（Code 标签页）输入框上方的用量条：5h / 7d 额度、token 用量、花费。在终端机版 CLI 里会显示成一行文字。

> 这是 [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage) 的 fork。
> **v1.2.0** 新增外部 API 用量账本与 `/usage-ext` 命令（用量条不变），见《[外部 API 用量](#外部-api-用量usage-ext)》。
> **v1.1.1** 修正分支（fork）出来的会话把父会话的费用当成自己的：金额格现在只显示这个对话自己的花费。
> **v1.1.0** 修正 token 三格严重少算（改为每个 API 回应计一次）、终端机版不显示、盖掉其他插件内容的问题，详见 [更新记录](CHANGELOG.zh-CN.md)。

## 安装
- macOS：`bash install.sh`
- Windows：在 PowerShell 执行 `powershell -ExecutionPolicy Bypass -File install.ps1`

完成后完全关闭并重新打开 Claude Desktop。脚本会备份并合并 `~/.claude/settings.json`（只在 `env` 里新增两个变量）。

## 需求
- 支持 mod 功能的新版 Claude Code / Claude Desktop
- 5h / 7d 额度需要订阅账号；第一次回应之后才有数据

## 外部 API 用量（`/usage-ext`）

Claude Code 自己的费用（金额格、`/cost`）只覆盖它自己发出的请求。子代理或脚本直接调用别的 API（Vertex AI、OpenAI、Ollama……）时，这些 token 它看不到。这个 mod 可以在本机记一本账，并估算这些调用的费用。它不画在用量条上，要用命令查。

**1. 记录每次调用。** 把 API 响应（或只有 usage 对象）交给辅助脚本。它只留数字，不留提示词和回复内容，并用 `$CLAUDE_CODE_SESSION_ID` 标上会话：

```bash
~/.claude/mods/token-usage/bin/tu-log --provider vertex < response.json
~/.claude/mods/token-usage/bin/tu-log --provider openai --model gpt-x '{"usage":{"prompt_tokens":500,"completion_tokens":200}}'
```

也可以用任何语言自己在 `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl`（本地日期）后面追加一行。`ts` 是毫秒，`usage` 是该 provider 自己返回的 usage 对象：

```json
{"ts":1793148848057,"session":"<CLAUDE_CODE_SESSION_ID>","provider":"vertex","model":"gemini-x","usage":{"promptTokenCount":12000,"candidatesTokenCount":340}}
```

可识别：Gemini / Vertex 的 `usageMetadata`（含 Gemini CLI 的统计）、OpenAI（chat 和 Responses）、Anthropic、Ollama。（辅助脚本需要 Python 3；Windows 请用 `python tu-log` 运行，未在 Windows 测试。）

**2. 价格（可选）。** 把 `prices.example.json` 复制成 `~/.claude/token-usage/prices.json`，照你 provider 的价格页填入每百万 token 的美元单价。本项目不附任何真实价格。没有输入和输出单价的模型只统计 token，标为未定价。缺 `cached` / `cacheWrite` 单价时用输入价，缺 `thinking` 时用输出价；`longPrompt` 可以设置提示超过某长度后的较高单价。

**3. 查询。** `/usage-ext` 看本对话，或 `/usage-ext today`、`7d`、`all`。加 `json` 输出机器可读的结果。环境变量 `TOKEN_USAGE_EXT_DIR` 可以更改文件夹。

**限制。** mod 看不到其他程序的网络流量，所以只有被记录的调用才会计入。估价 = token x 你填的单价，以 provider 的账单为准。

## 卸载
删除 `~/.claude/mods/token-usage`，并从 `settings.json` 的 `env` 中移除 `CLAUDE_CODE_PLUGIN_DIRS` 与 `CLAUDE_CODE_PLUGIN_DIR_WATCH`。
