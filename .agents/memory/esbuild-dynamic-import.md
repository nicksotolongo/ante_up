---
name: esbuild dynamic import quirk
description: Dynamic imports in espnProvider's overlayOdds function break in the esbuild bundle — use static imports instead.
---

## Rule
Never use dynamic `import()` inside any module bundled by esbuild for the API server. The bundled output inlines all modules; a dynamic `import("./oddsProvider")` at runtime does not resolve correctly and named exports come back as `undefined`, silently breaking the feature.

**Why:** The API server uses esbuild to bundle to `dist/index.mjs`. Dynamic imports from relative paths work in source (tsx) but fail after bundling because esbuild collapses the module tree.

**How to apply:** Always use top-level static imports. If a circular dependency is a concern, restructure the modules rather than reaching for dynamic import.
