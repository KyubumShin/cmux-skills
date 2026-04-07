---
name: cmux-control
description: "Control another Claude Code session remotely via cmux terminal multiplexer. Use this skill for cross-session proxy control: automated interview responses, command execution with auto-permission handling, selection UI navigation, step-by-step guided workflows, and long-running session monitoring. The action counterpart to cmux-get (read-only). Trigger when the user mentions: 대리조작, proxy control, cross-session control, interview automation, auto-respond, remote session, controlling another pane, cmux-control, or wants to operate another Claude Code session from the current one."
---

# cmux-control

Remotely control a **Target** Claude Code session from the current **Harness** session via cmux. The Harness reads the Target's screen, detects its state (idle, processing, asking a question, showing a permission prompt, etc.), and performs the appropriate action — all without human keyboard input on the Target side.

## Why this exists

Many Claude Code workflows require human interaction — answering interview questions, approving permissions, selecting options, dismissing dialogs. This skill automates that interaction so one Claude session can operate another, enabling unattended testing, multi-session orchestration, and batch execution.

**Relationship with cmux-get**: cmux-get is read-only (fetches output from other sessions). cmux-control is the action counterpart — it **reads AND writes** to the Target session.

## Prerequisites

- **cmux >= 0.63.0** (recommended) — arrow key support for selection UI navigation
- **cmux >= 0.62.0** (minimum) — number key selection still works
- Verify: `cmux ping` and `cmux --version`

## Arguments

`$ARGUMENTS` — Optional configuration:
- Empty: interactive setup
- `workspace:<ref>`: target workspace (e.g., `workspace:6`)
- `surface:<ref>`: target an existing session (skip split creation)
- `workflow:<name>`: run a specific workflow — `interview`, `execute`, `guide`, `monitor`
- `prompt:"<text>"`: initial prompt to send to Target
- `answers:/path/to/file.json`: pre-defined answers for interview workflow
- `spec:/path/to/spec.md`: act as virtual user based on spec document
- `--auto-permit`: automatically approve permission prompts by sending `1` (**default for ALL workflows**)
- `--ask-permit`: opt-out — escalate each permission prompt to the Harness user instead of auto-approving
- `--no-free-text`: don't force free-text-only mode (allow selection UIs)

## Global rules

These apply to **every** workflow unless explicitly overridden:

1. **Permission prompts auto-approve with `1`.** Whenever `ASKING_PERMIT` is detected, immediately call `answer_permission(allow=true)` (sends `1`). The intent is unattended operation — option `1` ("Yes, once") is always safe and reversible. Override with `--ask-permit`.
2. **Dialogs auto-dismiss.** `DIALOG` state always triggers `dismiss_dialog()`.
3. **Screen reads use cmux-get diff mode for non-polling reads** — see Step 2 below. Polling for state still uses lightweight `read-screen --lines 30`.

## Architecture

```
┌─ Harness (you are here) ──────┬── Target (controlled) ──────┐
│                                │                              │
│  Layer 3: Workflow             │                              │
│  ┌─ interview ──────────────┐  │                              │
│  │  answer questions        │  │  AskUserQuestion: "...?"    │
│  └──────────────────────────┘  │                              │
│  ┌─ execute ────────────────┐  │                              │
│  │  send cmd, auto-permit   │  │  Allow Edit? (y/n)          │
│  └──────────────────────────┘  │                              │
│                                │                              │
│  Layer 2: Control Primitives   │                              │
│  send_text / send_key /        │  ← receives input            │
│  select_option / dismiss       │                              │
│                                │                              │
│  Layer 1: Screen Reading       │                              │
│  read_screen / detect_state    │  → reads screen              │
│  (shared patterns with         │                              │
│   cmux-get)                    │                              │
└────────────────────────────────┴──────────────────────────────┘
```

---

## Step 1: Discover workspace & Target

### Identify self

```bash
cmux identify --json
```

Use `focused.workspace_ref` as `$WS`. If `$ARGUMENTS` includes `workspace:<ref>`, use that instead.

### Set up Target

**If `surface:<ref>` provided**: use directly. Verify via `cmux tree --workspace $WS`.

**Otherwise**, create a new split:

```bash
cmux new-split right --workspace $WS
cmux tree --workspace $WS   # find new surface ref
```

Store Target surface as `$TGT`.

### Start Claude Code on Target (if needed)

```bash
cmux send --workspace $WS --surface $TGT "claude"
cmux send-key --workspace $WS --surface $TGT enter
```

Wait 8-10 seconds, then read screen. Handle startup prompts:

