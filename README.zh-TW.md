[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

# token-usage

Claude Desktop（Code 分頁）輸入框上方的用量條：5h / 7d 額度、token 用量、花費。

> 這是 [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage) 的 fork。
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

**1. 記錄每次呼叫。** 把 API 回應（或只有 usage 物件）交給輔助腳本。它只留數字，不留提示詞與回覆內容，並用 `$CLAUDE_CODE_SESSION_ID` 標上會話：

```bash
~/.claude/mods/token-usage/bin/tu-log --provider vertex < response.json
~/.claude/mods/token-usage/bin/tu-log --provider openai --model gpt-x '{"usage":{"prompt_tokens":500,"completion_tokens":200}}'
```

也可以用任何語言自己在 `~/.claude/token-usage/ledger/YYYY-MM-DD.jsonl`（本地日期）後面加一行。`ts` 是毫秒，`usage` 是該 provider 自己回傳的 usage 物件：

```json
{"ts":1793148848057,"session":"<CLAUDE_CODE_SESSION_ID>","provider":"vertex","model":"gemini-x","usage":{"promptTokenCount":12000,"candidatesTokenCount":340}}
```

可辨識：Gemini / Vertex 的 `usageMetadata`（含 Gemini CLI 的統計）、OpenAI（chat 與 Responses）、Anthropic、Ollama。（輔助腳本需要 Python 3；Windows 請用 `python tu-log` 執行，未在 Windows 測試。）

**2. 價格（選用）。** 把 `prices.example.json` 複製成 `~/.claude/token-usage/prices.json`，照你 provider 的價格頁填入每百萬 token 的美元單價。本專案不附任何真實價格。沒有輸入與輸出單價的模型只統計 token，標為未定價。缺 `cached` / `cacheWrite` 單價時用輸入價，缺 `thinking` 時用輸出價；`longPrompt` 可設定提示超過某長度後的較高單價。

**3. 查詢。** `/usage-ext` 看本對話，或 `/usage-ext today`、`7d`、`all`。加 `json` 輸出機器可讀的結果。環境變數 `TOKEN_USAGE_EXT_DIR` 可更改資料夾。

**限制。** mod 看不到其他程式的網路流量，所以只有被記錄的呼叫才會計入。估價 = token x 你填的單價，以 provider 的帳單為準。

## 解除安裝
刪除 `~/.claude/mods/token-usage`，並從 `settings.json` 的 `env` 移除 `CLAUDE_CODE_PLUGIN_DIRS` 與 `CLAUDE_CODE_PLUGIN_DIR_WATCH`。
