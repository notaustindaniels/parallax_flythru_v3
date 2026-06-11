---
description: Create an intent-style Product Requirements Document — a problem plus a falsifiable hypothesis, with no solution baked in
argument-hint: [output-filename]
---

# Create PRD: Capture Intent, Not the Solution

## Overview

Generate a Product Requirements Document that captures **intent** — the problem you're solving and your falsifiable hypothesis about solving it — in a form a team (or an agent) can **challenge before building and judge after shipping**.

Working definition for this command:

> A PRD defines a problem, and our hypothesis about solving that problem, in a form a team can challenge before building and judge after shipping.

A modern PRD is **short, opinionated, and full of hypotheses** — not a big requirements dump. It is opinionated about the _bet_, not the _solution_. The hard part of writing one is the discovery that produces it, not the formatting.

This command produces the **intent** document only. The _how_ (tech stack, architecture, data model, API, file names, tests) belongs in a separate engineering spec — see the companion `create-spec` command. The _when_ (sequencing across features) is a roadmap, also separate.

## The Line (read before writing anything)

| Belongs in this PRD (intent / why)         | Does NOT belong here (goes in the spec)     |
| ------------------------------------------ | ------------------------------------------- |
| The problem, grounded in evidence          | The solution / features to build            |
| A falsifiable hypothesis                   | Tech stack and versions                     |
| Outcome-shaped success metrics             | Architecture, directory structure, patterns |
| A wrong condition / guardrails             | Data model, schemas, table decisions        |
| Explicit non-goals                         | API endpoints and payloads                  |
| Honest open questions                      | File names, function names                  |
| Riskiest assumptions + how to de-risk them | Implementation phases, timelines            |

If the conversation already contains solution or tech detail, **do not delete the user's thinking** — set it aside and note that it should flow into `create-spec` later.

## Output File

Write the PRD to: `$ARGUMENTS` (default: `PRD.md`)

## Step 1 (mandatory): Discovery before drafting

**Do not start writing the document immediately.** A PRD is only as good as the discovery behind it. First mine the conversation, then ask the user for what's missing. If you can't ground the problem in evidence, say so and ask — don't fill the gap with assumptions dressed up as facts.

