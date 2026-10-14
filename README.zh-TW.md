[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

# token-usage

Claude Desktop（Code 分頁）輸入框上方的用量條：5h / 7d 額度、token 用量、花費。

> 這是 [letswritetw/claude-mod-token-usage](https://github.com/letswritetw/claude-mod-token-usage) 的 fork。
> **v1.1.0** 修正 token 三格嚴重少算（改為每個 API 回應計一次）、終端機版不顯示、蓋掉其他外掛的問題，詳見 [更新紀錄](CHANGELOG.zh-TW.md)。

## 安裝
- macOS：`bash install.sh`
- Windows：在 PowerShell 執行 `powershell -ExecutionPolicy Bypass -File install.ps1`

完成後完全關閉並重開 Claude Desktop。腳本會備份並合併 `~/.claude/settings.json`（只新增 `env` 內兩個變數）。

## 需求
- 支援 mod 功能的新版 Claude Code / Claude Desktop
- 5h / 7d 額度需訂閱帳號；第一次回應後才有資料

## 解除安裝
刪除 `~/.claude/mods/token-usage`，並從 `settings.json` 的 `env` 移除 `CLAUDE_CODE_PLUGIN_DIRS` 與 `CLAUDE_CODE_PLUGIN_DIR_WATCH`。
