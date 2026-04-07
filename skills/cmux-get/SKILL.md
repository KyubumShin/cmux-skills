---
name: cmux-get
description: "Fetch context from other Claude Code sessions via cmux terminal multiplexer. Use this skill when the user wants to pull results, output, or conversation context from another Claude Code session into the current one. Trigger when the user mentions: cross-session context, importing output from another pane, reading another CLI's results, cmux-get, pulling context from another workspace, checking what another Claude is doing, or aggregating multi-session output."
---

# cmux-get

Read and import context from other Claude Code sessions running in cmux into the current conversation. cmux-get is a **read-only, one-shot operation**: discover sessions, read their output, clean it up, and inject the useful parts as context.

**Relationship with cmux-control**: cmux-get reads, cmux-control acts. Use cmux-get to pull output from other sessions. Use cmux-control to remotely operate another session (send input, navigate UIs, approve permissions). They share screen reading patterns but serve different roles.

## Modes

| Mode | When to use | What it does |
|------|-------------|--------------|
| `local` | Target CLI is in the **same workspace** | Find sibling surfaces, pick one or more |
| `remote` | Target CLI is in a **different workspace** | Discover all other workspaces and surfaces, pick one or more |

## Arguments

`$ARGUMENTS` — Mode and optional flags:

- Empty or `local`: same-workspace mode (default)
- `remote`: cross-workspace mode — enumerates all other workspaces, flattens surfaces into one list, multi-select
- `surface:<ref>`: skip discovery, read this specific surface directly
- `workspace:<ref>`: target a specific workspace (for remote mode)
- `lines:<N>`: read last N lines instead of full scrollback (default: scrollback)
- `--all`: return **full scrollback** ignoring checkpoint (default is diff mode — only new content since last read)

By default, cmux-get operates in **diff mode**: if a checkpoint exists for the target surface, only new content since the last read is returned. Use `--all` to override and fetch everything.

Examples:
```
/cmux-get                         # local, diff (new content only)
/cmux-get remote                  # remote, diff — all other workspaces
/cmux-get --all                   # local, full scrollback
/cmux-get remote --all            # remote, full scrollback
/cmux-get surface:14              # direct target, diff
/cmux-get remote workspace:3     # shortcut: target specific remote workspace
/cmux-get local lines:50
```

---

## Step 0: Verify cmux is available

```bash
cmux ping
```

If this fails, tell the user cmux is not running and stop.

## Step 1: Identify self

Before anything else, figure out where **you** are so you can exclude yourself from the scan.

```bash
cmux identify --json
```

The output has two sections — **use `focused`, not `caller`**:

- **`focused`** — the currently active UI element. This is where the user is actually looking and where your surface lives. Reliable.
- **`caller`** — based on `CMUX_WORKSPACE_ID` env var set at process start. This can be **stale** if the surface was moved between workspaces. The `surface_ref` is often `null`. Do not rely on this.

Extract from `focused`:
- `$MY_WS` — `focused.workspace_ref` (e.g., `workspace:6`)
- `$MY_SURFACE` — `focused.surface_ref` (e.g., `surface:1`)

These are used to **exclude the current session** from results. Never read your own surface — that creates a useless recursive capture.

---

## Mode: `local` (Same Workspace)

### Step 2L: Discover sibling surfaces

```bash
cmux tree --workspace $MY_WS --json
```

Parse the tree output to find all surfaces. Filter out `$MY_SURFACE` to get the list of "other" surfaces in this workspace.

**If 0 other surfaces**: Tell the user there are no other sessions in this workspace. Suggest using `remote` mode instead.

**If 1 other surface**: Auto-select it as `$TARGET`.

**If 2+ other surfaces**: Use `AskUserQuestion` with `multiSelect: true` to let the user pick one or more. Show the surface title from the tree output (e.g., "✳ Investigate .omc file") and optionally a 3-5 line preview:

```bash
cmux read-screen --workspace $MY_WS --surface $SURFACE_REF --lines 5
```

### Step 3L: Read target content

For each selected surface:

