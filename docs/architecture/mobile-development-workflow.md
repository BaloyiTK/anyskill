# Android development build and local servers

AnySkill's Android development APK is a **development client**, not a standalone preview of the app. It is installed once, then connects to the local Metro server to load the current JavaScript application. The API remains a separate local server.

## Start the local services

From the repository root, use two terminals:

1. Start the API with `pnpm dev:api`.
2. Start Metro with `pnpm dev:mobile`.

The mobile start script explicitly uses Expo's development-client mode and LAN transport. Keep Metro running while using the Android app.

## Connect the physical Android device

- Connect the phone and development computer to the same reachable network.
- The phone must be able to reach both Metro on port 8081 and the API.
- In the mobile app's local `.env`, set `EXPO_PUBLIC_API_URL` to the development computer's LAN IP and API port, for example `http://192.168.1.20:3000/api/v1`. Do not use `localhost` or the Android-emulator-only `10.0.2.2` address on a physical phone.
- Open the installed AnySkill development client and scan the QR code shown by Metro. The generated `exp+anyskill` URL scheme is registered by the `expo-dev-client` config plugin and routes the QR launch into the installed app.
- The development-client launcher is configured to open first. Without a running Metro server, it should remain at the launcher rather than silently behaving like a standalone preview app.

## Build and distribution

Use the existing EAS `development` profile for the Android development-client APK. It remains an internal-distribution build and uses the existing AnySkill EAS project and Android application ID. Rebuild and reinstall this APK when native dependencies or config plugins change; ordinary JavaScript changes are served by Metro.

The `preview` profile remains a standalone internal APK. The `production` profile remains an Android App Bundle for store distribution. Do not use preview or production when the task is to connect the phone to local Metro.

## Network troubleshooting boundary

If the app opens the development launcher but cannot load the project, check Metro reachability separately from API reachability. If the project loads but API requests fail, verify the phone's reachability to the LAN API URL and that the API is listening on a network interface reachable by the phone. Do not change the app's EAS identity, signing credentials, or dependency versions to troubleshoot a LAN routing issue.
