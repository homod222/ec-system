---
name: pnpm override source of truth
description: Where dependency overrides belong and why a seemingly small override can rewrite most of the lockfile.
---

Keep dependency overrides in the pnpm workspace configuration, alongside the existing platform-pruning overrides. Do not add a separate override block to the root package manifest.

**Why:** In this workspace, a root package override block can replace rather than merge with the workspace override set. pnpm then removes the platform-pruning resolutions and rewrites thousands of unrelated lockfile lines.

**How to apply:** Add new transitive dependency pins to the existing workspace override map, regenerate or minimally update the lockfile, and verify with a frozen install plus a small diff.