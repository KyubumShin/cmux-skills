# Workflow Reference

Detailed implementation for each cmux-control workflow. Each workflow builds on the state machine and control primitives defined in skill.md.

---

## Table of Contents

1. [Interview Workflow](#interview)
2. [Execute Workflow](#execute)
3. [Guide Workflow](#guide)
4. [Monitor Workflow](#monitor)

---

## Interview

Automate responses to an interview-driven flow. The Harness detects questions from the Target and responds with pre-defined, AI-generated, or spec-based answers.

### Flow

```
1. Setup (Step 1 from skill.md)
2. Send interview prompt
3. Poll-Respond loop
4. Capture results (Step 5 from skill.md)
```

### Sending the prompt

Compose from `prompt:` argument or default template. Unless `--no-free-text` is set, include the free-text constraint:

```
다음 인터뷰를 진행해줘. [TASK_DESCRIPTION].
중요: 질문할 때 반드시 선택지 없이 자유 텍스트 입력으로만 물어봐. AskUserQuestion을 사용하되 선택지(options)를 제공하지 마.
```

**When `--no-free-text` is set**: omit the constraint. The skill will handle ASKING_SELECT states via `select_option()` instead.

### Poll-Respond loop

```
MAX_ROUNDS = 20

for round in 1..MAX_ROUNDS:
    state = wait_for_state(
        target_state = [ASKING_TEXT, ASKING_SELECT, COMPLETE, ERROR],
        timeout = TIMEOUT_QUESTION
    )

    match state:
        ASKING_TEXT:
            question = extract_question(screen)
            answer = compose_answer(question)
            send_text(answer)
            log(round, question, answer)

        ASKING_SELECT:
            options = extract_options(screen)
            best = choose_best_option(options)
            select_option(best.number)
            log(round, options, best)

        ASKING_PERMIT:
            answer_permission(allow=true)
            continue  # don't count as a round

        DIALOG:
            dismiss_dialog()
            continue  # don't count as a round

        COMPLETE:
            break

        ERROR:
            attempt_recovery()
            continue

    # After answering, wait briefly for Target to process
    wait_for_state(PROCESSING, timeout=10)  # may not see PROCESSING if fast
```

### Multi-question detection

The Target may ask multiple questions at once (common pattern: 4 numbered questions in one round).

**Detection**: Screen contains multiple lines matching `\d+\.\s+.+[\?？]` above the `❯` prompt.

**Answering**:
- **AI-generated mode**: Compose a single response addressing all questions by number:
  ```
  1. [answer to Q1] 2. [answer to Q2] 3. [answer to Q3] 4. [answer to Q4]
  ```
- **Pre-defined answers mode**: Match each sub-question's keywords independently. Compose combined answer.
- **Spec-based mode**: Evaluate each sub-question against the spec. For any sub-question not covered, use AskUserQuestion to ask the Harness user (see below).

### Answer strategies

#### 1. Pre-defined answers (`answers:/path/to/file.json`)

```json
[
  {"keywords": ["프로젝트", "이름"], "answer": "DataForge"},
  {"keywords": ["기술", "스택"], "answer": "React + Vite + TypeScript"},
  {"keywords": ["MVP", "범위"], "answer": "Phase 0 + Phase 3"}
]
```

Match questions by keyword overlap. If no match, use answers in definition order. Fall through to AI-generated for unmatched questions.

#### 2. AI-generated (default)

The Harness Claude reads the question from the screen and generates a contextual answer. Simple and effective — the Harness is already an AI that can compose reasonable responses.

When generating answers, maintain consistency with previous answers in the session. Refer to the session log to avoid contradictions.

#### 3. Spec-based (`spec:/path/to/spec.md`)

Read the spec at session start. Act as a virtual user who knows this spec.

- Answer using only information in the spec document
- For questions **not covered by the spec**, use `AskUserQuestion` to ask the Harness user:
  - **"모르겠음"** → respond with `아직 정하지 않았어요`
  - **"AI 생성"** → generate reasonable answer consistent with spec context
- Each out-of-spec question is escalated independently

---

## Execute

Send a command to the Target and handle all interactive prompts automatically until completion.

### Flow

```
1. Setup (Step 1 from skill.md)
2. Send command prompt
3. Auto-handle loop (permissions, dialogs, selections)
4. Capture results (Step 5 from skill.md)
```

### Sending the command

```bash
send_text("<command or prompt from arguments>")
```

No free-text constraint needed — execute workflow handles all UI states natively.

### Auto-handle loop

```
while true:
    state = wait_for_state(
        target_state = [ASKING_TEXT, ASKING_SELECT, ASKING_PERMIT, DIALOG, COMPLETE, ERROR, IDLE],
        timeout = TIMEOUT_EXECUTE
    )

    match state:
        ASKING_PERMIT:
            if --auto-permit (default):
                answer_permission(allow=true)
                log("AUTO-PERMIT: allowed")
            else:
                # Escalate to Harness user
                tool_name = extract_tool_from_permission(screen)
                decision = AskUserQuestion("Target이 {tool_name} 허용을 요청합니다. 승인할까요?")
                answer_permission(allow = decision == "yes")

        ASKING_SELECT:
            options = extract_options(screen)
            # For execute workflow, use heuristics:
            # - "Yes" / "확인" / "Continue" → prefer
            # - "No" / "취소" / "Cancel" → avoid unless explicitly needed
            best = choose_affirmative_option(options)
            select_option(best.number)

        ASKING_TEXT:
            # Unexpected free-text question during execution
            # Escalate to Harness user
            question = extract_question(screen)
            answer = AskUserQuestion("Target이 질문합니다: {question}")
            send_text(answer)

        DIALOG:
            dismiss_dialog()

        COMPLETE:
            break

        IDLE:
            # Target returned to prompt — command finished
            break

        ERROR:
            attempt_recovery()

        TIMEOUT:
            log("Execution timed out after {TIMEOUT_EXECUTE}s")
            break
```

### Permission handling modes

| Mode | Behavior |
|------|----------|
| `--auto-permit` (default) | Always approve — sends `y` + enter |
| `--ask-permit` | Escalate each permission to Harness user via AskUserQuestion |
| `--deny-permit` | Always deny — sends `n` + enter (for security testing) |

---

## Guide

Send step-by-step instructions to the Target, waiting for each to complete before sending the next. Useful for complex multi-step tasks that need human-in-the-loop verification.

### Flow

```
1. Setup
2. For each step:
   a. Send instruction
   b. Wait for COMPLETE or IDLE
   c. Read output, verify success
   d. Report to Harness user
   e. On user confirmation → next step
3. Capture final results
```

### Step definition

Steps come from the Harness user interactively or from a steps file:

```json
[
  {"instruction": "프로젝트 스캐폴딩을 생성해줘", "success_check": "scaffold"},
  {"instruction": "테스트를 실행해줘", "success_check": "pass"}
]
```

After each step, read the Target's output and check for `success_check` keyword. Report status to the Harness user before proceeding.

---

## Monitor

Passively observe a running Target session. Intervene only on anomalies (errors, unexpected prompts, stalls).

### Flow

```
1. Setup (attach to existing surface — no split creation needed)
2. Poll loop:
   a. Read screen
   b. Detect state
   c. If anomaly → intervene or notify Harness user
   d. If COMPLETE → report
3. Generate periodic status reports
```

### Anomaly detection

| Anomaly | Detection | Intervention |
|---------|-----------|--------------|
| Error state | ERROR patterns on screen | Notify Harness user, optionally send recovery command |
| Stuck processing | PROCESSING for >TIMEOUT_EXECUTE | `send-key ctrl+c`, notify |
| Unexpected prompt | ASKING_TEXT or ASKING_SELECT while expected PROCESSING | Notify Harness user for decision |
| Permission prompt | ASKING_PERMIT | Auto-approve if `--auto-permit`, else notify |
| Dialog | DIALOG | Auto-dismiss |

### Status reporting

Every 5 minutes (or configurable interval), log:
- Current state
- Last significant screen content change
- Time elapsed since start
- Any interventions performed
