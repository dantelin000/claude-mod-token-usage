[English](CHANGELOG.md) | **繁體中文** | [简体中文](CHANGELOG.zh-CN.md)

# 更新紀錄

## 1.3.0 — 2026-10-28

同時做了兩件事：Bash / MCP 工具呼叫印出的用量現在不用 `tu-log` 也會被記下；`/usage-ext` 也內建價格表，開箱就能估價。**內建價格最後更新：2026-10-28。** 用量條不變。

### 新增：從工具結果自動擷取

- `tool.call` hook 會讀本會話中每個 **Bash 與 MCP 工具呼叫** 的輸出。輸出裡完整的 JSON 物件若帶有 provider 的 usage（Gemini / Vertex 的 `usageMetadata`、Gemini CLI 的 `stats.models`、OpenAI chat 與 Responses、Anthropic、Ollama），就加進帳本。只留數字，不留提示詞、回覆、指令與輸出文字；每行帶會話 id（`$.session.id()`）、工具名稱，以及輸出裡有的話帶上 `provider` / `model`（provider 取自 Ollama 的回覆格式或 `claude-*` / `gpt-*` / o 系列的模型 id；Gemini 不填）。
- **不重複計算。** 指令執行期間若已用 `tu-log` 記下同一次呼叫（同一會話、同樣的數字、不矛盾的模型，時間落在該次呼叫前後 5 秒內），自動那一行就略過；同一份輸出裡印兩次的同樣數字只算一次；重播的 `tool_use_id` 不會再記。
- **不記：** 只是顯示檔案或文字的指令（`cat`、`grep`、`jq`、`git diff`……，所以讀文件或對話紀錄不會把裡面的範例記進去）、帳本本身的行（所以讀帳本不會再記一次）、通用的 `{input, output}` 組合、Python repr、被截斷的 JSON、token 為零的物件。`TOKEN_USAGE_AUTO=off` 可關閉（已驗證：作為 shell 變數，以及放在設定的 `env` 裡都有效）。
- **存在自己的檔案裡**，`ledger/YYYY-MM-DD.auto-<會話>.jsonl`：mod 只能整個檔案重寫，而不能重寫 `tu-log` 正在追加的當日檔案。當日檔案只讀，用來找指令自己記下的那一行。`/usage-ext` 兩種檔案都讀，並說明有幾行是自動記下的。
- 已在真實引擎裡驗證：用一支會印出回應的腳本，一次單獨執行（記一行），一次同時呼叫 `tu-log`（只有 `tu-log` 那一行）。mod 看到的會話 id 等於 Bash 工具裡的 `$CLAUDE_CODE_SESSION_ID`，CLI 自己產生新會話 id 時也一樣。

### 新增：內建價格表

- `prices.default.json` 隨 mod 發行（經 `$.plugin.root` 讀取），並與你的 `prices.json` 合併：你填的某個模型整筆取代內建那一筆，其餘用內建價格。共 75 個模型，標準（Standard）等級牌價：**Anthropic 20、OpenAI 44、Gemini API 11**。每個價格都是 2026-10-28 當天從 provider 自己的價格頁讀到的（Anthropic 的另與 `claude` 執行檔內的模型目錄交叉核對，20 個全部一致）。檔案帶有 `updated` 與 `sources`；`/usage-ext` 會印出「built-in prices updated 2026-10-28」（`json` 輸出有 `builtinPrices`）。
- **價格會變。** 以 provider 的帳單為準。這張表之後會以修補版本（1.3.1……）更新，每次帶新日期。`scripts/check-prices.py` 用來在更新後檢查檔案格式。
- **Vertex AI：** 該頁面讀得到（要用瀏覽器的 User-Agent），並已對照：表中所有 Gemini 模型，其全球端點、標準等級的輸入、輸出與快取輸入單價都與 Gemini API 相同，只有 `gemini-3-flash-preview`（該頁沒列輸出單價）與 `gemini-3.1-pro-preview-customtools`（該頁沒列）例外。Vertex 的區域端點（貴 10%）未計入。
- **未收錄（絕不當成 $0）：** 表裡沒有的模型只統計 token，標為未定價。未收錄：Anthropic 的 Batch、快速模式、`inference_geo` 1.1 倍、工具費、Claude 3.5 / 3.7 Sonnet（價格頁沒有）；OpenAI 的 Batch / Flex / Fast / Ultrafast、區域加價 10%、快取寫入價、realtime / 音訊 / 圖像 / 語音 / 轉錄 / embedding / moderation / 微調；Gemini 的 Batch / Flex / Priority / Contributor、快取儲存、grounding、免費額度、live / translate / transcribe / TTS / image / Omni / robotics 模型，以及只有 Vertex 頁面列出的模型（3.7 Flash、3.5 Flash、2.0、Cyber 變體）。部分 Gemini 模型的音訊輸入較貴，這裡用文字單價，備註有寫。OpenRouter 與本機 Ollama 模型不在範圍內。
- `gpt-5.6-sol` 是促銷價（OpenAI：至少到 2026-11-21 有效，未公布正常價）；該筆有備註，用到時 `/usage-ext` 會印出。

