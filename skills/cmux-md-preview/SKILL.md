---
name: cmux-md-preview
description: "Markdown interactive preview in cmux browser pane with dark theme. Checkboxes are clickable and sync back to the source .md file. Use for preview/checklist selection workflows. Trigger on: preview, 프리뷰, 미리보기, or when presenting multi-item selection lists that exceed AskUserQuestion's option limit."
---

# cmux-md-preview

Markdown 파일을 cmux 브라우저 pane에서 다크 테마 인터랙티브 프리뷰합니다.
체크박스(`- [ ]`)는 클릭 가능하며 원본 .md 파일에 자동 반영됩니다.

## Usage

```
/cmux-md-preview <file-path>
/cmux-md-preview README.md
```

## Execution

```bash
bash $CLAUDE_PLUGIN_ROOT/skills/cmux-md-preview/scripts/preview.sh "<file-path>"
```

Accepts both absolute and relative paths.

## Hook (auto-preview)

This skill includes a PostToolUse hook that automatically opens `.md` files containing checkboxes (`- [ ]`) after Write/Edit operations. Memory files under `/.claude/` are excluded.

## Pane reuse logic

The hook avoids creating unnecessary split panes:

1. **Saved pane** — If a previous preview pane ID is stored in `/tmp/cmux-md-preview-pane` and still exists, reuse it.
2. **Existing non-caller pane** — If no saved pane, detect the caller pane via `cmux identify` and look for any other pane in the current workspace. If found, open in that pane (no new split).
3. **New split** — Only creates a new `--direction right` split when no other pane exists at all.

Within a reused pane:
- Same file already open → reload existing tab
- Different file → add as a new tab

## Checklist selection workflow

Use this as an alternative to `AskUserQuestion` when presenting more than 4 options.

### Flow

1. **Claude**: Write a `.md` file with checkboxes (PostToolUse hook auto-opens preview)
2. **User**: Click checkboxes in the browser pane to select items
3. **Claude**: Read the `.md` file back to see which items are `[x]`

### Example checklist .md

```markdown
# Select target directories

Choose directories to process, then let me know.

- [ ] src/api/auth
- [ ] src/api/users
- [ ] src/api/posts
- [ ] src/services/notification
- [ ] src/services/email
- [ ] src/utils/logger
```

## Features

- Dark theme HTML rendering
- Clickable checkboxes synced to source file
- Auto-refresh on external file changes (2s polling)
- Preview pane reuse (no redundant splits)
- Tab-per-file with reload support

## Requirements

- `marked` CLI (`npm install -g marked`)
- `cmux` environment
- Node.js (for preview-server)
- `jq` (for hook JSON parsing)
