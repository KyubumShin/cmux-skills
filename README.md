# cmux-skills

Cross-session control and context sharing for [Claude Code](https://claude.ai/code) via [cmux](https://cmux.com) terminal multiplexer.

## Skills

### cmux-control

Remotely control another Claude Code session — automate interview responses, approve permissions, navigate selection UIs, execute commands, and monitor long-running tasks.

```bash
/cmux-control workflow:interview workspace:6 surface:17
/cmux-control workflow:execute surface:12 prompt:"run tests"
```

**Key capabilities:**
- 8-state detection: IDLE, PROCESSING, ASKING_TEXT, ASKING_SELECT, ASKING_PERMIT, DIALOG, COMPLETE, ERROR
- Selection UI navigation via `cmux send "<number>"` (tested & verified)
- Permission auto-approval (numbered selection, not y/n)
- Adaptive polling (2s/5s/15s based on state)
- 4 workflows: interview, execute, guide, monitor

### cmux-get

Read-only context import from other Claude Code sessions. Discover sessions, read their output, clean it up, and inject as context.

```bash
/cmux-get                    # local, diff mode
/cmux-get remote             # cross-workspace
/cmux-get surface:14 --all   # full scrollback
```

**Key capabilities:**
- Local (same workspace) and remote (cross-workspace) modes
- Checkpoint-based diff mode (only new content since last read)
- Content cleaning: strips spinners, ANSI codes, UI chrome
- Multi-surface selection

## Requirements

- [cmux](https://cmux.com) terminal multiplexer
- cmux >= 0.62.0 (minimum) — number key selection works
- cmux >= 0.63.0 (recommended) — arrow key support

## Installation

### 1. Add marketplace

```bash
claude mcp add-marketplace cmux-skills \
  --source github \
  --repo KyubumShin/cmux-skills
```

### 2. Install plugin

```bash
claude /install-plugin cmux-skills
```

After installation, the `/cmux-control` and `/cmux-get` skills will be available in all Claude Code sessions.

## Tested Behaviors

| Action | Method | Result |
|--------|--------|--------|
| AskUserQuestion selection | `cmux send "3"` | Selects option 3 |
| Permission approval | `cmux send "1"` | Approves (Yes) |
| `send-key <number>` | `cmux send-key 3` | **Fails** (Unknown key) |
| `ctrl+n` navigation | `cmux send-key ctrl+n` | **Fails** (no cursor movement) |
| Text input | `cmux send "text"` + `send-key enter` | Works |

**Key insight**: Use `cmux send` (text), not `cmux send-key`, for option selection. Claude Code's TUI interprets typed digits as direct option selection.

## Architecture

```
cmux-get (read)     cmux-control (read + write)
     │                       │
     │    ┌──────────────────┤
     │    │                  │
     ▼    ▼                  ▼
  Layer 1: Screen Reading    Layer 2: Control Primitives
  (shared patterns)          send_text / select_option /
                             answer_permission / dismiss
                                     │
                                     ▼
                             Layer 3: Workflows
                             interview / execute /
                             guide / monitor
```

## License

MIT
