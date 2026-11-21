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
- Android uses a user-initiated location foreground service with a persistent notification while online; the app requests foreground location and the Android 14+ foreground-service location permission, not the broader always-on background-location permission. iOS requests Always location permission, enables the location background mode and shows the system background-location indicator.
- The API accepts live updates only for an existing, currently Available Provider profile. Going Offline clears the stored live coordinates, accuracy and GPS timestamp, and the app stops the background task.
- GPS freshness is independent from app/network presence. A network retry or heartbeat must never refresh `liveLocationUpdatedAt`; only a newly received GPS fix may do that.
- Public discovery uses the latest fix only while it is no older than 30 seconds and rounds map coordinates to approximately 100 metres. Exact provider coordinates must not be exposed through public discovery.
- Background delivery remains subject to iOS/Android scheduling, device battery policies and manufacturer restrictions. If a user force-stops/terminates the app, background updates can stop; Android does not automatically restart a terminated app for ordinary location updates. Providers must reopen AnySkill and go Online again if tracking has stopped.

## Map rendering and pin selection

- **Android:** `react-native-maps` uses the Google Maps Android SDK. Configure `GOOGLE_MAPS_API_KEY` at build time; the key is embedded in the Android app and must be restricted to the production Android package name and signing-certificate SHA-1 fingerprints, with only the required Maps SDK for Android API enabled.
- **iOS:** `react-native-maps` uses the platform default provider, Apple MapKit. Do not configure the Google Maps iOS SDK or ship an iOS Google Maps key unless the product explicitly changes this decision.
- **Web:** map screens use the Google Maps JavaScript API. Configure `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` as a browser key restricted by allowed production HTTP referrers and the Maps JavaScript API. A browser key is public by design; API and referrer restrictions, quotas, and billing alerts are required.
- **Shared behavior:** platform-specific map views preserve the same coordinate contract and user flows. Native uses `react-native-maps`; web uses Google Maps JavaScript API. Web script loading is centralized so map screens share one in-flight load and can retry after a failed load.
- The tap-to-place picker supports zoom and coordinate display. Foreground GPS can center the map, and users can enter coordinates manually when location permission is denied.
- Map coordinates are WGS84 latitude/longitude. Validate finite values and latitude/longitude bounds at every external boundary; never treat a missing coordinate as (0, 0).
- Google Maps availability on Android devices without Google Play services, including some Huawei devices, must be validated on the actual supported device/ROM. Do not assume the Google Maps Android SDK is available on a device without GMS; define and test a product-approved fallback before claiming support for those devices.
- Maps are a presentation layer only. The API remains authoritative for geographic matching, travel radius, exact-coordinate access, and provider eligibility.

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

Apply migrations only after confirming the target PostgreSQL service supports PostGIS and that the application database role can use the extension. Mobile location permissions and foreground-service declarations are native configuration: create a new iOS/Android development build after changing the Expo Location plugin. Background tracking must be tested on physical devices, including Android devices with aggressive battery management. The operating system may stop updates after the user terminates the app. Android Google Maps requires compatible Google Play services; test any supported Huawei/non-GMS device separately and do not assume native map availability. iOS map rendering uses Apple MapKit. Web map rendering uses the restricted browser Maps JavaScript API key. Foreground GPS and map rendering still require physical-device/browser testing on every supported target. HarmonyOS NEXT requires its separately planned native ArkTS app and is not covered by the React Native build.
