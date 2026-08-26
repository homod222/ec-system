---
name: Rebase/merge tool can silently discard non-conflicting file content
description: continueMergeResolution (and the underlying rebase machinery) can mark a file as cleanly auto-merged while actually keeping only the earlier commit's version and dropping the later commit's diff, with no conflict markers as a warning sign.
---

## What happened

During a multi-round rebase of a payments-feature branch onto a concurrently-merged security/multi-tenancy branch, several files that showed **zero conflict markers** (financePayments.ts, paymentReconciliation.ts, a schema file, generated API client files, an OpenAPI spec, and even prior memory topic files) turned out to have silently reverted to the older commit's content, discarding real work from the newer commit. This was only caught by manually diffing `git show <newer-commit-sha> -- <path>` against the working tree file-by-file and finding hunks that should have applied but hadn't.

A second, more severe instance of the same failure mode also corrupted a file that WAS reported as auto-mergeable: a route file had many of its `safeParse(req.body)` / `safeParse(req.params)` calls silently rewritten to all reference the same wrong Zod schema (an unrelated route's schema), which only surfaced as `tsc` property-access errors on a later, unrelated typecheck run — not as a conflict.

## Why

The rebase driver's "no conflict markers" signal is not proof that the merge result matches either side's actual intended diff. It can also introduce content that neither side wrote (a bad substitution/find-replace artifact), not just drop content.

## How to apply

- Never trust "no conflict markers = correct" for a file that matters, especially config/schema/generated files and files with repetitive similar-looking call patterns (many `Foo.safeParse(req.x)` lines in one file are a specific risk: a bad rewrite can replace all of them with the same wrong identifier).
- After any `continueMergeResolution` call reports success, re-run the full verification pass again (typecheck, build, targeted greps for known-important symbols) — don't assume the pre-continue verification still holds, since the continue step itself can alter files.
- If typecheck errors appear post-rebase that reference a schema/type mismatch across many nearby lines in one file, suspect this failure mode before assuming a normal logic bug — check whether the file matches the source commit's actual diff by direct `git show` comparison, and reconstruct from the known-good commit content rather than patching symptom-by-symptom.