Interview the user with questions like these (adapt; ask only what's still unknown):

- **Evidence:** What's the problem, and what's the proof it's real? Point me at data, support tickets, churn numbers, interview quotes — not "users want this."
- **Today's alternative:** How do people deal with this right now? What's the workaround or competitor they already use?
- **Switching bar:** Why would they switch to us? Is the improvement big enough that they'd actually change behavior?
- **Outcome:** What user-behavior change would count as success? Which number, by when?
- **Wrong condition:** What would tell us we're wrong, or that we've pushed too far and should roll back?
- **Non-goals:** What are we explicitly _not_ doing in this effort?
- **Unknowns:** What do we genuinely not know yet?
- **Context & stakes:** Greenfield or brownfield? Who is this for — you, or other users? What's the dominant risk if you get it wrong? How reversible/expensive is the build (this sets how much planning is warranted)?

## Output Structure

Keep it lean. Each section earns its place; cut anything that's padding.

**1. Problem**

- State the problem grounded in **evidence** — real numbers, research, direct user feedback. Not opinion, not vibes, not "the user wants this."
- Name what people **do today** to cope (workarounds, a competitor, just tolerating it), and why that matters.
- Make clear the bar isn't "does this solve the problem?" but "does it solve it enough better than today's alternative that people will switch?"

**2. Hypothesis** _(one problem may have several hypotheses)_

- Use this shape as the starting point:
  > We believe that **[some change]** will cause **[these specific users]** to do **[this specific thing]**, which results in **[an outcome we actually care about]**. We'll know we're right if we see **[some leading signal]** within **[some time frame]**, and we'll know we're wrong if **[a counter-signal appears, or a guardrail metric moves the wrong way]**.
- Name the change, the specific users, the behavior and mechanism (not just the hoped-for end state), and a time frame.

**3. Success Metrics** _(outcomes, not engagement)_

- Specific, outcome-shaped, tied to the behavior you're trying to change — something you'd be willing to be judged on.
- **Not** vanity/engagement metrics ("more DAU," "clicks on the button") and **not** completion checkboxes ("feature shipped"). Those are the anti-pattern.

**4. Wrong Condition & Guardrails** _(mandatory — the most-skipped line in any PRD)_

- The counter-signal(s) and guardrail metric(s) that would tell you the bet failed or went too far.
- The pre-agreed line that lets you roll back **quickly and cheaply** instead of slowly, expensively, and embarrassingly. A wrong condition is a contract, not pessimism.

**5. Non-Goals** _(deliberately not doing — scope control)_

- What you are consciously choosing **not** to build, to keep the work from drifting to a different problem (scope creep).
- Distinct from "later": these are out of scope on purpose, not deferred features.

**6. Open Questions**

- Honest list of what you still don't know. These are inputs to discovery — the things experiments and prototypes should answer.

**7. Riskiest Assumptions & De-risking Plan**

- A PRD is full of assumptions; assumptions are how PRDs quietly go wrong. List the riskiest ones and how you'll test them before committing to a full build.
- Classify each by which risk dominates (Marty Cagan's four):
  - **Value** — will anyone want it? → talk to users / interviews
  - **Usability** — can people figure it out? → prototype and watch
  - **Feasibility** — can we build it? → engineering spike / thin MVP _(teams over-invest here — don't)_
  - **Viability** — does it work for the business? → check with stakeholders
- Note that the next step is the **thinnest end-to-end slice** that proves the hypothesis (not "version 1 with fewer features"), and a **spike-vs-build** call: if it's easy to reverse, build it; if it's expensive/large/uncertain, spike it first.

## Discipline Checks (run before finalizing)

- **Single-solution test:** Could more than one solution plausibly satisfy your problem statement? If only one fits, it's a **solution in disguise** — rewrite it. ("Customers need a quicker way to reorder" already picked the fix; "new customers rarely place a second order" is a problem.)
- **No solution leaked in:** No features, tech stack, architecture, API, or "add an X button" instructions anywhere in the document.
- **Evidence, not opinion:** Every claim in the problem section traces to data or user input, not assumption.
- **Right _and_ wrong:** There is a separate success condition and a separate failure condition.
- **Outcome metrics:** Success is a behavior-change outcome, not engagement or "we built it."
- **Scaled to stakes:** Effort matches risk — a page for solo greenfield; much more for high-risk brownfield where customers could leave.

## Style Guidelines

- **Short and opinionated.** Opinionated about the hypothesis and what you can prove — not about the solution.
- **Shareable.** Anyone on the team or in the company should read it and understand _why this problem is worth the time_. Aim for fewer follow-up questions.
- **Concrete.** Use real numbers and real quotes wherever you have them (as in the Slack threads retrospective: channels >100 msgs/day, % of attention captured, mute rates).
- **Honest about uncertainty.** The "R" in PRD misleads — this is direction under uncertainty, not certainty. Don't pretend discovery is finished.

## Output Confirmation

After writing the PRD:

1. Confirm the file path.
2. Give a brief summary of the problem and hypothesis.
3. Flag every assumption made due to missing evidence, and any solution/tech detail you set aside for the spec.
4. Suggest the real next step: **not** "go build it," but plan the **thinnest slice** that tests the hypothesis, run it, and — only if the bet survives — write the engineering spec with `create-spec`.

## Notes

- If you can't ground the problem in evidence, **ask before generating** rather than inventing facts.
- Greenfield vs brownfield only changes which risk dominates: new → "does anyone want this?" (fake doors, interviews); mature → "will this break/annoy existing users and make them leave?" (A/B tests, existing data).
- Discovery is continuous — before, during, and after shipping. This document captures the best conclusion so far, not a final answer.
- This command is self-contained — no external references needed.
