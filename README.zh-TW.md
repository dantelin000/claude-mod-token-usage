[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

# token-usage

Claude Desktop（Code 分頁）輸入框上方的用量條：5h / 7d 額度、token 用量、花費。

> 這是 [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage) 的 fork。
> **v1.3.0** 自動記下 Bash / MCP 工具輸出裡印出的用量，並內建價格表（**內建價格最後更新：2026-10-28**），見〈[自動擷取](#自動擷取v130)〉與〈[內建價格](#內建價格)〉。
> **v1.2.0** 新增外部 API 用量帳本與 `/usage-ext` 指令（用量條不變），見〈[外部 API 用量](#外部-api-用量usage-ext)〉。
> **v1.1.1** 修正分支（fork）出來的會話把父會話的費用當成自己的：金額格現在只顯示這個對話自己的花費。
> **v1.1.0** 修正 token 三格嚴重少算（改為每個 API 回應計一次）、終端機版不顯示、蓋掉其他外掛的問題，詳見 [更新紀錄](CHANGELOG.zh-TW.md)。

## 安裝
- macOS：`bash install.sh`
- Windows：在 PowerShell 執行 `powershell -ExecutionPolicy Bypass -File install.ps1`

完成後完全關閉並重開 Claude Desktop。腳本會備份並合併 `~/.claude/settings.json`（只新增 `env` 內兩個變數）。

## 需求
- 支援 mod 功能的新版 Claude Code / Claude Desktop
- 5h / 7d 額度需訂閱帳號；第一次回應後才有資料

## 外部 API 用量（`/usage-ext`）

Claude Code 自己的費用（金額格、`/cost`）只涵蓋它自己送出的請求。子代理或腳本直接呼叫別的 API（Vertex AI、OpenAI、Ollama……）時，那些 token 它看不到。這個 mod 可以在本機記一本帳，並估算這些呼叫的費用。它不畫在用量條上，要用指令查。

**1. 記錄每次呼叫。** 有兩種方式，兩者不會重複計算（見下）。

*自動（v1.3.0）。* 當本會話裡的 Bash 或 MCP 工具呼叫印出 provider 的 usage 物件時，mod 會自動記下，不必設定。見〈[自動擷取](#自動擷取v130)〉。

*手動。* 把 API 回應（或只有 usage 物件）交給輔助腳本。它只留數字，不留提示詞與回覆內容，並用 `$CLAUDE_CODE_SESSION_ID` 標上會話：

```bash
~/.claude/mods/token-usage/bin/tu-log --provider vertex < response.json
~/.claude/mods/token-usage/bin/tu-log --provider openai --model gpt-x '{"usage":{"prompt_tokens":500,"completion_tokens":200}}'
```

也可以用任何語言自己在 `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl`（本地日期）後面加一行。`ts` 是毫秒，`usage` 是該 provider 自己回傳的 usage 物件：

```json
{"ts":1793148848057,"session":"<CLAUDE_CODE_SESSION_ID>","provider":"vertex","model":"gemini-x","usage":{"promptTokenCount":12000,"candidatesTokenCount":340}}
```

可辨識：Gemini / Vertex 的 `usageMetadata`（含 Gemini CLI 的統計）、OpenAI（chat 與 Responses）、Anthropic（含 5 分鐘與 1 小時快取寫入）、Ollama。（輔助腳本需要 Python 3；Windows 請用 `python tu-log` 執行，未在 Windows 測試。）

**2. 價格。** mod 內建一份價格表（見〈[內建價格](#內建價格)〉），所以 `/usage-ext` 開箱就能估價。要補上表裡沒有的模型，或覆蓋某個價格，把 `prices.example.json` 複製成 `~/.claude/token-usage/prices.json`，照你 provider 的價格頁填入每百萬 token 的美元單價。你填的某個模型會整筆取代內建那一筆，其餘仍用內建價格。內建與你的表裡都沒有輸入與輸出單價的模型只統計 token，標為未定價（不會顯示成 $0）。缺 `cached` 單價時用輸入價，`cacheWrite` 也是，缺 `cacheWrite1h` 時用 `cacheWrite`，缺 `thinking` 時用輸出價；`longPrompt` 可設定提示超過某長度後的較高單價；`effective` 可設定從某個日期起改用的單價。

**3. 查詢。** `/usage-ext` 看本對話，或 `/usage-ext today`、`7d`、`all`。加 `json` 輸出機器可讀的結果。環境變數 `TOKEN_USAGE_EXT_DIR` 可更改資料夾。輸出裡會附上內建價格的日期（「built-in prices updated YYYY-MM-DD」）。

**限制。** mod 看不到其他程式的網路流量，所以只有被記錄、或用量被印在工具結果裡（見下）的呼叫才會計入。人在終端機自己執行、不經過 Claude Code 的腳本不在範圍內。估價 = token x 單價，以 provider 的帳單為準。

### 自動擷取（v1.3.0）

當 **Bash 或 MCP 工具呼叫** 的輸出含有 provider 的 usage 物件時，mod 會把它加進帳本。它讀輸出文字裡完整的 JSON 物件：Gemini / Vertex 的 `usageMetadata`、Gemini CLI 的 `stats.models`、OpenAI（chat 與 Responses）、Anthropic、Ollama。

- **只留數字。** 不留提示詞、回覆、指令或輸出文字。每行只有 usage 數字、會話 id、工具名稱（`auto: Bash`、`auto: mcp__server__tool`），以及輸出裡有的話就帶上 `model` 與 `provider`。provider 只在能判斷時填入：Ollama 的回覆格式，以及 `claude-*`、`gpt-*` / o 系列的模型 id；Gemini 不填（Gemini API 與 Vertex AI 印出的格式相同）。
- **只有真的被印出來的用量才抓得到。** 只印回覆文字的腳本，還是要加一行 `tu-log`。另外看不到的：工具把 JSON 攔腰截斷的輸出、Python `repr` 的字典（單引號）、背景執行的指令（Bash 的結果在它們結束前就回來了）、腳本根本沒印出的用量。
- **不重複計算。** 指令執行期間若已用 `tu-log` 記下同一次呼叫（同一會話、同樣的數字、不矛盾的模型），自動那一行就略過。同一份輸出裡印了兩次的同樣數字只算一次。*之後另外*再用 `tu-log` 記一次「用量已被印出」的回應，會變成第二行：一個回應只記一次。
- **不記：** 只是顯示檔案或文字的指令（`cat`、`grep`、`jq`、`git diff`……，不含指令替換），因為它印出的是別人的文件或先前的回應；帳本本身的行；通用的 `{"input": .., "output": ..}` 組合（不是 provider 的格式）；token 數為零的物件。串流事件日誌裡重複或累計的用量不會去重。
- **存放位置。** `~/.claude/token-usage/ledger/YYYY-MM-DD.auto-<會話>.jsonl`，每個會話一個檔。分開存是因為 mod 只能整個檔案重寫，而不能重寫 `tu-log` 正在追加的檔案。刪掉檔案就刪掉其中的記錄。
- **關閉。** 設定 `TOKEN_USAGE_AUTO=off`（例如放在 `settings.json` 的 `env` 裡）。`/usage-ext` 會說明有幾行是自動記下的。

### 內建價格

**內建價格最後更新：2026-10-28**（讀取下列頁面的日期；即 `prices.default.json` 的 `updated`，`/usage-ext` 也會印出）。

來源，皆於該日讀取：
- Anthropic：<https://platform.claude.com/docs/en/about-claude/pricing>（並與 Claude Code 自己模型目錄裡的各模型費率交叉核對）
- OpenAI：<https://developers.openai.com/api/docs/pricing>
- Google，Gemini API：<https://ai.google.dev/gemini-api/docs/pricing>
- Google，Vertex AI：<https://cloud.google.com/vertex-ai/generative-ai/pricing>（用來對照，見下）

**價格會變，以 provider 的帳單為準。** 這張表是某一天的牌價，不是保證。之後會以修補版本（1.3.1……）更新，每次都帶新日期。頁面已公告的調價，表裡有記：`gemini-4-argon` 在 2026-12-01 漲價，`gemini-3.8-flash` 與 `gemini-3.6-flash` 在 2027-01-01 漲價（各 provider 頁面沒給時區，**假定為 UTC**），每筆記錄依它被記下的那一天計價。`gpt-5.6-sol` 是促銷價，OpenAI 寫明「至少到 2026-11-21 有效」，也沒公布正常價；該筆的備註有說明。

**收錄內容：** 75 個模型，標準（Standard）等級牌價，單位為每百萬 token 的美元：Anthropic（Claude Fable、Mythos、Opus、Sonnet、Haiku，含 5 分鐘與 1 小時快取寫入，以及 Haiku 5.5 在提示超過 100k token 時的較高單價）、OpenAI（GPT-6 / 5.x / 4.x / o 系列、Codex、Cyber 與 Rosalind 模型、272K 長上下文檔），以及 Gemini API（Gemini 4 與 3.x、2.5；Pro 模型的 200k 檔）。模型 id 依序比對：原樣、最後一個 `/` 之後、去掉結尾日期（`-20250929`、`-2025-08-07`、`@20250929`）或 `-latest` 之後；**不做前綴比對**，所以 `gpt-5.1-codex` 不會被當成 `gpt-5.1` 計價。思考（thinking）token 依輸出價計，三家的頁面都說明思考 token 按輸出 token 計費。

**Vertex AI。** Vertex 頁面在同一天讀過。表中所有 Gemini 模型，其全球端點（Global）、標準等級的輸入、輸出與快取輸入單價，都與上面的 Gemini API 相同，只有兩個例外：`gemini-3-flash-preview`（Vertex 頁面沒列輸出單價）與 `gemini-3.1-pro-preview-customtools`（該頁沒列）。Vertex 的區域（非全球）端點貴 10%，未計入。Vertex 的促銷價（例如 Gemini 4 Argon 到 2026-11-30）在該頁寫成依淨支出退回的抵用金。

**未收錄。** 沒有成本不等於零：表裡與你的 `prices.json` 都沒有的模型，只統計 token，標為未定價。
- Anthropic：Batch（5 折）、快速模式、`inference_geo: "us"`（1.1 倍）、伺服器端工具費、Managed Agents 執行時間；Claude 3.5 / 3.7 Sonnet（在 Claude Code 的目錄裡，但價格頁沒有）。已退役的 Opus 4 / 4.1、Sonnet 4、Haiku 3.5 以 Claude API 牌價列出（仍提供它們的雲端夥伴自行計費）。Claude Mythos 限量開放，但有列入。
- OpenAI：Batch、Flex、Fast、Ultrafast 等級（usage 物件看不出用了哪一種）、區域處理加價 10%、快取寫入價（usage 物件沒有對應欄位）、realtime、音訊、圖像、語音、轉錄、embedding、moderation、微調模型與工具。
- Gemini：Batch、Flex、Priority、Contributor 等級、快取儲存的每小時費用、grounding 費用、免費額度（表裡是付費等級；免費額度內的呼叫不收費）、live / translate / transcribe / TTS / image / embedding / Omni / robotics 模型，以及只有 Vertex 頁面列出的模型（3.7 Flash、3.5 Flash、2.0、Cyber 變體）。部分模型的音訊輸入較貴；usage 物件不區分輸入類型，所以一律用文字單價，音訊為主的呼叫會被低估（那些模型的備註有寫）。
- 其他 provider：OpenRouter（數百個模型）與本機 Ollama 模型（免費）不在範圍內；需要的話請自己加進 `prices.json`。

## 解除安裝
刪除 `~/.claude/mods/token-usage`，並從 `settings.json` 的 `env` 移除 `CLAUDE_CODE_PLUGIN_DIRS` 與 `CLAUDE_CODE_PLUGIN_DIR_WATCH`。
