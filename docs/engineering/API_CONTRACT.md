# AnySkill API Contract — Marketplace Engine v0

Base development URL: `http://localhost:4000`

The API is the security boundary between the mobile client and PostgreSQL. The current v0 routes use explicit user/professional IDs while authentication middleware is the next milestone; once auth is added, all `/me` operations derive identity from the authenticated token.

## Health
`GET /health` — verifies API and database connectivity.

## Skills
`GET /skills` — returns active skills grouped by category metadata.

## Professional operations
`PUT /professionals/:id/location`
Body: `{ latitude, longitude, areaLabel? }`

`PUT /professionals/:id/availability`
Body: `{ isOnline, acceptingJobs }`

`GET /professionals/search?skillId=<uuid>&lat=<number>&lng=<number>&radiusM=<meters>`
Returns only safe discovery fields and calculated distance. Raw professional coordinates are never returned.

## Job requests
`POST /job-requests`
Creates a request only when the target professional is verified, online, accepting work and offers the requested skill.

`GET /professionals/:id/job-requests`
Returns actionable incoming requests.

`POST /job-requests/:id/decline`
Moves an actionable request to DECLINED.

`POST /job-requests/:id/quotes`
Creates a professional quote and supersedes an earlier pending quote.

## Response envelope
Success: `{ "data": ... }`
Error: `{ "error": { "code": "...", "message"?: "...", "details"?: ... } }`

## Security milestone immediately following v0
- password hashing and login/token issuance;
- authentication middleware;
- replace client-supplied actor IDs with token identity;
- ownership/role authorization on every mutation;
- request rate limiting;
- CORS allowlist;
- structured audit events.
