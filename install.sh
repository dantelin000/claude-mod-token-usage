#!/bin/bash
# token-usage installer for macOS / Linux
set -e
SRC="$(cd "$(dirname "$0")" && pwd)/token-usage"
DEST="$HOME/.claude/mods/token-usage"
SETTINGS="$HOME/.claude/settings.json"

mkdir -p "$HOME/.claude/mods"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"

[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
cp "$SETTINGS" "$SETTINGS.bak-token-usage"

DEST="$DEST" SETTINGS="$SETTINGS" python3 - <<'PY' 2>/dev/null || DEST="$DEST" SETTINGS="$SETTINGS" node -e '
const fs=require("fs"),p=process.env.SETTINGS;
const j=JSON.parse(fs.readFileSync(p,"utf8")||"{}");
j.env={...(j.env||{}),CLAUDE_CODE_PLUGIN_DIRS:process.env.DEST,CLAUDE_CODE_PLUGIN_DIR_WATCH:"1"};
fs.writeFileSync(p,JSON.stringify(j,null,2));'
import json, os
p = os.environ["SETTINGS"]
j = json.load(open(p) or "{}") if os.path.getsize(p) else {}
j.setdefault("env", {})
j["env"]["CLAUDE_CODE_PLUGIN_DIRS"] = os.environ["DEST"]
j["env"]["CLAUDE_CODE_PLUGIN_DIR_WATCH"] = "1"
json.dump(j, open(p, "w"), indent=2)
PY

echo "已安裝到 $DEST"
echo "設定已更新（備份：$SETTINGS.bak-token-usage）"
echo "請完全關閉並重新開啟 Claude Desktop。"