| Pattern | Action |
|---------|--------|
| Trust folder prompt (option 1 selected) | `send-key enter` |
| Trust folder prompt (option 1 not selected) | `send-key 1` then `send-key enter` |
| Bypass permissions warning | `send-key escape` |
| Welcome screen with `❯` | Ready — proceed |

---

## Step 2: Detect state (Layer 1)

Read the Target's screen and classify into one of 8 states. This is the foundation for all control actions.

There are **two read modes** — pick the right one for the job:

### A. Lightweight polling read (state detection)

```bash
cmux read-screen --workspace $WS --surface $TGT --lines 30
```

Used inside the poll loop. Cheap, returns only the visible viewport. Use this for `detect_state()` because state classification needs the *current* screen, not a diff.

### B. Diff read via cmux-get checkpoints (growth tracking + capture)

For **anything other than per-poll state detection** — progress tracking during long PROCESSING phases, mid-workflow log capture, and the final result capture in Step 5 — share the cmux-get checkpoint file at `.cmux-get/checkpoints.json` so you only fetch *new* content since the last read.

```bash
# 1. Read full scrollback
cmux read-screen --workspace $WS --surface $TGT --scrollback > /tmp/cmux-current.txt

# 2. Look up checkpoint key "workspace:N/surface:M" in .cmux-get/checkpoints.json
#    - If no checkpoint: this is the baseline. Save tail (last 5 lines + hash + total_lines).
#    - If checkpoint exists: locate tail_lines in current scrollback, return only lines after.
#    - If tail_lines not found: scrollback overflowed → return everything, warn, re-baseline.

# 3. Always update the checkpoint after reading.
```

**Why**: long-running execute/monitor workflows generate hundreds of kilobytes of scrollback. Re-reading the whole thing on every capture wastes context. cmux-get's checkpoint format is the canonical "last seen" marker — sharing it means cmux-control and cmux-get stay coherent even if the user switches between them on the same target.

**Checkpoint key format** — must match cmux-get exactly: `"workspace:<N>/surface:<M>"`. See `cmux-get/SKILL.md § Checkpoint System` for the JSON schema. Stale entries (>24h) get pruned by either skill.

### Initial state read

```bash
cmux read-screen --workspace $WS --surface $TGT --lines 30
```

### State machine

| State | Detection pattern | Description |
|-------|-------------------|-------------|
| **IDLE** | `❯` on its own line, no question text above, screen stable | Prompt ready, no pending question |
| **PROCESSING** | Spinner chars (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏⠐⠂`) or status text (`✢ Thinking…`, `Gallivanting…`) in last 5 lines | Target is working |
| **ASKING_TEXT** | `❯` on its own line with question text above, no numbered options, no spinner | Free-text input expected |
| **ASKING_SELECT** | Lines matching `❯ N. <text>` or `  N. <text>`, with "Enter to select" hint | Selection UI — needs option choice |
| **ASKING_PERMIT** | `Allow <tool>?` or `(y/n)` pattern | Permission prompt |
| **DIALOG** | "Press Space, Enter, or Escape to dismiss" or `/btw` content | Modal overlay |
| **COMPLETE** | Completion markers + `❯` prompt returning after summary block | Task finished |
| **ERROR** | `Error:`, `error:`, `command not found`, or >60s no change without spinner | Something broke |

### Completion markers (bilingual)

Korean: `완료`, `정리하면`, `인터뷰가 완료`, `요약하면`, `모든 질문이 끝났습니다`
English: `Interview complete`, `To summarize`, `All questions answered`, `Here's a summary`, `That concludes`
Universal: summary table with `│` borders followed by `❯` prompt

### Screen diffing

To avoid false state detection, compare consecutive screen reads:

```
prev_screen = ""
for each poll:
    screen = read_screen()
    if screen == prev_screen:
        continue  # no change — still in same state
    changed_lines = diff(prev_screen, screen)
    prev_screen = screen
    state = detect_state(screen, changed_lines)
```

This prevents re-triggering on the same question and catches transitions more reliably.

---

## Step 3: Control primitives (Layer 2)

These are the atomic actions. All commands require `--workspace $WS --surface $TGT`.

### send_text(text)

```bash
cmux send --workspace $WS --surface $TGT "<text>"
cmux send-key --workspace $WS --surface $TGT enter
```

For long text (>200 chars), the terminal line buffer may truncate. Split into multiple sends if needed, or use a single `cmux send` without intermediate enters — cmux sends the full string.

### send_key(key)

```bash
cmux send-key --workspace $WS --surface $TGT <key>
```

Supported keys: `enter`, `tab`, `escape`, `backspace`, `delete`, `space`
Arrow keys (cmux >= 0.63.0): `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`
Modifiers: `ctrl+<key>`, `shift+<key>`, `ctrl+enter`, `shift+tab`

### select_option(n)

Navigate a selection UI and pick option `n`. Uses a 3-tier strategy:

**Tier 1 — Send number as text (preferred, works on all versions)**:
```bash
cmux send --workspace $WS --surface $TGT "<n>"      # e.g., "1", "2", "3", "4"
```

Claude Code's AskUserQuestion selection UI accepts number input to jump directly to an option and auto-confirm. This is the most reliable method — tested and verified.

**Important**: Use `cmux send` (text), NOT `cmux send-key`. `send-key` does not recognize number keys ("Unknown key" error). Sending the number as text works because Claude Code's TUI interprets typed digits as option selection.

**Tier 2 — Arrow key (cmux >= 0.63.0)**:
```bash
cmux send-key --workspace $WS --surface $TGT down   # repeat as needed
cmux send-key --workspace $WS --surface $TGT enter
```

Use when the UI doesn't use numbered options. Requires cmux >= 0.63.0.
Note: `ctrl+n`/`ctrl+p` do NOT work for navigation in Claude Code's selection widgets (tested, cursor doesn't move).

