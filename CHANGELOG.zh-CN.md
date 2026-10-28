[English](CHANGELOG.md) | [繁體中文](CHANGELOG.zh-TW.md) | **简体中文**

# 更新记录

## 1.3.0 — 2026-10-28

同时做了两件事：Bash / MCP 工具调用打印出的用量现在不用 `tu-log` 也会被记下；`/usage-ext` 也内置了价格表，开箱就能估价。**内置价格最后更新：2026-10-28。** 用量条不变。

### 新增：从工具结果自动捕获

- `tool.call` hook 会读本会话中每个 **Bash 和 MCP 工具调用** 的输出。输出里完整的 JSON 对象如果带有 provider 的 usage（Gemini / Vertex 的 `usageMetadata`、Gemini CLI 的 `stats.models`、OpenAI chat 和 Responses、Anthropic、Ollama），就追加进账本。只留数字，不留提示词、回复、命令和输出文本；每行带会话 id（`$.session.id()`）、工具名称，以及输出里有的话带上 `provider` / `model`（provider 取自 Ollama 的响应格式或 `claude-*` / `gpt-*` / o 系列的模型 id；Gemini 不填）。
- **不重复计算。** 命令执行期间如果已经用 `tu-log` 记下同一次调用（同一会话、同样的数字、不矛盾的模型，时间落在该次调用前后 5 秒内），自动那一行就跳过；同一份输出里打印两次的同样数字只算一次；重放的 `tool_use_id` 不会再记。
- **不记：** 只是显示文件或文本的命令（`cat`、`grep`、`jq`、`git diff`……，所以读文档或对话记录不会把里面的示例记进去）、账本本身的行（所以读账本不会再记一次）、通用的 `{input, output}` 组合、Python repr、被截断的 JSON、token 为零的对象。`TOKEN_USAGE_AUTO=off` 可关闭（已验证：作为 shell 变量，以及放在设置的 `env` 里都有效）。
- **存在自己的文件里**，`ledger/YYYY-MM-DD.auto-<会话>.jsonl`：mod 只能整个文件重写，而不能重写 `tu-log` 正在追加的当日文件。当日文件只读，用来找命令自己记下的那一行。`/usage-ext` 两种文件都读，并说明有几行是自动记下的。
- 已在真实引擎里验证：用一个会打印响应的脚本，一次单独运行（记一行），一次同时调用 `tu-log`（只有 `tu-log` 那一行）。mod 看到的会话 id 等于 Bash 工具里的 `$CLAUDE_CODE_SESSION_ID`，CLI 自己生成新会话 id 时也一样。

### 新增：内置价格表

- `prices.default.json` 随 mod 发布（经 `$.plugin.root` 读取），并与你的 `prices.json` 合并：你填的某个模型整条取代内置的那一条，其余用内置价格。共 75 个模型，标准（Standard）档牌价：**Anthropic 20、OpenAI 44、Gemini API 11**。每个价格都是 2026-10-28 当天从 provider 自己的价格页读到的（Anthropic 的另与 `claude` 可执行文件内的模型目录交叉核对，20 个全部一致）。文件带有 `updated` 和 `sources`；`/usage-ext` 会打印"built-in prices updated 2026-10-28"（`json` 输出有 `builtinPrices`）。
- **价格会变。** 以 provider 的账单为准。这张表之后会以补丁版本（1.3.1……）更新，每次带新日期。`scripts/check-prices.py` 用来在更新后检查文件格式。
- **Vertex AI：** 该页面读得到（要用浏览器的 User-Agent），并已对照：表中所有 Gemini 模型，其全球端点、标准档的输入、输出和缓存输入单价都与 Gemini API 相同，只有 `gemini-3-flash-preview`（该页没列输出单价）和 `gemini-3.1-pro-preview-customtools`（该页没列）例外。Vertex 的区域端点（贵 10%）未计入。
- **未收录（绝不当成 $0）：** 表里没有的模型只统计 token，标为未定价。未收录：Anthropic 的 Batch、快速模式、`inference_geo` 1.1 倍、工具费、Claude 3.5 / 3.7 Sonnet（价格页没有）；OpenAI 的 Batch / Flex / Fast / Ultrafast、区域加价 10%、缓存写入价、realtime / 音频 / 图像 / 语音 / 转录 / embedding / moderation / 微调；Gemini 的 Batch / Flex / Priority / Contributor、缓存存储、grounding、免费额度、live / translate / transcribe / TTS / image / Omni / robotics 模型，以及只有 Vertex 页面列出的模型（3.7 Flash、3.5 Flash、2.0、Cyber 变体）。部分 Gemini 模型的音频输入更贵，这里用文本单价，备注有写。OpenRouter 和本机 Ollama 模型不在范围内。
- `gpt-5.6-sol` 是促销价（OpenAI：至少到 2026-11-21 有效，未公布正常价）；该条有备注，用到时 `/usage-ext` 会打印出来。

