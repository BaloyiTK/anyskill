# AnySkill Home Location, Live Location and Geographic Matching

## Location concepts

### Home Location
- A saved profile location: human-readable label plus latitude and longitude.
- Stored on the user's account and editable through Profile.
- Used as a reusable default when a Seeker chooses the job location.
- It is not a live tracking feed and is not automatically shared with Providers.

### Job location
- A Seeker chooses the location for each on-site request: saved Home Location or current device GPS.
- The request stores a human-readable location label and a coordinate pair.
- An on-site request must contain both latitude and longitude.
- The request feed exposes the coarse label to matched Providers. Exact coordinates are returned to the Seeker and the selected Provider's job view.

### Provider Live Location
- Device foreground location is requested only when a Provider is Available and has ONSITE or EITHER delivery enabled.
- The app sends an initial fix and watches for changes (15-second interval / 50-metre distance threshold).
- Fixes with accuracy worse than 250 metres are not submitted.
- The API accepts updates only for an existing, currently Available Provider profile with on-site delivery enabled.
- Setting the Provider unavailable clears the stored live coordinates and timestamp.
- Matching ignores fixes older than 10 minutes, missing coordinates, or accuracy worse than 250 metres.
- Current implementation is foreground-only. It does not request background/Always location permission. Location updates stop when the app leaves the foreground; the last fix ages out of matching after 10 minutes. Background tracking requires a separate permission, foreground-service configuration, battery-policy handling and platform testing before enabling it.

## Geographic matching

- PostgreSQL must have the PostGIS extension available before applying the location migration.
- A GiST expression index covers Provider live coordinates as geography.
- On-site matching uses PostGIS `ST_DWithin` and `ST_Distance`, not text substring service-area matching.
- The default Provider travel radius is 25 km, configurable in `provider_profiles.max_travel_distance_km` (database constraint 1–200 km).
- Skill category and delivery-mode compatibility remain mandatory.
- Providers need a fresh, sufficiently accurate live fix to qualify for on-site matching.
- Remote matching does not require device location.
- EITHER requests can match remote-capable Providers without GPS and on-site Providers within their configured radius.

## API

- `GET /api/v1/profile/location/home`
- `PATCH /api/v1/profile/location/home`
- `POST /api/v1/marketplace/provider-location/live`
- Job request payload accepts `latitude` and `longitude`; both must be supplied together.
- `ONSITE` requests require a coordinate pair.

## Privacy and access

- Home Location and live coordinates are not returned by the general incoming-request feed.
- Exact job coordinates are exposed in the Seeker's own request records and selected Provider job records.
- Live coordinates are only writable by the authenticated Provider who owns the profile.
- Live location is not retained as a route history; only the latest fix is stored.
- Turning availability off clears the latest fix.
- Device location permission can be denied; the app must explain the effect and offer manual Home Location entry / remote work where applicable.

## Stage verification checklist

1. Apply migration on a PostgreSQL instance with PostGIS installed; confirm extension and GiST index.
2. Save and retrieve Home Location; reject out-of-range coordinates.
3. Deny GPS permission; confirm no location update is sent and remote mode remains usable.
4. Set Provider Available with ONSITE; submit a valid live fix and confirm it is stored.
5. Attempt a live fix while unavailable; expect a conflict response.
6. Submit a fix with accuracy greater than 250 m; expect rejection.
7. Confirm stale fixes older than 10 minutes are excluded from on-site matching.
8. Confirm Providers outside their travel radius are excluded and nearer Providers rank higher.
9. Confirm remote requests match without coordinates.
10. Confirm exact job coordinates are not included in the matched incoming-request feed and are visible to the selected Provider's job view.

## Deployment note

Apply migrations only after confirming the target PostgreSQL service supports PostGIS and that the application database role can use the extension. Mobile location permissions are native configuration: a new iOS/Android development build is required after adding the Expo Location plugin.
