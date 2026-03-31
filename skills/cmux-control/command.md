# cmux-control

Control another Claude Code session remotely via cmux. The action counterpart to cmux-get (read-only).

## Quick Start

```bash
# Interactive setup — discover workspace, create split, choose workflow
/cmux-control

# Interview automation — answer questions for the Target
/cmux-control workflow:interview workspace:6 surface:17

# Execute a command with auto-permission handling
/cmux-control workflow:execute surface:12 prompt:"mpl 프로젝트를 구현해줘"

# With pre-defined answers (interview)
/cmux-control workflow:interview answers:experiments/answers/dataforge.json

# Spec-based virtual user (interview)
/cmux-control workflow:interview spec:specs/yggdrasil-project-spec.md

# Monitor a long-running session
/cmux-control workflow:monitor surface:17

# Guide — send instructions step by step
/cmux-control workflow:guide surface:12
```

## Workflows

| Workflow | What it does |
|----------|-------------|
| `interview` | Detect questions, compose & send answers automatically |
| `execute` | Send command, auto-approve permissions, monitor completion |
| `guide` | Send instructions one at a time, verify each step |
| `monitor` | Observe a running session, intervene on anomalies |

## Key Features

- **Selection UI navigation**: Number keys (1-4) to pick options, arrow keys on cmux >= 0.63.0
- **8-state detection**: IDLE, PROCESSING, ASKING_TEXT, ASKING_SELECT, ASKING_PERMIT, DIALOG, COMPLETE, ERROR
- **Adaptive polling**: 2s after state change, 5s normal, 15s during long processing
- **Auto permission**: Approves tool permission prompts automatically
- **Dialog dismissal**: Handles /btw popups and modal overlays

## Requirements

- Running inside **cmux** terminal (`cmux ping` to verify)
- cmux >= 0.63.0 recommended (arrow key support)
- cmux >= 0.62.0 minimum (number key selection works)

## Related

- `/cmux-get` — Read-only: fetch output from other sessions
- `/cmux-control` — Read+Write: control other sessions (this skill)