### 變更：價格處理

- **`effective`**：價格可設定從某個日期起改用的單價（`"effective": [{"from": "2026-12-01", "input": 4, ...}]`）；每筆記錄依其 `ts` 的 UTC 日期計價（各頁面沒給時區，假定為 UTC），所以舊記錄保留當時的價格。用於 `gemini-4-argon`（2026-12-01）與 `gemini-3.8-flash` / `gemini-3.6-flash`（2027-01-01）。可加自由文字的 `note`。
- **`cacheWrite1h`**：Anthropic 的 1 小時快取寫入（`usage.cache_creation.ephemeral_1h_input_tokens`）有自己的 token 類別與單價（缺時用 `cacheWrite`，再缺用輸入價），1 小時寫入的估價不再偏低。
- **帶後綴的模型 id** 也找得到：原樣、最後一個 `/` 之後、去掉結尾 `-YYYYMMDD`、`-YYYY-MM-DD`、`@YYYYMMDD` 或 `-latest`（`claude-sonnet-4-5-20250929`、`gpt-5-2025-08-07`、`publishers/google/models/gemini-2.5-pro`）。不做前綴比對：`gpt-5.1-codex` 不是 `gpt-5.1`。
- 以每 1,000 token 為單位的 `prices.json` 仍可與內建表並用（內建單價會依你的 `per` 換算）。
- 帳本讀取也接受 `YYYY-MM-DD.<名稱>.jsonl`（檔案數上限 400 → 1000）；舊版會忽略這些檔案。

### 測試

- 21 → 44。其中兩個是分支 `claude/focused-dirac-r2yzo2`（提交 b16d912）的「子代理與 fork 子代理每個回應只計一次」測試，已確認算術正確、且在「每個回應計一次」的邏輯被破壞時會失敗，之後 cherry-pick 進來；該分支本身保持原樣。
- 上述每條規則都有測試，防止重複計算與誤擷取的那幾條還做了「拿掉防護、看測試失敗」的檢查。`claude plugin test` 讀不了檔案，所以內建表本身的格式由 `scripts/check-prices.py` 檢查；端到端的檢查是在真實引擎裡執行 `/usage-ext`。

**限制**

- 只有真的被印出來的用量才抓得到：只印回覆文字的腳本還是要加一行 `tu-log`。*之後另外*再用 `tu-log` 記一次「用量已被印出」的回應，會被再算一次。串流事件日誌裡重複或累計的用量不會去重。
- 指令的輸出文字仍是簡體中文。輔助腳本未在 Windows 測試。

### 其他

- 版本號 1.2.0 → 1.3.0。

## 1.2.0 — 2026-10-28

### 新增：外部 API 用量帳本與 `/usage-ext`

Claude Code 自己的費用帳本只知道它自己送出的請求。子代理或腳本直接呼叫 Vertex AI、OpenAI、Ollama……時，它看不到。1.2.0 新增一本不限 provider、可以讀回的帳。**用量條不變**，不會多畫任何東西。

