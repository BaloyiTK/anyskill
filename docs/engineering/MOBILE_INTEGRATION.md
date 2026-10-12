# Mobile API integration

The React Native app now has a typed API boundary under `src/services`.

## Development configuration

Copy `.env.example` to `.env` and set `EXPO_PUBLIC_API_URL` to the API address reachable by the device/emulator.

- iOS simulator commonly reaches a host service via localhost.
- Android emulator/device networking may require a host LAN address or emulator-specific host mapping.
- Never place PostgreSQL credentials in an `EXPO_PUBLIC_*` variable.

## Session security

Access tokens are stored with Expo SecureStore. PostgreSQL credentials remain server-side only.

## Professional onboarding service flow

1. register/login
2. saveProfessionalProfile
3. getSkills + saveProfessionalSkills
4. saveProfessionalLocation
5. submitVerification
6. after approval, setAvailability(true, true)

The next UI milestone is binding the approved onboarding/dashboard screens to these services.
