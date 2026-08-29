---
name: esbuild breaks import.meta.url / __dirname-relative file loading
description: A package that resolves files (e.g. SQL migrations) relative to its own module directory at runtime will silently fail to find them once esbuild bundles it into a single output file.
---

## The problem
Some npm packages resolve auxiliary files (migration SQL, worker scripts, templates) relative to their own package directory at runtime, typically via `import.meta.url` or `__dirname`. When esbuild bundles that package's code into a single output file (e.g. an API server's `dist/index.mjs`), the bundled module's location no longer matches the original package directory, so the relative resolution silently points to the wrong place. This tends to fail quietly (e.g. a migration runner that runs but creates zero tables) rather than throwing, which makes it easy to miss.

**Why:** discovered with `stripe-replit-sync`'s migration runner — `runMigrations` appeared to succeed but the `stripe.*` schema never got created, because its SQL files were never found post-bundle.

**How to apply:** when integrating a package that touches the filesystem for its own assets (migrations, templates, fonts, worker threads — pino transports and PDF/font toolchains have the same issue), add it to the bundler's `external` list rather than letting it get inlined. A missing transitive module only at runtime after a successful build is another strong signal that the package must stay external. For PDFKit Arabic output, use a deployed TTF asset; fontkit can parse WOFF2 yet fail during Arabic glyph subsetting with a `DataView` bounds error. This is a generic bundler-interaction lesson, not specific to any one package.
