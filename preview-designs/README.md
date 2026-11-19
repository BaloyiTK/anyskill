# AnySkill — Approved first-screen previews

These standalone HTML files preserve the approved mobile-first welcome screen design. They are visual reference files for later implementation in the Expo app; they are not connected to production data or navigation.

## Screens

- [Logged out — Welcome / Explore](./first-screen-logged-out.html)
- [Logged in — Home / Request](./first-screen-logged-in.html)

## Locked shared design

- AnySkill header and “Find help nearby.”
- “We'll connect you with the best match first.”
- Location selector and radius options: 1, 5, 10, 20 and 50 km.
- Map with only online and available providers; skill and distance shown on each marker.
- Distinct blue current-location marker.
- Smart matching section with the agreed single sentence.
- No LIVE badge, no tabs above the map, no provider list or persistent provider detail card.

## State-specific differences

- Logged out: Create account, Sign in, Continue with Google.
- Logged in: profile picture at top right and one Request a service button.

## Implementation notes

Provider pins and distances are illustrative placeholders. The real app must render provider positions and distances from validated location data, apply the selected radius, and avoid exposing precise provider home addresses. The HTML is a design reference only.
