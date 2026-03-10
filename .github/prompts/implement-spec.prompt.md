---
description: "Implement a feature from an existing spec in .specs/. Run after /new-spec has produced a spec file."
argument-hint: "Path to spec file, e.g. .specs/score-scrolling.md"
agent: "agent"
---
You are implementing a feature from a spec. Follow these steps precisely.

## Steps

1. **Read the spec file** provided by the user (or find the relevant `.specs/*.md` file if none is specified).
2. **Review the Tasks checklist.** Identify which tasks are unchecked (`[ ]`).
3. **Implement tasks in order**, one at a time:
   - Write the code for the task.
   - After the task is complete, update the spec file to mark the task `[x]`.
   - Briefly summarize what you did before moving to the next task.
4. **Do not add scope.** Only implement what is in the spec. If you encounter a gap or ambiguity, add it to `## Open Questions` in the spec and ask the user before proceeding.
5. **When all tasks are checked**, report: "All tasks in the spec are complete."

## Stack
- Next.js 14+ (App Router), TypeScript, React
- Components in `src/components/`, routes in `src/app/`, types in `src/types/`
- Co-locate tests as `*.test.tsx` / `*.test.ts` next to the source file
