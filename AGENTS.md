## Working Method

Prioritize system thinking over reactive edits.

When a task touches UI, layout, component structure, interaction behavior, or
visual hierarchy, do not treat it as a sequence of isolated pixel fixes once
multiple dependent rules are involved. Build or adjust the underlying system
first, then tune visuals.

## UI Change Rules

Before changing a UI component, identify the stable requirements:

- what must stay unchanged from previous explicit user requests
- which layout relationships must be preserved
- which dimensions, rows, columns, spacing, and states are coupled
- which responsive views are affected
- what must not be touched

If three or more visual properties affect one another, stop and define the
component geometry with variables or a clear layout model before editing.
Examples: row heights, dot sizes, line positions, text rows, gaps, card padding,
breakpoints, and state styles.

Do not repeatedly nudge values by eye when the issue is structural. Replace the
fragile structure with an explicit one.

## Preserve Prior Requests

Every new fix must preserve earlier explicit requirements unless the user says
to change them. Before editing, mentally check whether the fix could break an
older request.

If a requested change conflicts with an earlier requirement, say so before
editing.

## Visual Iteration

For visual components:

1. Define invariants.
2. Define layout geometry.
3. Apply typography and spacing hierarchy.
4. Apply color, shadow, glow, and polish.
5. Verify that no prior requirement regressed.

Do not present a late explanation that the work "should have been systemic"
after doing reactive edits. Use the systemic method first.

## Scope Discipline

Only edit files relevant to the current request. Do not touch cache logic,
metadata, unrelated widgets, data parsing, deployment files, or source order
unless the user explicitly asks or the verified root cause requires it.

Do not push unless the user explicitly asks for a push.
