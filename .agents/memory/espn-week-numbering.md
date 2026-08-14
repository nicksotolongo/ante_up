---
name: ESPN week numbering mismatch
description: ESPN's preseason week numbers can differ from commissioner-entered event weeks; never trust stored nflWeek for score lookups.
---
The rule: when fetching ESPN scores for a stored event game, don't rely on the event's stored `nflWeek` — ESPN's numbering (e.g. Hall-of-Fame game counts as preseason week 1) can be off by one from what the commissioner entered. Look up scores by ESPN game ID (summary endpoint) as a fallback.

**Why:** In production (Aug 2026), an event saved as "preseason week 1" contained games ESPN listed under preseason week 2; the weekly scoreboard fetch matched nothing, so live scores and finalize grading silently returned no data.

**How to apply:** espnProvider has `getLiveScoreById(gameId)` for this. Any new code that matches DB event games to ESPN data should match by game ID first and treat the stored week as a hint only.