- **帳本：** JSON Lines，存於 `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl`（可用 `TOKEN_USAGE_EXT_DIR` 更改資料夾）。每行包含 provider 自己的 usage 物件、模型、時間與會話 id。
- **`bin/tu-log`**（Python 3，只用標準庫）：把整個 API 回應或只有 usage 物件記成一行。只留數字，不留提示詞與回覆內容，並用 `$CLAUDE_CODE_SESSION_ID` 標上會話。Gemini CLI 的結果若含多個模型，每個模型記一行。
- **`/usage-ext [today|7d|all] [json]`：** 讀帳本，依模型列出呼叫次數、token 與估價，預設是本對話。`json` 輸出機器可讀的結果。在本機執行，不呼叫任何模型。
- **可辨識的 usage 格式：** Gemini / Vertex 的 `usageMetadata`（camelCase 與 snake_case）與 Gemini CLI 統計；OpenAI chat 與 Responses（拆出快取與推理 token）；Anthropic（快取讀取與寫入）；Ollama。
- **價格：** 同一資料夾的 `prices.json`，由你自己填（`prices.example.json` 是範本，裡面沒有任何真實價格）。每個模型可設 input、output、cached、cacheWrite、thinking，以及提示超過某長度後較高單價的 `longPrompt`。沒有輸入或輸出單價的模型只統計 token 並標為未定價；缺 cached / cacheWrite 單價時用輸入價，缺 thinking 時用輸出價。
- **測試：** 新增 11 個（共 21 個）。另在真實引擎裡驗證：指令讀出輔助腳本寫的帳本，數字正確，且沒有呼叫模型。

**限制**

- mod 不能監聽連接埠，也看不到其他程式的網路流量，所以只有被記錄的呼叫才會計入（用輔助腳本，或自己加一行）。自動擷取（例如從工具結果讀出 usage，或本機代理）不在這個版本裡。
- 估價 = token x 你填的單價，以 provider 的帳單為準。思考 token 是否按輸出價計費由 provider 決定，請自行確認，不同的話設定 `thinking`。
- 指令的輸出文字目前是簡體中文。輔助腳本未在 Windows 測試。

### 其他

- 版本號 1.1.1 → 1.2.0。

## 1.1.1 — 2026-10-16

### 修正：分支（fork）出來的會話把父會話的費用當成自己的

金額格顯示的是 Claude Code 自己的費用帳本。分支出來的新會話一開始就**複製了父會話的整本帳**，所以金額格不是從 0 起算，而是從父會話的總額起算。實際案例：從一個 Opus 5.5 對話分支出來、改用 Haiku 5.5 的會話，金額格顯示 $4.44，但這個分支自己只花了約 $0.08；其餘 $4.36 是從父會話帶過來的 Opus 費用（即分支記錄檔開頭的 `cost-state` 條目）。token 三格只從分支之後起算，所以金額和它們明顯對不上。

分支本身不花錢（不會呼叫 API，只是複製帳本），Haiku 5.5 的計價從頭到尾都是正確的。

**修正內容**

- 會話開始時讀一次帳本（`$.session.usage().cost`）作為**基線**（`Snap.base`）。金額格改顯示「帳本現值 − 基線」，也就是這個對話自己的花費，含壓縮與子代理。
- 基線和 token 計數一起依會話 id 存起來，重啟或恢復後不會丟。
- 滑鼠停在金額格上會寫明不含的部分和帳本總額，例如「不含起算前已有的 $4.36（從別的對話分支而來）；/cost 的帳本總額為 $4.44」。
- 若開始時讀不到帳本，只在還沒計到任何 token 時，才把第一次看到的帳本當作基線。
- 新增 5 個測試（分支、帶基線恢復、舊版存下的會話、新會話、第一次量測才看到帳本）。另用較舊會話做過真實的無介面 fork 驗證：存下的基線等於父會話的帳本。

**須知**

- 金額格不再等於 `/cost`。`/cost` 仍是整本帳，含分支繼承來的部分。1.1.0 說明裡「金額一直是準的（與 `/cost` 同一個數字）」這句，對分支出來的會話不再成立。
- 舊版存下的會話沒有基線，仍顯示整本帳；更新時已經開著的會話也一樣，請重啟（事後無法還原基線）。新開一個 fork 就能看到修正後的效果。
- mod 從沒見過的會話被恢復時（例如在安裝 mod 之前就跑過的會話），從恢復那刻起算，之前的花費不計入金額格（`/cost` 仍有）。