**Tier 3 — Escape + free-text fallback**:
```bash
cmux send-key --workspace $WS --surface $TGT escape
# Re-instruct Target to use free-text mode
cmux send --workspace $WS --surface $TGT "이전 질문에 대해 자유 텍스트로 다시 물어봐"
cmux send-key --workspace $WS --surface $TGT enter
```

Last resort when selection UI is completely unnavigable.

### answer_permission(allow)

Permission prompts render as a **numbered selection UI**, not y/n text input:

```
 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to <path> from this project
   3. No
```

```bash
# Approve once:
cmux send --workspace $WS --surface $TGT "1"

# Approve always (for this tool/path):
cmux send --workspace $WS --surface $TGT "2"

# Deny:
cmux send --workspace $WS --surface $TGT "3"
```

Same mechanism as `select_option` — use `cmux send`, not `send-key`.

### dismiss_dialog()

```bash
# For "/btw" dialogs or modals with "Press Space, Enter, or Escape to dismiss":
cmux send-key --workspace $WS --surface $TGT enter
```

### wait_for_state(target_state, timeout)

Poll-wait until the Target reaches the desired state:

```
POLL_BASE = 5 seconds
POLL_FAST = 2 seconds          # right after a state change
POLL_SLOW = 15 seconds         # after 60s of continuous PROCESSING
consecutive_processing = 0

while waited < timeout:
    sleep current_poll_interval
    screen = read_screen()
    state = detect_state(screen)

    if state == target_state:
        return state

    if state == PROCESSING:
        consecutive_processing += 1
        if consecutive_processing > 12:    # >60s
            current_poll_interval = POLL_SLOW
    else:
        if consecutive_processing > 0:
            current_poll_interval = POLL_FAST   # quick check after transition
        consecutive_processing = 0
        current_poll_interval = POLL_BASE
```

### Timeout values

```
TIMEOUT_STARTUP  =  30 seconds    # Claude Code boot
TIMEOUT_QUESTION = 120 seconds    # waiting for Target to ask a question
TIMEOUT_EXECUTE  = 600 seconds    # phase/command execution (up to 10 min)
TIMEOUT_IDLE     =  60 seconds    # waiting for idle prompt
```

---

## Step 4: Workflows (Layer 3)

Choose a workflow based on `$ARGUMENTS` or infer from context. Each workflow is a recipe built on the state machine and control primitives. Detailed steps are in `references/workflows.md`.

### interview

Automate responses to an interview-driven flow (requirements gathering, onboarding, etc.).

```
setup → send_prompt → loop { wait_for_asking → compose_answer → send_answer } → capture_results
```

Key behaviors:
- Handles both ASKING_TEXT and ASKING_SELECT states
- Supports multi-question batches (Target asks 4 questions at once)
- 3 answer modes: pre-defined JSON, AI-generated, spec-based
- See `references/workflows.md § interview` for full details

### execute

Send a command/prompt and handle all interactive prompts automatically.

```
setup → send_command → loop { wait_for_state → auto_handle } → capture_results
```

Key behaviors:
- Auto-approves permission prompts (`--auto-permit` default)
- Dismisses dialogs automatically
- Navigates selection UIs when they appear
- Extended timeout (TIMEOUT_EXECUTE = 600s)
- See `references/workflows.md § execute` for full details

