[English](CHANGELOG.md) | **繁體中文** | [简体中文](CHANGELOG.zh-CN.md)

# 更新紀錄

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
