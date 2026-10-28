[English](CHANGELOG.md) | **繁體中文** | [简体中文](CHANGELOG.zh-CN.md)

# 更新紀錄

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