### 变更：价格处理

- **`effective`**：价格可设置从某个日期起改用的单价（`"effective": [{"from": "2026-12-01", "input": 4, ...}]`）；每条记录按其 `ts` 的 UTC 日期计价（各页面没给时区，假定为 UTC），所以旧记录保留当时的价格。用于 `gemini-4-argon`（2026-12-01）和 `gemini-3.8-flash` / `gemini-3.6-flash`（2027-01-01）。可加自由文本的 `note`。
- **`cacheWrite1h`**：Anthropic 的 1 小时缓存写入（`usage.cache_creation.ephemeral_1h_input_tokens`）有自己的 token 类别和单价（缺时用 `cacheWrite`，再缺用输入价），1 小时写入的估价不再偏低。
- **带后缀的模型 id** 也找得到：原样、最后一个 `/` 之后、去掉结尾 `-YYYYMMDD`、`-YYYY-MM-DD`、`@YYYYMMDD` 或 `-latest`（`claude-sonnet-4-5-20250929`、`gpt-5-2025-08-07`、`publishers/google/models/gemini-2.5-pro`）。不做前缀匹配：`gpt-5.1-codex` 不是 `gpt-5.1`。
- 以每 1,000 token 为单位的 `prices.json` 仍可与内置表并用（内置单价会按你的 `per` 换算）。
- 账本读取也接受 `YYYY-MM-DD.<名称>.jsonl`（文件数上限 400 → 1000）；旧版会忽略这些文件。

### 测试

- 21 → 44。其中两个是分支 `claude/focused-dirac-r2yzo2`（提交 b16d912）的"子代理和 fork 子代理每个响应只计一次"测试，已确认算术正确、且在"每个响应计一次"的逻辑被破坏时会失败，之后 cherry-pick 进来；该分支本身保持原样。
- 上述每条规则都有测试，防止重复计算和误捕获的那几条还做了"拿掉防护、看测试失败"的检查。`claude plugin test` 读不了文件，所以内置表本身的格式由 `scripts/check-prices.py` 检查；端到端的检查是在真实引擎里运行 `/usage-ext`。

**限制**

- 只有真的被打印出来的用量才捕获得到：只打印回复文字的脚本仍然需要加一行 `tu-log`。*之后另外*再用 `tu-log` 记一次"用量已被打印"的响应，会被再算一次。流式事件日志里重复或累计的用量不会去重。
- 命令的输出文字仍是简体中文。辅助脚本未在 Windows 测试。

### 其他

- 版本号 1.2.0 → 1.3.0。

## 1.2.0 — 2026-10-28

### 新增：外部 API 用量账本与 `/usage-ext`

Claude Code 自己的费用账本只知道它自己发出的请求。子代理或脚本直接调用 Vertex AI、OpenAI、Ollama……时，它看不到。1.2.0 新增一本不限 provider、可以读回的账。**用量条不变**，不会多画任何东西。

