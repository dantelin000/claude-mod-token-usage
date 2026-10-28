## Added: automatic capture from tool results, and a built-in price table

**Built-in prices last updated: 2026-10-28** (read on that day from the providers' own pricing pages). The strip is unchanged.

**1. Automatic capture.** When a **Bash or MCP tool call** in the session prints a provider's usage object (Gemini / Vertex `usageMetadata`, Gemini CLI stats, OpenAI chat and Responses, Anthropic, Ollama), the mod now logs it without anyone calling `tu-log`. Only the numbers are kept (never the prompt, the reply, the command or the output), tagged with the session id, the tool's name, and the model / provider when the output carries them.
- **No double counting:** a call the command already logged with `tu-log` while it ran is skipped; the same numbers printed twice in one output count once; a replayed tool call adds nothing.
- **Not logged:** commands that only view files or text (`cat`, `grep`, `jq`, `git diff`, ...), ledger lines, the generic `{input, output}` pair, Python reprs, truncated JSON, zero-token objects. `TOKEN_USAGE_AUTO=off` turns it off.
- Only usage that is really printed can be captured: a script that prints only the reply text still needs a `tu-log` line.

**2. Built-in prices.** `/usage-ext` now estimates cost out of the box: **75 models at Standard-tier list prices (Anthropic 20, OpenAI 44, Gemini API 11)**, merged with your own `prices.json` (your entry for a model wins). Every price was read from an official page on 2026-10-28; Anthropic's also equal the rates in Claude Code's own model catalog. The command prints "built-in prices updated 2026-10-28". **Prices change and the provider's bill is authoritative**; the table is refreshed as patch releases (1.3.1, ...), each with a new date.
- New in the price format: `effective` (a price that changes on a date, used for `gemini-4-argon` on 2026-12-01 and `gemini-3.8-flash` / `gemini-3.6-flash` on 2027-01-01; UTC assumed), `cacheWrite1h` (Anthropic's 1-hour cache writes), and model ids with a date suffix, a path or `-latest` are found (no prefix matching).
- **Vertex AI:** the page could be read and was compared. Its Global-endpoint Standard prices equal the Gemini API rows for every Gemini model in the table except `gemini-3-flash-preview` (no output price listed there) and `gemini-3.1-pro-preview-customtools` (not listed). Regional Vertex endpoints (+10%) are not modelled.
- **Left out** (a model that is not in the table is counted in tokens and shown unpriced, never as $0): Claude 3.5 / 3.7 Sonnet (not on the pricing page); models only the Vertex page lists (Gemini 3.7 Flash, 3.5 Flash, 2.0, Cyber variants); realtime / audio / image / speech / transcription / embedding / moderation / fine-tuning models; Batch, Flex, Fast, Ultrafast, Priority tiers; fast mode, regional / data-residency uplifts, cache-write prices (OpenAI), cache storage and grounding fees; OpenRouter and local Ollama models. Audio input is billed higher on some Gemini models, so audio-heavy calls are underestimated (those entries say so). `gpt-5.6-sol` is a promotional price (available at least through 2026-11-21, no regular price published).

44 tests (21 before; two are the subagent / fork-subagent tests from branch `claude/focused-dirac-r2yzo2`, cherry-picked). Also checked in the real engine: automatic capture, the `tu-log` double-count case (the session id the mod sees equals `$CLAUDE_CODE_SESSION_ID` in Bash, also with a freshly minted id), the off switch, and `/usage-ext` with the built-in table.

## Upgrade
Re-run `bash install.sh` (Windows: `install.ps1`), then fully quit and reopen Claude Desktop. The installer copies the whole `token-usage` folder, so `prices.default.json` lands next to the mod. Nothing to configure.

Full details: [CHANGELOG](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/CHANGELOG.md) · [README: Automatic capture](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/README.md#automatic-capture-v130) · [README: Built-in prices](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/README.md#built-in-prices)

---

## 繁體中文

### 新增：從工具結果自動擷取，以及內建價格表

**內建價格最後更新：2026-10-28**（當天從各 provider 自己的價格頁讀取）。用量條不變。

**1. 自動擷取。** 當本會話裡的 **Bash 或 MCP 工具呼叫** 印出 provider 的 usage 物件（Gemini / Vertex 的 `usageMetadata`、Gemini CLI 統計、OpenAI chat 與 Responses、Anthropic、Ollama）時，mod 現在不用 `tu-log` 也會記下。只留數字（不留提示詞、回覆、指令與輸出），並標上會話 id、工具名稱，以及輸出裡有的話帶上模型 / provider。
- **不重複計算：** 指令執行期間已用 `tu-log` 記下的呼叫會略過；同一份輸出裡印兩次的同樣數字只算一次；重播的工具呼叫不會再記。
- **不記：** 只是顯示檔案或文字的指令（`cat`、`grep`、`jq`、`git diff`……）、帳本本身的行、通用的 `{input, output}` 組合、Python repr、被截斷的 JSON、token 為零的物件。`TOKEN_USAGE_AUTO=off` 可關閉。
- 只有真的被印出來的用量才抓得到：只印回覆文字的腳本還是要加一行 `tu-log`。

**2. 內建價格。** `/usage-ext` 現在開箱就能估價：**75 個模型的標準（Standard）等級牌價（Anthropic 20、OpenAI 44、Gemini API 11）**，並與你自己的 `prices.json` 合併（你填的某個模型優先）。每個價格都是 2026-10-28 從官方頁面讀到的；Anthropic 的另與 Claude Code 自己模型目錄裡的費率一致。指令會印出「built-in prices updated 2026-10-28」。**價格會變，以 provider 的帳單為準**；這張表之後會以修補版本（1.3.1……）更新，每次帶新日期。
- 價格格式新增：`effective`（從某個日期起改價，用於 2026-12-01 的 `gemini-4-argon` 與 2027-01-01 的 `gemini-3.8-flash` / `gemini-3.6-flash`；假定為 UTC）、`cacheWrite1h`（Anthropic 的 1 小時快取寫入），以及帶日期後綴、路徑或 `-latest` 的模型 id 也找得到（不做前綴比對）。
- **Vertex AI：** 該頁面讀得到並已對照。表中所有 Gemini 模型，其全球端點、標準等級的單價都與 Gemini API 相同，只有 `gemini-3-flash-preview`（該頁沒列輸出單價）與 `gemini-3.1-pro-preview-customtools`（該頁沒列）例外。Vertex 的區域端點（貴 10%）未計入。
- **未收錄**（表裡沒有的模型只統計 token、標為未定價，絕不當成 $0）：Claude 3.5 / 3.7 Sonnet（價格頁沒有）；只有 Vertex 頁面列出的模型（Gemini 3.7 Flash、3.5 Flash、2.0、Cyber 變體）；realtime / 音訊 / 圖像 / 語音 / 轉錄 / embedding / moderation / 微調模型；Batch、Flex、Fast、Ultrafast、Priority 等級；快速模式、區域 / 資料落地加價、（OpenAI 的）快取寫入價、快取儲存與 grounding 費用；OpenRouter 與本機 Ollama 模型。部分 Gemini 模型的音訊輸入較貴，音訊為主的呼叫會被低估（那些模型的備註有寫）。`gpt-5.6-sol` 是促銷價（至少到 2026-11-21 有效，未公布正常價）。

44 個測試（原本 21 個；其中兩個是分支 `claude/focused-dirac-r2yzo2` 的子代理 / fork 子代理測試，已 cherry-pick）。另在真實引擎裡驗證：自動擷取、`tu-log` 重複計算的情況（mod 看到的會話 id 等於 Bash 裡的 `$CLAUDE_CODE_SESSION_ID`，新產生的 id 也一樣）、關閉開關，以及帶內建價格表的 `/usage-ext`。

升級：重新執行 `bash install.sh`（Windows：`install.ps1`），再完全結束並重開 Claude Desktop。安裝腳本會複製整個 `token-usage` 資料夾，所以 `prices.default.json` 會跟著進去。不需要任何設定。詳見 [更新紀錄](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/CHANGELOG.zh-TW.md) 與 [README](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/README.zh-TW.md)。

## 简体中文

### 新增：从工具结果自动捕获，以及内置价格表

**内置价格最后更新：2026-10-28**（当天从各 provider 自己的价格页读取）。用量条不变。

**1. 自动捕获。** 当本会话里的 **Bash 或 MCP 工具调用** 打印出 provider 的 usage 对象（Gemini / Vertex 的 `usageMetadata`、Gemini CLI 统计、OpenAI chat 和 Responses、Anthropic、Ollama）时，mod 现在不用 `tu-log` 也会记下。只留数字（不留提示词、回复、命令和输出），并标上会话 id、工具名称，以及输出里有的话带上模型 / provider。
- **不重复计算：** 命令执行期间已用 `tu-log` 记下的调用会跳过；同一份输出里打印两次的同样数字只算一次；重放的工具调用不会再记。
- **不记：** 只是显示文件或文本的命令（`cat`、`grep`、`jq`、`git diff`……）、账本本身的行、通用的 `{input, output}` 组合、Python repr、被截断的 JSON、token 为零的对象。`TOKEN_USAGE_AUTO=off` 可关闭。
- 只有真的被打印出来的用量才捕获得到：只打印回复文字的脚本仍然需要加一行 `tu-log`。

**2. 内置价格。** `/usage-ext` 现在开箱就能估价：**75 个模型的标准（Standard）档牌价（Anthropic 20、OpenAI 44、Gemini API 11）**，并与你自己的 `prices.json` 合并（你填的某个模型优先）。每个价格都是 2026-10-28 从官方页面读到的；Anthropic 的另与 Claude Code 自己模型目录里的费率一致。命令会打印"built-in prices updated 2026-10-28"。**价格会变，以 provider 的账单为准**；这张表之后会以补丁版本（1.3.1……）更新，每次带新日期。
- 价格格式新增：`effective`（从某个日期起改价，用于 2026-12-01 的 `gemini-4-argon` 和 2027-01-01 的 `gemini-3.8-flash` / `gemini-3.6-flash`；假定为 UTC）、`cacheWrite1h`（Anthropic 的 1 小时缓存写入），以及带日期后缀、路径或 `-latest` 的模型 id 也找得到（不做前缀匹配）。
- **Vertex AI：** 该页面读得到并已对照。表中所有 Gemini 模型，其全球端点、标准档的单价都与 Gemini API 相同，只有 `gemini-3-flash-preview`（该页没列输出单价）和 `gemini-3.1-pro-preview-customtools`（该页没列）例外。Vertex 的区域端点（贵 10%）未计入。
- **未收录**（表里没有的模型只统计 token、标为未定价，绝不当成 $0）：Claude 3.5 / 3.7 Sonnet（价格页没有）；只有 Vertex 页面列出的模型（Gemini 3.7 Flash、3.5 Flash、2.0、Cyber 变体）；realtime / 音频 / 图像 / 语音 / 转录 / embedding / moderation / 微调模型；Batch、Flex、Fast、Ultrafast、Priority 档；快速模式、区域 / 数据驻留加价、（OpenAI 的）缓存写入价、缓存存储和 grounding 费用；OpenRouter 和本机 Ollama 模型。部分 Gemini 模型的音频输入更贵，以音频为主的调用会被低估（这些模型的备注有写）。`gpt-5.6-sol` 是促销价（至少到 2026-11-21 有效，未公布正常价）。

44 个测试（原来 21 个；其中两个是分支 `claude/focused-dirac-r2yzo2` 的子代理 / fork 子代理测试，已 cherry-pick）。另在真实引擎里验证：自动捕获、`tu-log` 重复计算的情况（mod 看到的会话 id 等于 Bash 里的 `$CLAUDE_CODE_SESSION_ID`，新生成的 id 也一样）、关闭开关，以及带内置价格表的 `/usage-ext`。

升级：重新运行 `bash install.sh`（Windows：`install.ps1`），再完全退出并重开 Claude Desktop。安装脚本会复制整个 `token-usage` 文件夹，所以 `prices.default.json` 会跟着进去。不需要任何设置。详见 [更新记录](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/CHANGELOG.zh-CN.md) 和 [README](https://github.com/dantelin000/claude-mod-token-usage/blob/v1.3.0/README.zh-CN.md)。
