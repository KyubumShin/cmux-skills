# cmux-get

Fetch context from other Claude Code sessions via cmux.

## Quick Start

```bash
# Same workspace — read sibling pane (default)
/cmux-get

# Other workspaces — discover all, multi-select
/cmux-get remote

# Direct target — skip discovery
/cmux-get surface:14
/cmux-get remote workspace:3

# Full mode — ignore checkpoint, get everything
/cmux-get --all
/cmux-get remote --all

# Limit read to last N lines
/cmux-get lines:50
```

## Modes

| Mode | Command | Description |
|------|---------|-------------|
| `local` | `/cmux-get` | Same workspace, pick sibling surface(s) |
| `remote` | `/cmux-get remote` | All other workspaces, flat surface list, multi-select |

## What it does

1. Discovers available Claude Code sessions via cmux
2. Reads their terminal output (screen or scrollback)
3. Strips noise (spinners, UI chrome, ANSI codes, permission prompts)
4. Returns only new content since last read (diff mode, default)
5. Injects cleaned context into the current conversation

## Diff vs All

- **Default (diff)**: Only new content since last read. First read returns everything.
- **`--all`**: Full scrollback, ignoring checkpoint.

## Requirements

- Running inside **cmux** terminal (Ghostty)
- `cmux ping` must succeed
