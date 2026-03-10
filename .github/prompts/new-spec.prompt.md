---
description: "Create a lightweight spec for a new feature. Run this before writing any code."
argument-hint: "Describe the feature you want to build..."
agent: "agent"
---
You are helping the user write a spec before any code is written.

The user has described a feature. Your job is to produce a spec file and save it to `.specs/`.

## Steps

1. Ask the user 2–3 clarifying questions if the feature description is ambiguous — keep them short.
2. Draft the spec using the format below.
3. Show the draft to the user and ask: **"Does this look right, or anything to change?"**
4. Once confirmed, save it to `.specs/<feature-name>.md` (kebab-case filename).

## Spec Format

```markdown
# Feature: <Name>

## Requirements
- <User-facing capability, one per bullet>

## Tasks
- [ ] <Concrete implementation step>

## Open Questions
- <Any unresolved decisions — leave blank if none>
```

### Rules
- Requirements describe **what** the feature does from the user's perspective.
- Tasks describe **how** to build it — concrete, small, implementable steps.
- Keep it lightweight: 3–8 requirements, 5–15 tasks is typical.
- Do not include implementation code in the spec.
