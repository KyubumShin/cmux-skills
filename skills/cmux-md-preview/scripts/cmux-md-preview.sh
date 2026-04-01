#!/bin/bash
# cmux markdown dark-theme preview hook (server-based)
# Only auto-opens .md files containing checkboxes (checklist selection workflow)

STATE_FILE="/tmp/cmux-md-preview-pane"
PID_FILE="/tmp/cmux-preview-server.pid"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_SCRIPT="$SCRIPT_DIR/preview-server.mjs"
PORT=19542
HOST="127.0.0.1"

# Read hook data from stdin
STDIN_DATA=""
if [ ! -t 0 ]; then
  STDIN_DATA=$(cat)
fi

# Extract file_path from stdin JSON
FILE_PATH=$(echo "$STDIN_DATA" | jq -r '.tool_input.file_path // .tool_input.filePath // empty' 2>/dev/null)

# Only act on .md files
if [[ "$FILE_PATH" != *.md ]]; then
  exit 0
fi

# Skip memory files
if [[ "$FILE_PATH" == *"/.claude/"* ]]; then
  exit 0
fi

if [ ! -f "$FILE_PATH" ]; then
  exit 0
fi

# Only auto-open files containing checkboxes (checklist selection workflow)
if ! grep -q '^\s*[-*+]\s\+\[[ xX]\]' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

# Ensure preview server is running
if ! curl -s --connect-timeout 1 "http://$HOST:$PORT/health" >/dev/null 2>&1; then
  if [ -f "$PID_FILE" ]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null
    rm -f "$PID_FILE"
  fi
  nohup node "$SERVER_SCRIPT" >/dev/null 2>&1 &
  for i in $(seq 1 30); do
    curl -s --connect-timeout 1 "http://$HOST:$PORT/health" >/dev/null 2>&1 && break
    sleep 0.1
  done
fi

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
  fi
else
  # Check if same file is already open in a tab (use tree for URL info)
  EXISTING_SURFACE=$(cmux tree 2>/dev/null | grep "file=$ENCODED_PATH" | grep -o 'surface:[^ ]*' | head -1)
  if [ -n "$EXISTING_SURFACE" ]; then
    # Already open: reload the existing tab
    cmux tab-action --action reload --tab "$EXISTING_SURFACE" >/dev/null 2>&1
  else
    # New file: add as new tab
    RESULT=$(cmux new-surface --type browser --pane "$PREVIEW_PANE" --url "$FILE_URL" 2>&1)
  fi
fi

exit 0
