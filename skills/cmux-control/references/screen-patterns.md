# Screen Pattern Reference

Real patterns observed from testing. Used by both cmux-control and cmux-get for state detection.

---

## Claude Code Startup Sequence

### 1. Trust folder prompt
```
Quick safety check: Is this a project you created or one you trust?
...
❯ 1. Yes, I trust this folder
  2. No, exit

Enter to confirm · Esc to cancel
```
**State**: ASKING_SELECT
**Action**: `send-key 1` then `send-key enter` (option 1 = trust)

### 2. Bypass permissions warning
```
In Bypass Permissions mode, Claude Code will not ask for your approval...
...
❯ 1. No, exit
  2. Yes, I accept

Enter to confirm · Esc to cancel
```
**State**: ASKING_SELECT
**Action**: `send-key escape` (don't use bypass mode; restart without the flag)

### 3. Welcome screen (ready)
```
│        Opus 4.6 (1M context) · Claude Max ·        │
│        ...@gmail.com's Organization                 │
│             ~/playground/yggdrasil-exp4             │
╰─────────────────────────────────────────────────────╯

─────────────────────────────────────────────────────────
❯
─────────────────────────────────────────────────────────
```
**State**: IDLE
**Action**: Ready to send prompts

---

## AskUserQuestion Patterns

### Free-text input (ASKING_TEXT)
```
프로젝트 이름은 무엇인가요?

❯
```
Single `❯` on its own line with question text above.
**Action**: `send` answer text + `send-key enter`

### Selection list (ASKING_SELECT)
```
어떤 방식을 선호하시나요?

❯ 1. Option A
  2. Option B
  3. Option C
  4. Other

Enter to select · ↑/↓ to navigate · Esc to cancel
```
Numbered options with `❯` marking current selection.

**Navigation methods** (in priority order):
1. **Number as text**: `send "3"` — jumps directly to option and auto-confirms (most reliable, tested)
2. **Arrow key** (cmux >= 0.63.0): `send-key down` / `send-key up` then `send-key enter`
3. **`ctrl+n`/`ctrl+p`**: Does NOT work in Claude Code selection widgets (tested, cursor doesn't move)
4. **`send-key <number>`**: Does NOT work — "Unknown key" error

**Action**: `send "<number>"` (use `send`, not `send-key`)

### Multi-question batch (ASKING_TEXT variant)
```
다음 질문들에 답변해주세요:
1. 이 툴의 형태는 무엇인가요?
2. 어떤 장르를 지원하나요?
3. 사용할 프레임워크가 있나요?
4. MVP 범위는?

❯
```
Multiple numbered questions followed by single `❯` prompt.
**Detection**: Lines matching `\d+\.\s+.+\?` above the `❯` prompt.
**Action**: Compose a multi-part answer addressing each question by number, then `send` + `send-key enter`.

---

## Permission Prompts (ASKING_PERMIT)

Permission prompts render as **numbered selection UIs** (same as ASKING_SELECT):

### Bash permission (tested, verified)
```
⏺ Bash(rm -r /tmp/test_permission_dir)
  ⎿  Running…

 Bash command

   rm -r /tmp/test_permission_dir
   Remove test directory recursively

 Do you want to proceed?
 ❯ 1. Yes
   2. Yes, and always allow access to test_permission_dir/ from this project
   3. No

 Esc to cancel · Tab to amend · ctrl+e to explain
```
**Action**: `send "1"` (approve once), `send "2"` (always allow), `send "3"` (deny)

### Detection
- Lines containing `Do you want to proceed?` or `Bash command` header
- Numbered options starting with `Yes` / `No`
- Footer with `Esc to cancel · Tab to amend`

**Note**: Permission prompts are NOT y/n text input. They are selection UIs handled identically to ASKING_SELECT via `cmux send "<number>"`.

---

## Dialog / Modal Patterns (DIALOG)

### /btw side-dialog
```
/btw 모호성 체크는 된거야?
...
Press Space, Enter, or Escape to dismiss
```
**Action**: `send-key enter` to dismiss

### Notification overlay
```
  ✓ Task completed successfully

  Press any key to continue
```
**Action**: `send-key enter`

---

## Processing Indicators (PROCESSING)

### Spinner characters (in last 5 lines)
```
⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏ ⠐ ⠂
```

### Status text patterns
```
✢ Gallivanting…
✢ Ruminating…
✢ Pondering…
Thinking…
```

### Tool execution
```
⏺ [tool name]
  ⎿  [tool output]
```

---

## Interview Completion Markers (COMPLETE)

### Korean
```
⏺ 인터뷰가 완료되었습니다! 정리하면:

  ┌───────────────┬─────────────────┐
  │     항목      │      답변       │
  ├───────────────┼─────────────────┤
  │ ...           │ ...             │
  └───────────────┴─────────────────┘
```

Keywords: `완료`, `정리하면`, `요약하면`, `인터뷰가 완료되었습니다`, `모든 질문이 끝났습니다`

### English
```
⏺ Interview complete! To summarize:

  ┌───────────────┬─────────────────┐
  │   Topic       │   Answer        │
  ...
```

Keywords: `Interview complete`, `To summarize`, `All questions answered`, `Here's a summary`, `That concludes`

### Universal
- Summary table with `│` borders followed by `❯` prompt
- `❯` returning after a block of summary text (not a question)

---

## Error Patterns (ERROR)

### Command not found
```
zsh: command not found: <text>
```

### Tool error
```
⎿  Invalid tool parameters
```

### Generic error
```
Error: <description>
```

### Stale screen
No change for >60 seconds, no spinner visible → likely hung.