### guide

Step-by-step controlled execution — send one instruction at a time, verify each completes.

```
setup → for each step { send_instruction → wait_for_complete → verify → next }
```

### monitor

Passive long-running observation with intervention on anomalies.

```
setup → loop { poll_screen → check_for_anomaly → intervene_or_notify }
```

---

## Step 5: Capture results

After any workflow completes (or times out):

```bash
cmux read-screen --workspace $WS --surface $TGT --lines 50      # final visible screen
```

For the **full history**, use the cmux-get diff-mode read described in Step 2.B — this returns only what was added since the last checkpoint, dramatically reducing log size on long sessions. The first capture in a session naturally returns everything (no prior checkpoint), and subsequent captures return only the delta. Use `--all` semantics (ignore checkpoint) only when you explicitly need the full scrollback.

Save to `.cmux-control/logs/<YYYY-MM-DD_HHMMSS>/`:

| File | Content |
|------|---------|
| `session.log` | Timestamped action log (states detected, inputs sent) |
| `scrollback.txt` | Full terminal scrollback |
| `final_screen.txt` | Last visible screen |
| `report.md` | Analysis: workflow summary, reliability metrics |

---

## Error recovery

**Global rule**: Each recovery action may be attempted **at most 2 times** per session.

| Situation | State | Recovery | After |
|-----------|-------|----------|-------|
| Target unresponsive >60s | ERROR | `send-key ctrl+c`, wait 5s, re-read | Send `continue` + enter, resume |
| Surface disappeared | ERROR (fatal) | `cmux tree` to verify — if gone, terminate | N/A |
| `send` returns error | ERROR | Verify surface via `cmux tree`, retry | Resume from current step |
| Claude Code crashed | ERROR | Re-send `claude` + enter, re-send prompt | Restart workflow |
| Permission prompt | ASKING_PERMIT | `answer_permission(allow=true)` | Resume immediately |
| Selection UI appeared | ASKING_SELECT | `select_option(n)` — pick best option | Resume |
| `/btw` dialog | DIALOG | `dismiss_dialog()` — send enter | Resume immediately |
| Target shows error | ERROR | Send `에러를 확인하고 스스로 해결해봐` + enter | Resume, wait for self-recovery |

### Recovery flow

```
on_error(situation):
    error_counts[situation] += 1
    if error_counts[situation] > 2:
        log("FATAL: {situation} exceeded max retries, terminating")
        goto capture_results

    execute recovery action
    log("RECOVERED: {situation} (attempt {error_counts[situation]}/2)")
```

---

## cmux CLI quick reference

Every command MUST include `--workspace $WS` explicitly.

| Action | Command |
|--------|---------|
| Ping | `cmux ping` |
| Version | `cmux --version` |
| Identify self | `cmux identify --json` |
| List workspaces | `cmux list-workspaces --json` |
| Show tree | `cmux tree --workspace $WS --json` |
| Create split | `cmux new-split right --workspace $WS` |
| Send text | `cmux send --workspace $WS --surface $TGT "text"` |
| Send key | `cmux send-key --workspace $WS --surface $TGT <key>` |
| Read screen | `cmux read-screen --workspace $WS --surface $TGT --lines N` |
| Full scrollback | `cmux read-screen --workspace $WS --surface $TGT --scrollback` |

### Supported keys for send-key

| Category | Keys | Command |
|----------|------|---------|
| Basic | `enter`, `tab`, `escape`, `backspace`, `delete`, `space` | `send-key` |
| Arrow (>= 0.63.0) | `up`, `down`, `left`, `right` | `send-key` |
| Navigation (>= 0.63.0) | `home`, `end`, `pageup`, `pagedown` | `send-key` |
| Modifiers | `ctrl+c`, `ctrl+n`, `ctrl+p`, `ctrl+enter`, `shift+tab` | `send-key` |
| Number (selection) | `1`, `2`, `3`, `4` ... `9` | **`send`** (NOT send-key) |

### Known limitations

- **Arrow keys require cmux >= 0.63.0**: On older versions, use number keys for selection and `ctrl+n`/`ctrl+p` as unreliable fallbacks.
- **Viewport limit**: `read-screen` without `--scrollback` returns ~30-50 visible lines.
- **Scrollback buffer**: Bounded by terminal settings. For very long sessions, consider periodic `read-screen --scrollback` saves.
- **Workspace ref mismatch**: `CMUX_WORKSPACE_ID` env var (UUID) ≠ ref format (`workspace:N`). Always use `cmux identify --json`.
