[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

# token-usage

Claude Desktop（Code 标签页）输入框上方的用量条：5h / 7d 额度、token 用量、花费。在终端机版 CLI 里会显示成一行文字。

> 这是 [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage) 的 fork。
> **v1.3.0** 自动记下 Bash / MCP 工具输出里打印出的用量，并内置价格表（**内置价格最后更新：2026-10-28**），见《[自动捕获](#自动捕获v130)》和《[内置价格](#内置价格)》。
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

**1. 记录每次调用。** 有两种方式，两者不会重复计算（见下）。

*自动（v1.3.0）。* 当本会话里的 Bash 或 MCP 工具调用打印出 provider 的 usage 对象时，mod 会自动记下，不用设置。见《[自动捕获](#自动捕获v130)》。

*手动。* 把 API 响应（或只有 usage 对象）交给辅助脚本。它只留数字，不留提示词和回复内容，并用 `$CLAUDE_CODE_SESSION_ID` 标上会话：

```bash
~/.claude/mods/token-usage/bin/tu-log --provider vertex < response.json
~/.claude/mods/token-usage/bin/tu-log --provider openai --model gpt-x '{"usage":{"prompt_tokens":500,"completion_tokens":200}}'
```

也可以用任何语言自己在 `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl`（本地日期）后面追加一行。`ts` 是毫秒，`usage` 是该 provider 自己返回的 usage 对象：

```json
{"ts":1793148848057,"session":"<CLAUDE_CODE_SESSION_ID>","provider":"vertex","model":"gemini-x","usage":{"promptTokenCount":12000,"candidatesTokenCount":340}}
```

可识别：Gemini / Vertex 的 `usageMetadata`（含 Gemini CLI 的统计）、OpenAI（chat 和 Responses）、Anthropic（含 5 分钟和 1 小时缓存写入）、Ollama。（辅助脚本需要 Python 3；Windows 请用 `python tu-log` 运行，未在 Windows 测试。）

**2. 价格。** mod 内置一份价格表（见《[内置价格](#内置价格)》），所以 `/usage-ext` 开箱就能估价。要补上表里没有的模型，或覆盖某个价格，把 `prices.example.json` 复制成 `~/.claude/token-usage/prices.json`，照你 provider 的价格页填入每百万 token 的美元单价。你填的某个模型会整条取代内置的那一条，其余仍用内置价格。内置表和你的表里都没有输入和输出单价的模型只统计 token，标为未定价（不会显示成 $0）。缺 `cached` 单价时用输入价，`cacheWrite` 也是，缺 `cacheWrite1h` 时用 `cacheWrite`，缺 `thinking` 时用输出价；`longPrompt` 可设置提示超过某长度后的更高单价；`effective` 可设置从某个日期起改用的单价。

**3. 查询。** `/usage-ext` 看本对话，或 `/usage-ext today`、`7d`、`all`。加 `json` 输出机器可读的结果。环境变量 `TOKEN_USAGE_EXT_DIR` 可以更改文件夹。输出里会附上内置价格的日期（"built-in prices updated YYYY-MM-DD"）。

**限制。** mod 看不到其他程序的网络流量，所以只有被记录、或用量被打印在工具结果里（见下）的调用才会计入。人在终端里自己运行、不经过 Claude Code 的脚本不在范围内。估价 = token x 单价，以 provider 的账单为准。

### 自动捕获（v1.3.0）

当 **Bash 或 MCP 工具调用** 的输出里含有 provider 的 usage 对象时，mod 会把它追加进账本。它读输出文本里完整的 JSON 对象：Gemini / Vertex 的 `usageMetadata`、Gemini CLI 的 `stats.models`、OpenAI（chat 和 Responses）、Anthropic、Ollama。

- **只留数字。** 不留提示词、回复、命令或输出文本。每行只有 usage 数字、会话 id、工具名称（`auto: Bash`、`auto: mcp__server__tool`），以及输出里有的话就带上 `model` 和 `provider`。provider 只在能判断时填入：Ollama 的响应格式，以及 `claude-*`、`gpt-*` / o 系列的模型 id；Gemini 不填（Gemini API 和 Vertex AI 打印出的格式相同）。
- **只有真的被打印出来的用量才捕获得到。** 只打印回复文字的脚本，仍然需要加一行 `tu-log`。另外看不到的：工具把 JSON 从中间截断的输出、Python `repr` 的字典（单引号）、后台运行的命令（Bash 的结果在它们结束前就返回了）、脚本根本没打印的用量。
- **不重复计算。** 命令执行期间如果已经用 `tu-log` 记下同一次调用（同一会话、同样的数字、不矛盾的模型），自动那一行就跳过。同一份输出里打印了两次的同样数字只算一次。*之后另外*再用 `tu-log` 记一次"用量已被打印"的响应，会变成第二行：一个响应只记一次。
- **不记：** 只是显示文件或文本的命令（`cat`、`grep`、`jq`、`git diff`……，不含命令替换），因为它打印的是别人的文档或先前的响应；账本本身的行；通用的 `{"input": .., "output": ..}` 组合（不是 provider 的格式）；token 数为零的对象。流式事件日志里重复或累计的用量不会去重。
- **存放位置。** `~/.claude/token-usage/ledger/YYYY-MM-DD.auto-<会话>.jsonl`，每个会话一个文件。分开存是因为 mod 只能整个文件重写，而不能重写 `tu-log` 正在追加的文件。删掉文件就删掉其中的记录。
- **关闭。** 设置 `TOKEN_USAGE_AUTO=off`（例如放在 `settings.json` 的 `env` 里）。`/usage-ext` 会说明有几行是自动记下的。

### 内置价格

**内置价格最后更新：2026-10-28**（读取下列页面的日期；即 `prices.default.json` 的 `updated`，`/usage-ext` 也会打印出来）。

来源，均于该日读取：
- Anthropic：<https://platform.claude.com/docs/en/about-claude/pricing>（并与 Claude Code 自己模型目录里的各模型费率交叉核对）
- OpenAI：<https://developers.openai.com/api/docs/pricing>
- Google，Gemini API：<https://ai.google.dev/gemini-api/docs/pricing>
- Google，Vertex AI：<https://cloud.google.com/vertex-ai/generative-ai/pricing>（用来对照，见下）

**价格会变，以 provider 的账单为准。** 这张表是某一天的牌价，不是保证。之后会以补丁版本（1.3.1……）更新，每次都带新日期。页面已公布的调价，表里有记：`gemini-4-argon` 在 2026-12-01 涨价，`gemini-3.8-flash` 和 `gemini-3.6-flash` 在 2027-01-01 涨价（各 provider 页面没给时区，**假定为 UTC**），每条记录按它被记下的那一天计价。`gpt-5.6-sol` 是促销价，OpenAI 写明"至少到 2026-11-21 有效"，也没公布正常价；该条的备注有说明。

**收录内容：** 75 个模型，标准（Standard）档牌价，单位为每百万 token 的美元：Anthropic（Claude Fable、Mythos、Opus、Sonnet、Haiku，含 5 分钟和 1 小时缓存写入，以及 Haiku 5.5 在提示超过 100k token 时的更高单价）、OpenAI（GPT-6 / 5.x / 4.x / o 系列、Codex、Cyber 和 Rosalind 模型、272K 长上下文档），以及 Gemini API（Gemini 4 和 3.x、2.5；Pro 模型的 200k 档）。模型 id 依次匹配：原样、最后一个 `/` 之后、去掉结尾日期（`-20250929`、`-2025-08-07`、`@20250929`）或 `-latest` 之后；**不做前缀匹配**，所以 `gpt-5.1-codex` 不会被当成 `gpt-5.1` 计价。思考（thinking）token 按输出价计，三家的页面都说明思考 token 按输出 token 计费。

**Vertex AI。** Vertex 页面在同一天读过。表中所有 Gemini 模型，其全球端点（Global）、标准档的输入、输出和缓存输入单价，都与上面的 Gemini API 相同，只有两个例外：`gemini-3-flash-preview`（Vertex 页面没列输出单价）和 `gemini-3.1-pro-preview-customtools`（该页没列）。Vertex 的区域（非全球）端点贵 10%，未计入。Vertex 的促销价（例如 Gemini 4 Argon 到 2026-11-30）在该页写成按净支出返还的抵扣金。

**未收录。** 没有成本不等于零：表里和你的 `prices.json` 都没有的模型，只统计 token，标为未定价。
- Anthropic：Batch（5 折）、快速模式、`inference_geo: "us"`（1.1 倍）、服务端工具费、Managed Agents 运行时间；Claude 3.5 / 3.7 Sonnet（在 Claude Code 的目录里，但价格页没有）。已退役的 Opus 4 / 4.1、Sonnet 4、Haiku 3.5 按 Claude API 牌价列出（仍提供它们的云厂商自行计费）。Claude Mythos 限量开放，但有列入。
- OpenAI：Batch、Flex、Fast、Ultrafast 档（usage 对象看不出用了哪一种）、区域处理加价 10%、缓存写入价（usage 对象没有对应字段）、realtime、音频、图像、语音、转录、embedding、moderation、微调模型和工具。
- Gemini：Batch、Flex、Priority、Contributor 档、缓存存储的每小时费用、grounding 费用、免费额度（表里是付费档；免费额度内的调用不收费）、live / translate / transcribe / TTS / image / embedding / Omni / robotics 模型，以及只有 Vertex 页面列出的模型（3.7 Flash、3.5 Flash、2.0、Cyber 变体）。部分模型的音频输入更贵；usage 对象不区分输入类型，所以一律用文本单价，以音频为主的调用会被低估（这些模型的备注有写）。
- 其他 provider：OpenRouter（数百个模型）和本机 Ollama 模型（免费）不在范围内；需要的话请自己加进 `prices.json`。

## 卸载
删除 `~/.claude/mods/token-usage`，并从 `settings.json` 的 `env` 中移除 `CLAUDE_CODE_PLUGIN_DIRS` 与 `CLAUDE_CODE_PLUGIN_DIR_WATCH`。
