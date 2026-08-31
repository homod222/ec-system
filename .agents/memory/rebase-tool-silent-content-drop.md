---
name: Verify semantic correctness after rebases
description: A clean merge result is not proof that important schema, generated, or repetitive code retained the intended behavior.
---

Treat a conflict-free rebase as syntactically complete, not semantically verified. Re-run the normal validation suite and compare critical schema, generated contracts, and repetitive route code against the intended source changes.

**Why:** Automatic merge success only proves that Git produced text. It can retain the wrong competing implementation, omit additive schema or generated changes, or produce a plausible but incorrect substitution without conflict markers.

**How to apply:** After a rebase, run typecheck, builds, and targeted tests; inspect critical source diffs and search for both expected and obsolete symbols. When implementations competed, verify schema declarations, migration paths, and generated artifacts as one contract.
