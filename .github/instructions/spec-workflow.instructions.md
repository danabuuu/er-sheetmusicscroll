---
description: "Use when implementing any feature, writing code, or making changes. Enforces spec-first workflow: always check for an existing spec in .specs/ before writing code."
applyTo: ".specs/**"
---
# Spec-First Workflow

This project follows a spec-first approach. **No code is written before a spec exists.**

## Rules

1. **Before implementing anything**, check if a spec file exists in `.specs/` for the feature.
   - If no spec exists, stop and ask the user to run `/new-spec` first.
   - If a spec exists, read it fully before writing any code.

2. **Follow the spec tasks in order.** Work through the `## Tasks` checklist top-to-bottom. After completing each task, mark it `[x]` in the spec file.

3. **Do not add scope.** Only implement what is listed in the spec's requirements and tasks. If you think something is missing, note it in the spec under `## Open Questions` rather than implementing it unilaterally.

4. **One spec per feature.** Specs live in `.specs/<feature-name>.md`. Use kebab-case filenames.

## Spec Format

```markdown
# Feature: <Name>

## Requirements
- Requirement written as a user-facing capability

## Tasks
- [ ] Task 1
- [ ] Task 2

## Open Questions
- Any unresolved decisions
```

## Stack Conventions (Next.js / TypeScript)
- Components: `src/components/<FeatureName>/`
- Pages / routes: `src/app/<route>/page.tsx`
- Shared types: `src/types/`
- Tests: co-located `*.test.ts` or `*.test.tsx` alongside the source file
