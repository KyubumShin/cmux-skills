#!/bin/bash
# Preview markdown file in cmux browser pane via preview server
# Usage: preview.sh <markdown-file-path>
# - Starts preview server if not running
# - Serves interactive HTML (clickable checkboxes sync to .md)
# - Reuses existing preview pane or non-caller pane, refreshes if same file already open

STATE_FILE="/tmp/cmux-md-preview-pane"
PID_FILE="/tmp/cmux-preview-server.pid"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/preview-server.mjs"
PORT=19542
HOST="127.0.0.1"

FILE_PATH="$1"

if [ -z "$FILE_PATH" ]; then
  echo "Usage: preview.sh <markdown-file-path>"
  exit 1
fi

# Resolve to absolute path
if [[ "$FILE_PATH" != /* ]]; then
  FILE_PATH="$(cd "$(dirname "$FILE_PATH")" 2>/dev/null && pwd)/$(basename "$FILE_PATH")"
fi

if [ ! -f "$FILE_PATH" ]; then
  echo "File not found: $FILE_PATH"
  exit 1
fi

if [[ "$FILE_PATH" != *.md ]]; then
  echo "Not a markdown file: $FILE_PATH"
  exit 1
fi

# Ensure preview server is running
ensure_server() {
  if curl -s --connect-timeout 1 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
    return 0
  fi

  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null
    rm -f "$PID_FILE"
  fi

  nohup node "$SERVER_SCRIPT" >/dev/null 2>&1 &

  for i in $(seq 1 30); do
    if curl -s --connect-timeout 1 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.1
  done

  echo "Failed to start preview server"
  exit 1
}

ensure_server

ENCODED_PATH=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$FILE_PATH")
FILE_URL="http://$HOST:$PORT/preview?file=$ENCODED_PATH"

# Check if we have an existing preview pane
PREVIEW_PANE=""
if [ -f "$STATE_FILE" ]; then
  PREVIEW_PANE=$(cat "$STATE_FILE")
  if ! cmux list-pane-surfaces --pane "$PREVIEW_PANE" >/dev/null 2>&1; then
    PREVIEW_PANE=""
    rm -f "$STATE_FILE"
  fi
fi

# If no saved pane, look for an existing non-caller pane in this workspace
if [ -z "$PREVIEW_PANE" ]; then
  CALLER_PANE=$(cmux identify 2>/dev/null | jq -r '.caller.pane_ref // empty')
  if [ -n "$CALLER_PANE" ]; then
    OTHER_PANE=$(cmux list-panes 2>/dev/null | grep -o 'pane:[^ ]*' | grep -v "$CALLER_PANE" | head -1)
    if [ -n "$OTHER_PANE" ]; then
      PREVIEW_PANE="$OTHER_PANE"
      echo "$PREVIEW_PANE" > "$STATE_FILE"
    fi
  fi
fi

if [ -z "$PREVIEW_PANE" ]; then
  # No other pane exists: create browser pane
  RESULT=$(cmux new-pane --type browser --direction right --url "$FILE_URL" 2>&1)
  PANE_ID=$(echo "$RESULT" | grep -o 'pane:[^ ]*' | head -1)
  if [ -n "$PANE_ID" ]; then
    echo "$PANE_ID" > "$STATE_FILE"
    echo "Opened preview in new pane: $FILE_PATH"
  else
    echo "Failed to create preview pane"
    exit 1
  fi
else
  # Check if same file is already open in a tab (use tree for URL info)
  EXISTING_SURFACE=$(cmux tree 2>/dev/null | grep "file=$ENCODED_PATH" | grep -o 'surface:[^ ]*' | head -1)
  if [ -n "$EXISTING_SURFACE" ]; then
    cmux tab-action --action reload --tab "$EXISTING_SURFACE" >/dev/null 2>&1
    echo "Refreshed existing tab: $FILE_PATH"
  else
    RESULT=$(cmux new-surface --type browser --pane "$PREVIEW_PANE" --url "$FILE_URL" 2>&1)
    echo "Opened new tab: $FILE_PATH"
  fi
fi