### 其他

- 版本號 1.1.0 → 1.1.1。
- 測試由 5 個增為 10 個。

## 1.1.0 — 2026-10-14

### 修正：token 三格嚴重少算

用量條的**金額一直是準的**（直接取自 Claude Code 自己的費用帳本，與 `/cost` 同一個數字）。不準的是 token 三格（↑ 輸入、↓ 輸出、▤ 快取讀取）：

- 舊版只在 `turn.complete` 累加 `e.usage`，但在實測的宿主版本上，那裡只帶「一輪中最後一次 API 請求」的用量。
- 一輪裡若有工具呼叫，會連發多次請求，最後一次通常只是收尾的短文字，所以輸出被少算最多（約 6 倍），快取讀取約少算 3.7 倍。
- 結果是拿 token 三格去乘官方價，只得到金額格的三分之一左右，看起來像「金額算貴了」，其實是 token 數錯了。

實測（同一個長會話，與對話記錄去重後的真實總數比對）：

| | 舊版顯示 | 真實總數 |
|---|---|---|
| ↓ 輸出 | 54.0k | 344k |
| ▤ 快取讀取 | 37.9M | 140.9M |

**修法**

- 新增 `turn.step` 鉤子，**每個 API 回應結束時計一次**（主迴圈與子代理都算）。`turn.complete` 只在該輪完全沒有任何請求回報用量時，才用整輪總數補上，不會重複計算。
- 補上漏項：`session.compact`（壓縮請求本身）與 `model.complete`（外掛自己發出的模型呼叫）的用量。
- 計數依會話 id 存進 `$.store`（最多保留 30 個會話）：同一會話熱重載、重啟或恢復後數字不會歸零；`/clear` 或新會話從零開始。若無法接上先前的計數，金額格的提示會註明「token 計數自 HH:MM 起」。
- 快取寫入從「輸入」拆出來單獨記錄（`tokWrite`）：↑ 格數字仍是「未快取輸入＋快取寫入」，滑鼠移上去會拆成兩項；終端機版顯示為 `⇧ 6.0k (寫 6.0k)`。
- 新增 2 個測試（一輪三次請求只算一次、不與整輪總數重複；沒有請求用量時退回整輪總數）。

**仍然不計入 token（只在金額裡）**：`model.classify`（結果不含用量），以及不經過上述鉤子的引擎內部輔助呼叫，占比很小。

### 修正：終端機版什麼都不顯示

`ui.resolve` 會替每個介面補齊所有元素名稱（該介面沒有的元素變成空 fragment），所以 `'Svg' in t` 在終端機上也是 true，用量條畫出一個空的 Svg，什麼都看不到。改成依 `e.surface` 判斷：終端機畫文字列，其餘畫 Svg。

### 修正：蓋掉其他外掛在輸入框上方的內容

`AbovePrompt` 是所有外掛共用的區塊。舊版不呼叫 `next()` 直接回傳，會把下層外掛畫的內容（例如 cc-arcade 的棋盤）蓋掉。現在先取下層內容，再把用量條疊在下方。

### 其他

- 版本號 0.1.0 → 1.1.0。
- 新增 `hooks/band.test.tsx`（共 5 個測試）。

### 如何自行核對 token 數

對話記錄在 `~/.claude/projects/<專案目錄>/<會話id>.jsonl`。同一則回覆會拆成多行、每行帶同一份 usage，必須依 `message.id` 去重：

```python
import json
seen = {}
for ln in open('<會話id>.jsonl'):
    try: d = json.loads(ln)
    except ValueError: continue
    m = d.get('message') or {}
    if isinstance(m, dict) and m.get('usage'):
        seen[m.get('id') or d.get('requestId')] = m['usage']
t = {k: sum((u.get(k) or 0) for u in seen.values()) for k in
     ('input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens', 'output_tokens')}
print(len(seen), 'responses', t)
```

修正後，新開會話的 token 三格應與這裡的總數基本一致（升級前已開著的會話仍跑舊程式，要重開才生效）。

## 0.1.0

初版（原作者 [letswritetw](https://github.com/letswritetw/claude-mod-token-usage)）。