```bash
# Full scrollback (default)
cmux read-screen --workspace $MY_WS --surface $TARGET --scrollback

# Or limited lines if lines:<N> was specified
cmux read-screen --workspace $MY_WS --surface $TARGET --lines $N
```

Proceed to **Step 3: Process and inject**.

---

## Mode: `remote` (Other Workspaces)

### Step 2R: Enumerate all other workspaces and surfaces

```bash
cmux list-workspaces --json
```

Filter out `$MY_WS`. If `workspace:<ref>` was provided in arguments, use only that workspace.

For **each** remote workspace, get the tree and sidebar metadata:
```bash
cmux tree --workspace $WS_REF --json
cmux sidebar-state --workspace $WS_REF
```

Build a **flat list** of all surfaces across all remote workspaces. For each surface, include:
- Workspace ref and title
- Surface ref and title (from tree output)
- CWD and git branch (from sidebar-state)

### Step 3R: Present summary and let user select

Build a summary table:

```
| # | Workspace | Surface | CWD / Branch | Title |
|---|-----------|---------|--------------|-------|
| 1 | workspace:1 | surface:4 | ~/playground/yggdrasil | Check matplotlib unimplemented items |
| 2 | workspace:1 | surface:10 | ~/playground/yggdrasil | (terminal) |
| 3 | workspace:4 | surface:9 | ~/project/ccviz-spec (main) | playwright-e2e-test-plan |
```

Use `AskUserQuestion` with `multiSelect: true` so the user can pick **one or more** surfaces to import.

**If only 1 remote surface total**: Auto-select it.

### Step 4R: Read selected surfaces

For each selected surface:
```bash
cmux read-screen --workspace $WS --surface $SURFACE --scrollback
```

Proceed to **Step 3: Process and inject**.

---

## Step 3: Process and inject

This is the most important step. Raw terminal output is full of noise — spinner characters, UI chrome, ANSI escape sequences, permission prompts, repeated status lines. The user wants **clean, useful context**, not a raw terminal dump.

### What to strip

- **Spinner/status lines**: Lines containing only `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠐⠂` or `✢ Thinking…` / `✢ Gallivanting…` etc.
- **ANSI escape codes**: `\e[...m` and similar terminal formatting sequences
- **Box-drawing UI chrome**: Lines that are purely decorative borders (`╭─╮`, `│`, `╰─╯`, `─────`)
- **Repeated empty lines**: Collapse 3+ consecutive blank lines into one
- **Permission prompts**: `Allow [tool]? (y/n)` lines and their responses
- **Tool call markers** that add no context: bare `⏺` lines without meaningful content

### What to keep

- **Actual output text**: Claude's responses, explanations, code blocks
- **Tool results**: File contents shown, command outputs, test results
- **Code diffs**: Edit operations showing what changed
- **Error messages**: These are often exactly what the user wants to see
- **Structure markers**: Section headers, table borders when they contain data
- **Summary blocks**: Any `## Summary`, completion tables, final reports

### Processing rules

1. Strip noise using the rules above
2. If the cleaned content exceeds **500 lines**, focus on the **last meaningful section** — typically the most recent tool output or Claude response. Mention that earlier content was truncated.
3. When multiple surfaces were selected, clearly separate each with a header:
   ```
   --- Context from workspace:3 / surface:8 (~/project/foo) ---
   [cleaned content]

   --- Context from workspace:6 / surface:15 (~/project/bar) ---
   [cleaned content]
   ```
4. Output the processed context directly as text in the conversation. This makes it immediately available as context for the current Claude session.

### Output format

Present the cleaned context wrapped in a clear delimiter so the user (and the current Claude session) can reference it:

```
## Imported Context [from workspace:X / surface:Y]

[cleaned content here]

---
Source: cmux read-screen --workspace X --surface Y --scrollback
Captured: YYYY-MM-DD HH:MM:SS
Lines: N (original) → M (after cleanup)
```

---

## Checkpoint System (diff mode)

cmux has no native checkpoint support — `read-screen` always returns the full scrollback. The skill implements its own checkpoint mechanism to avoid re-reading content you've already seen.

### Checkpoint file

Store checkpoints in `.cmux-get/checkpoints.json` in the current working directory:

