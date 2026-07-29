---
name: Hook signatures
description: Correct call signatures for generated API hooks — path params are positional, not object.
---

# Generated Hook Call Signatures

**Why:** Orval generates hooks with positional path params. Pages that pass path params as objects will silently type-error and call the wrong URL.

## Pattern

All hooks with path params take them as **positional arguments**:

```ts
// CORRECT
useGetPickEvent(leagueId, eventId, { query: { enabled: !!leagueId && !!eventId } })
useListEventGames(leagueId, eventId, { query: { enabled: ... } })
useGetMySubmission(leagueId, eventId, { query: { enabled: ... } })
useGetLiveBoard(leagueId, eventId, { query: { enabled: ..., refetchInterval: 10000 } })
useGetSeasonStandings(leagueId, { query: { enabled: !!leagueId } })
useGetLeague(leagueId, { query: { enabled: !!leagueId } })
useListMembers(leagueId, { query: { enabled: !!leagueId } })
useListPickEvents(leagueId, { query: { enabled: !!leagueId } })

// WRONG — do not pass path params as object
useGetPickEvent({ eventId }, ...)
useListEventGames({ pickEventId: eventId }, ...)
```

## Mutation variables always include leagueId

```ts
// Mutations: variables object must include ALL path params
updatePickEvent.mutate({ leagueId, eventId, data: { ... } })
lockPickEvent.mutate({ leagueId, eventId })
finalizePickEvent.mutate({ leagueId, eventId })
addEventGame.mutate({ leagueId, eventId, data: { ... } })
updateEventGame.mutate({ leagueId, eventId, eventGameId, data: { ... } })
removeEventGame.mutate({ leagueId, eventId, eventGameId })
submitPicks.mutate({ leagueId, eventId, data: { ... } })
updateSubmission.mutate({ leagueId, eventId, submissionId, data: { ... } })
```
