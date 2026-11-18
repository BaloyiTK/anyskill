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
- Provider availability is a deliberate Online/Offline choice. Going Online requires a fresh device GPS fix with accuracy of 50 metres or better.
- The mobile app obtains foreground and background location permission only when the Provider chooses to go Online. The API saves the first GPS fix and `isAvailable=true` in the same profile update, so a Provider cannot become discoverable before a valid first fix is stored.
- The app registers one global Expo TaskManager task at startup and uses `Location.startLocationUpdatesAsync` while the Provider is Online. Native foreground `watchPositionAsync` trackers are not used for provider tracking.
- Location updates request high accuracy, a 3-second time interval and a 5-metre movement threshold. Only finite coordinates with accuracy of 50 metres or better are sent to the API.
- Android uses a location foreground service with a persistent notification while online. iOS enables the location background mode and shows the system background-location indicator.
- The API accepts live updates only for an existing, currently Available Provider profile. Going Offline clears the stored live coordinates, accuracy and GPS timestamp, and the app stops the background task.
- GPS freshness is independent from app/network presence. A network retry or heartbeat must never refresh `liveLocationUpdatedAt`; only a newly received GPS fix may do that.
- Public discovery uses the latest fix only while it is no older than 30 seconds and rounds map coordinates to approximately 100 metres. Exact provider coordinates must not be exposed through public discovery.
- Background delivery remains subject to iOS/Android scheduling, device battery policies and manufacturer restrictions. If a user force-stops/terminates the app, background updates can stop; Android does not automatically restart a terminated app for ordinary location updates. Providers must reopen AnySkill and go Online again if tracking has stopped.

## Map pin selection

- The mobile app includes a tap-to-place map pin picker built from OpenStreetMap raster tiles. It supports iOS and Android-compatible devices, including Huawei Android builds, without requiring Google Play Services.
- The picker supports zoom and coordinate display; current location can first be centered through foreground GPS, or users can enter coordinates manually.
- The tile URL template is configurable with `EXPO_PUBLIC_MAP_TILE_URL` using `{z}`, `{x}`, and `{y}` placeholders.
- The bundled OpenStreetMap public tile endpoint is a development/default option only. Before public production traffic, configure a tile provider whose usage terms, attribution, capacity and service level fit the app. Preserve visible OpenStreetMap attribution when using OSM data.

## Geographic matching

- PostgreSQL must have the PostGIS extension available before applying the location migration.
- A GiST expression index covers Provider live coordinates as geography.
- On-site matching uses PostGIS `ST_DWithin` and `ST_Distance`, not text substring service-area matching.
- The default Provider travel radius is 25 km, configurable in the Provider profile UI and stored in `provider_profiles.max_travel_distance_km` (database constraint 1–200 km).
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
2. Save and retrieve Home Location; reject out-of-range coordinates and partial coordinate pairs.
3. Tap the map pin picker at several zoom levels; verify the returned latitude/longitude follows the tapped map position and that tile attribution remains visible.
4. Deny GPS permission; confirm no location update is sent and remote mode remains usable.
5. Go Online; confirm the API stores the first GPS fix and availability atomically, and rejects missing or inaccurate fixes.
6. Attempt a live fix while unavailable; expect a conflict response.
7. Submit a fix with accuracy greater than 50 m; expect rejection.
8. Confirm stale fixes older than 30 seconds are excluded from live discovery and on-site matching.
9. Confirm Providers outside their configured travel radius are excluded and nearer Providers rank higher.
10. Confirm remote requests match without coordinates.
11. Confirm exact job coordinates are not included in the matched incoming-request feed and are visible to the selected Provider job view.

## Deployment note

Apply migrations only after confirming the target PostgreSQL service supports PostGIS and that the application database role can use the extension. Mobile location permissions and foreground-service declarations are native configuration: create a new iOS/Android development build after changing the Expo Location plugin. Background tracking must be tested on physical devices, including Android devices with aggressive battery management. The operating system may stop updates after the user terminates the app. The map pin picker uses standard React Native image rendering and does not require a Google Maps SDK. Foreground GPS and tile rendering still require physical-device testing on iOS, Android and Huawei Android. HarmonyOS NEXT requires its separately planned native ArkTS app and is not covered by the React Native build.