```json
{
  "workspace:4/surface:9": {
    "timestamp": "2026-03-30T14:30:00",
    "total_lines": 833,
    "tail_hash": "a3f2c1e8",
    "tail_lines": [
      "⏺ 기록 완료. ccviz-spec에 분석 기능을 추가할 때도...",
      "───────────── playwright-e2e-test-plan ──",
      "❯  ",
      "─────────────────────────────────────────",
      "  ccviz-spec | 5h:7%(3h31m) | wk:37%..."
    ]
  }
}
```

Each entry stores:
- `timestamp` — when the checkpoint was taken
- `total_lines` — line count at checkpoint time
- `tail_hash` — MD5 hash of the last 5 lines (for fast matching)
- `tail_lines` — the actual last 5 lines (for content-based search if line count shifted)

### How diff mode works (default)

1. **Read full scrollback** from the target surface
2. **Load checkpoint** for this surface key (`workspace:X/surface:Y`)
3. **If no checkpoint exists** (first read): return everything — this is the initial baseline
4. **If checkpoint exists**, find the checkpoint position in the new scrollback:
   - First, try fast match: if `tail_hash` matches lines at the same position (`total_lines - 5` to `total_lines`), use that offset
   - If fast match fails (scrollback shifted), search backwards through the scrollback for the `tail_lines` sequence
   - If no match found at all (checkpoint too old, scrollback buffer overflowed), return everything and warn the user: "Checkpoint expired — returning full content"
5. **Return only lines after the checkpoint position**
6. **Save new checkpoint** with current tail state

### When `--all` is specified

Ignore any existing checkpoint and return the full scrollback. Still save a new checkpoint afterward so that the next default read starts from here.

### Checkpoint is always saved

Every read (diff or `--all`) updates the checkpoint. It's a "last read" marker, always active.

### Checkpoint key format

Use `workspace:<ref>/surface:<ref>` as the key. If a surface moves between workspaces (rare), it gets a new key — the old checkpoint becomes orphaned but harmless.

### Shared with cmux-control

`cmux-control` reads and writes the **same** `.cmux-get/checkpoints.json` file using the **same key format**. This means a control session followed by a get (or vice versa) on the same target stays coherent — neither skill re-reads content the other already saw. Both skills must preserve this schema exactly.

### Cleanup

Checkpoints older than 24 hours are stale (scrollback likely overflowed). On each skill invocation, prune entries with timestamps older than 24h.

---

## Error handling

| Situation | Action |
|-----------|--------|
| `cmux ping` fails | Stop. Tell user cmux is not running. |
| No other surfaces/workspaces found | Stop. Suggest the user open another Claude Code session first. |
| `read-screen` returns empty | Report that the surface appears empty. May be a fresh terminal. |
| `read-screen` fails with error | Report the error. Surface may have been closed. Try `cmux tree` to verify it still exists. |
| Scrollback is extremely large (>2000 lines raw) | Use `--lines 200` as fallback and inform user. Suggest they specify `lines:N` for more precision. |

## cmux CLI quick reference

Every command that targets a specific pane MUST include `--workspace $WS`.

| Action | Command |
|--------|---------|
| Check cmux alive | `cmux ping` |
| Identify self | `cmux identify --json` |
| List workspaces | `cmux list-workspaces --json` |
| List surfaces | `cmux list-surfaces --workspace $WS --json` |
| Show tree layout | `cmux tree --workspace $WS --json` |
| Read visible screen | `cmux read-screen --workspace $WS --surface $S --lines N` |
| Read full scrollback | `cmux read-screen --workspace $WS --surface $S --scrollback` |
| Get sidebar metadata | `cmux sidebar-state --workspace $WS` |

### Known limitations

- **Workspace ref mismatch**: `CMUX_WORKSPACE_ID` env var is a UUID but commands need `workspace:N` format. Always discover the ref via `cmux identify --json`.
- **Scrollback buffer**: Limited by Ghostty's scrollback buffer setting. Very long sessions may have truncated history.
- **No ANSI stripping in cmux**: `read-screen` returns raw terminal content including escape codes. Cleaning is done in Step 3.