- **账本：** JSON Lines，存放在 `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl`（可用 `TOKEN_USAGE_EXT_DIR` 更改文件夹）。每行包含 provider 自己的 usage 对象、模型、时间和会话 id。
- **`bin/tu-log`**（Python 3，只用标准库）：把整个 API 响应或只有 usage 对象记成一行。只留数字，不留提示词和回复内容，并用 `$CLAUDE_CODE_SESSION_ID` 标上会话。Gemini CLI 的结果若含多个模型，每个模型记一行。
- **`/usage-ext [today|7d|all] [json]`：** 读账本，按模型列出调用次数、token 和估价，默认是本对话。`json` 输出机器可读的结果。在本机运行，不调用任何模型。
- **可识别的 usage 格式：** Gemini / Vertex 的 `usageMetadata`（camelCase 和 snake_case）与 Gemini CLI 统计；OpenAI chat 和 Responses（拆出缓存和推理 token）；Anthropic（缓存读取和写入）；Ollama。
- **价格：** 同一文件夹里的 `prices.json`，由你自己填（`prices.example.json` 是模板，里面没有任何真实价格）。每个模型可设 input、output、cached、cacheWrite、thinking，以及提示超过某长度后更高单价的 `longPrompt`。没有输入或输出单价的模型只统计 token 并标为未定价；缺 cached / cacheWrite 单价时用输入价，缺 thinking 时用输出价。
- **测试：** 新增 11 个（共 21 个）。另在真实引擎里验证：命令读出辅助脚本写的账本，数字正确，且没有调用模型。

**限制**

- mod 不能监听端口，也看不到其他程序的网络流量，所以只有被记录的调用才会计入（用辅助脚本，或自己追加一行）。自动捕获（例如从工具结果里读出 usage，或本机代理）不在这个版本里。
- 估价 = token x 你填的单价，以 provider 的账单为准。思考 token 是否按输出价计费由 provider 决定，请自行确认，不同的话设置 `thinking`。
- 命令的输出文字目前是简体中文。辅助脚本未在 Windows 测试。

### 其他

- 版本号 1.1.1 → 1.2.0。

## 1.1.1 — 2026-10-16

### 修正：分支（fork）出来的会话把父会话的费用当成自己的

金额格显示的是 Claude Code 自己的费用账本。分支出来的新会话一开始就**复制了父会话的整本账**，所以金额格不是从 0 起算，而是从父会话的总额起算。实际案例：从一个 Opus 5.5 对话分支出来、改用 Haiku 5.5 的会话，金额格显示 $4.44，但这个分支自己只花了约 $0.08；其余 $4.36 是从父会话带过来的 Opus 费用（即分支记录文件开头的 `cost-state` 条目）。token 三格只从分支之后起算，所以金额和它们明显对不上。

分支本身不花钱（不会调用 API，只是复制账本），Haiku 5.5 的计价从头到尾都是正确的。

**修正内容**

- 会话开始时读一次账本（`$.session.usage().cost`）作为**基线**（`Snap.base`）。金额格改为显示“账本现值 − 基线”，也就是这个对话自己的花费，含压缩与子代理。
- 基线和 token 计数一起按会话 id 存起来，重启或恢复后不会丢。
- 鼠标停在金额格上会写明不含的部分和账本总额，例如“不含起算前已有的 $4.36（从别的对话分支而来）；/cost 的账本总额为 $4.44”。
- 如果开始时读不到账本，只在还没计到任何 token 时，才把第一次看到的账本当作基线。
- 新增 5 个测试（分支、带基线恢复、旧版存下的会话、新会话、第一次测量才看到账本）。另用较旧的会话做过真实的无界面 fork 验证：存下的基线等于父会话的账本。

**须知**

- 金额格不再等于 `/cost`。`/cost` 仍是整本账，含分支继承来的部分。1.1.0 说明里“金额一直是准的（与 `/cost` 是同一个数字）”这句，对分支出来的会话不再成立。
- 旧版存下的会话没有基线，仍显示整本账；更新时已经开着的会话也一样，请重启（事后无法还原基线）。新开一个 fork 就能看到修正后的效果。
- 插件从没见过的会话被恢复时（例如在安装插件之前就跑过的会话），从恢复那一刻起算，之前的花费不计入金额格（`/cost` 仍有）。

