---
description: Create an engineering spec — the how — from a validated PRD hypothesis, with every decision made explicitly
argument-hint: [output-filename]
---

# Create Spec: Where the Engineering Decisions Live

## Overview

Generate the **engineering spec** — the document an engineer _and an agent_ build the real thing from. This is the **engineering altitude**: the _how_. It is where your tech stack, architecture, data model, API, file and function names, security, and tests all get decided.

The spec is a first-class artifact, not throwaway pre-work — the code is a lossy projection of it. Treat it as the source.

The guiding rule: **make every decision explicit.** An agent does not add what you didn't ask for, and it will happily invent whatever you leave blank — which is how blanks turn into arbitrary choices or security vulnerabilities. The audience is now an engineer plus an agent, which raises the cost of leaving anything ambiguous.

This command produces the _how_ only. The problem and hypothesis (the _why_) live in the PRD — see the companion `create-prd` command. Don't restate intent here; reference it.

## Prerequisite: a hypothesis that survived

A spec comes **after** the PRD's hypothesis has held up — ideally after a **thinnest end-to-end slice** (a thin MVP whose only job is to prove the bet right or wrong) has produced signal. You don't go from PRD straight to building the full thing.

Before writing, confirm:

- Which PRD / validated hypothesis this spec implements (link it).
- That the hypothesis held (or that the team has decided to build anyway, and why).
- What the thin slice already taught you, if one was run.

If no PRD exists yet, pause and recommend running `create-prd` first — the spec needs a clean, unambiguous brief to work from.

## Output File

Write the spec to: `$ARGUMENTS` (default: `SPEC.md`)

## Output Structure

**1. Scope Recap**

- One or two lines: which validated hypothesis / PRD this builds. Link to it. Do not re-argue the why.

**2. Technology Stack**

- Name technologies **with specific versions**. "Let's build a React project" is not enough — e.g., _React 18 + Vite + Tailwind + TanStack Query v5_.
- Languages, frameworks, key libraries (with versions), and third-party services/integrations.

**3. Architecture & Patterns**

- High-level approach and the key design patterns.
- Directory structure.
- Naming conventions for files and functions.

**4. Data Model**

- Make the decisions, don't defer them. Schemas, tables, relationships, indexes.
- Resolve the "two valid options" calls explicitly — e.g., _hang a `parent_id` off the existing message table_ vs _stand up a separate `thread_replies` table_. Pick one and say why.

**5. Behavior Specifications**

- Pin down the ambiguous words the PRD was allowed to leave fuzzy. The PRD may say "users get notified appropriately"; the spec must define what "appropriately" **means** — e.g., does being @-mentioned in a thread auto-subscribe you to the whole thread or not? That single decision can be the line between useful and unusable.
- Cover edge cases and error states the agent would otherwise invent.

**6. API Specification** _(if applicable)_

- Endpoint definitions, request/response formats, auth requirements, example payloads.

**7. Security** _(mandatory baseline)_

- **Never commit secrets** — the single most useful line found across thousands of agent config files; state it and how secrets are handled.
- Authorization model, including **row-level security** where data is multi-tenant.
- **Webhook verification**, input validation, and any auth/authz specifics.
- Skipping these doesn't make the work disappear — it turns it into leaked payment records and addresses (cf. the Lovable data-leak audits). Make them explicit.

**8. Testing**

- What to test, **why** to test it, and the test structure (unit / integration / e2e expectations).
- Tie tests back to the behaviors and guardrails that matter.

**9. Build Sequencing**

- Phased deliverables in the order you'll build them, each with a clear "done" signal.
- _(If sequencing spans multiple features or releases, that's really a roadmap — consider keeping it in its own document and linking it.)_

**10. Spike-vs-Build Decisions**

- For any piece that's expensive, large, or carries many unknowns, note that it should be **spiked first** to prove the assumption. If a piece is easy to reverse, just build it and roll back if needed.

## Decision-Completeness Rule

Before finalizing, scan the whole spec for anything left to the agent's discretion — any "the agent will figure it out" gap — and close it. If a decision genuinely can't be made yet, name it as an explicit open engineering decision rather than letting it slip through silently.

## Quality Checks

- ✅ Versions are **pinned**, not just named
- ✅ Every ambiguous behavior word ("appropriately," "fast," "secure") is concretely defined
- ✅ Security baseline present: secrets handling, authz/RLS, webhook verification, input validation
- ✅ Data-model "two valid options" decisions are made, not deferred
- ✅ Test plan covers what **and** why
- ✅ No intent/problem material restated here — the spec is the _how_, the PRD is the _why_
- ✅ No silent gaps an agent would fill arbitrarily

## Style Guidelines

- **Precise and unambiguous.** Words like "fast" and "secure" are themselves lossy — replace them with concrete, checkable specifics.
- **Decision-dense.** This document exists to make and record decisions, not to explore.
- **Written for two readers:** an engineer and an agent. Anything a human would "just know" must be stated for the agent.

## Output Confirmation

After writing the spec:

1. Confirm the file path.
2. Summarize the key technical decisions (stack, data model, notable behavior calls).
3. List any open engineering decisions still needed, and any pieces flagged to spike before building.
4. Note that the spec should be kept in sync as implementation reveals new information.

## Notes

- Build the thinnest slice to validate first; write the full spec for the real build only after the bet survives.
- The code is what runs, but the spec is the source — keep it current rather than shredding it once the code exists.
- This command is self-contained — no external references needed.