### 其他

- 版本号 1.1.0 → 1.1.1。
- 测试由 5 个增为 10 个。

## 1.1.0 — 2026-10-14

### 修正：token 三格严重少算

用量条的**金额一直是准的**（直接取自 Claude Code 自己的费用账本，与 `/cost` 是同一个数字）。不准的是 token 三格（↑ 输入、↓ 输出、▤ 缓存读取）：

- 旧版只在 `turn.complete` 累加 `e.usage`，但在实测的宿主版本上，那里只带「一轮中最后一次 API 请求」的用量。
- 一轮里若有工具调用，会连发多次请求，最后一次通常只是收尾的短文字，所以输出被少算得最多（约 6 倍），缓存读取约少算 3.7 倍。
- 结果是拿 token 三格去乘官方价，只得到金额格的三分之一左右，看起来像「金额算贵了」，其实是 token 数错了。

实测（同一个长会话，与对话记录去重后的真实总数比对）：

| | 旧版显示 | 真实总数 |
|---|---|---|
| ↓ 输出 | 54.0k | 344k |
| ▤ 缓存读取 | 37.9M | 140.9M |

**修法**

- 新增 `turn.step` 钩子，**每个 API 回应结束时计一次**（主循环与子代理都算）。`turn.complete` 只在该轮完全没有任何请求报过用量时，才用整轮总数补上，不会重复计算。
- 补上漏项：`session.compact`（压缩请求本身）与 `model.complete`（插件自己发出的模型调用）的用量。
- 计数按会话 id 存进 `$.store`（最多保留 30 个会话）：同一会话热重载、重启或恢复后数字不会清零；`/clear` 或新会话从零开始。若无法接上之前的计数，金额格的悬停提示会注明 token 计数的起始时间。
- 缓存写入从「输入」里拆出来单独记录（`tokWrite`）：↑ 格数字仍是「未缓存输入＋缓存写入」，鼠标移上去会拆成两项；终端机版显示为 `⇧ 6.0k (寫 6.0k)`。
- 新增 2 个测试（一轮三次请求只算一次，且不与整轮总数重复；没有请求用量时退回整轮总数）。

**仍然不计入 token（只在金额里）**：`model.classify`（结果里没有用量），以及不经过上述钩子的引擎内部辅助调用，占比很小。

### 修正：终端机版什么都不显示

`ui.resolve` 会给每个界面补齐所有元素名称（该界面没有的元素变成空 fragment），所以 `'Svg' in t` 在终端机上也是 true，用量条画出一个空的 Svg，什么都看不到。改成按 `e.surface` 判断：终端机画文字行，其余画 Svg。

### 修正：盖掉其他插件在输入框上方的内容

`AbovePrompt` 是所有插件共用的区块。旧版不调用 `next()` 就直接返回，会把下层插件画的内容（例如 cc-arcade 的棋盘）盖掉。现在先取下层内容，再把用量条叠在下方。

### 其他

- 版本号 0.1.0 → 1.1.0。
- 新增 `hooks/band.test.tsx`（共 5 个测试）。

### 如何自行核对 token 数

对话记录在 `~/.claude/projects/<项目目录>/<会话id>.jsonl`。同一条回复会拆成多行、每行带同一份 usage，必须按 `message.id` 去重：

```python
import json
seen = {}
for ln in open('<会话id>.jsonl'):
    try: d = json.loads(ln)
    except ValueError: continue
    m = d.get('message') or {}
    if isinstance(m, dict) and m.get('usage'):
        seen[m.get('id') or d.get('requestId')] = m['usage']
t = {k: sum((u.get(k) or 0) for u in seen.values()) for k in
     ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')}
print(len(seen), 'responses', t)
```

修正后，新开会话的 token 三格应与这里的总数基本一致（升级前已开着的会话仍跑旧代码，要重开才生效）。

## 0.1.0

初版（原作者 [letswritetw](https://github.com/letswritetw/claude-mod-token-usage)）。
