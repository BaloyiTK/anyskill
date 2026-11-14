# AnySkill Project Rules

These rules supplement (and do not replace) [ENGINEERING_STANDARDS.md](ENGINEERING_STANDARDS.md). They apply until AnySkill development is declared complete.

## 1. Dependency freeze

**All existing compatible dependency versions are frozen throughout app development.**

- Do not run `pnpm update`, broad upgrades, automatic upgrade/fix commands, or equivalent commands.
- Do not change an existing dependency version without first explaining the need, compatibility, security impact, and affected modules, then receiving explicit approval.
- A required new package also requires impact review and explicit approval before installation.
- Use exact versions; do not introduce `^`, `~`, wildcards, or floating tags for application dependencies.
- Keep `pnpm-lock.yaml` synchronized and committed with dependency manifest changes.
- Use `pnpm install --frozen-lockfile` for validation and CI.
- Do not install global tools. Use an approved transient CLI invocation such as `pnpm dlx` when appropriate.
- Security advisories are investigated promptly. A security fix is not an automatic waiver: explain the risk and proposed exact-version change and obtain approval.

### Approved mobile dependency baseline

| Package | Exact version |
|---|---:|
| expo | 58.0.25 |
| expo-auth-session | 58.0.18 |
| expo-camera | 58.0.14 |
| expo-crypto | 58.0.8 |
| expo-dev-client | 58.0.20 |
| expo-file-system | 58.0.13 |
| expo-image-picker | 58.0.10 |
| expo-location | 58.0.22 |
| expo-maps | 58.0.11 |
| expo-notifications | 58.1.9 |
| expo-secure-store | 58.0.3 |
| expo-system-ui | 58.0.7 (approved addition; keep manifest and lockfile synchronized) |
| react | 19.3.0 |
| react-native | 0.88.1 |
| react-native-safe-area-context | 5.11.1 |
| @types/node | 24.19.2 |
| @types/react | 19.3.0 |
| typescript | 6.0.3 |

The exact-version rule applies to all other direct mobile dependencies too. The committed lockfile is the resolution authority for the complete workspace.

## 2. Repository and branch safety

- The active development branch is `feature/shared-job-work-timer` unless the project owner explicitly selects another branch.
- Inspect `git status` before editing. Preserve all user changes.
- Do not use destructive cleanup, reset, rebase, force-push, history rewriting, or branch deletion without explaining the impact and obtaining explicit approval.
- Keep commits focused. Do not include local environment files, credentials, signing material, production data, generated build output, or unrelated changes.
- Do not push, merge, release, or deploy without explicit authorization.
- Verify the remote branch and final diff before asking the project owner to pull.

## 3. Expo, EAS, and native configuration

The mobile application uses React Native, Expo, and TypeScript. Preserve the existing EAS project; do not create or relink to a replacement project without approval.

Protected identity:

- EAS owner: `baloyitk`
- EAS project ID: `2927d4f0-8523-4d2c-9c19-7172f7d16d26`
- Expo slug: `anyskill`
- Android application ID: `com.anyskill.mobile`

Keep the owner and project ID in the committed Expo app configuration and keep `apps/mobile/eas.json` committed. The required EAS profiles are:

| Profile | Purpose | Android output |
|---|---|---|
| development | Development client for Metro/device development | APK |
| preview | Standalone internal testing | APK |
| production | Store distribution | AAB |

Do not repeatedly initialize or relink an already linked EAS project. Inspect existing configuration before changing it.

## 4. Environment and secrets

Required mobile environment variable names:

- `EXPO_PUBLIC_API_URL`
- `EXPO_PUBLIC_EAS_PROJECT_ID`
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID`
- `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
- `GOOGLE_MAPS_API_KEY`

Rules:

- Preserve local `.env` files; never overwrite them during setup.
- Never commit `.env`, print secret values, or ask the project owner to paste secrets into chat.
- Keep local and EAS environment configuration aligned for the build environment being used. Do not upload or reset variables unnecessarily.
- Use sensitive visibility for supported secret variables, while recognizing that values embedded in a client application are extractable and must be restricted by platform, package/bundle ID, signing identity where applicable, and API scope.
- Rotate exposed credentials and update the correct environment without changing unrelated configuration.
- For physical-device LAN testing, `EXPO_PUBLIC_API_URL` must use the development computer's reachable LAN address, not `localhost`. The API must listen on an interface reachable from the device and both devices must be on the same network.
- Emulator/simulator addresses differ from physical-device LAN addresses. Do not replace a working environment-specific URL without a reason and approval.
- Never hardcode a developer's LAN IP or secret into tracked source files.

## 5. Expo Maps

- Preserve `expo-maps` at the approved version and preserve its Expo config plugin.
- Verify Expo module autolinking for the target native platform when investigating native-module errors.
- A JavaScript dependency alone does not add a missing native module to an already-built binary; produce a new native build after native dependency or plugin changes.
- Do not infer autolinking failure from a text search of generated Gradle files alone.
- Investigate native module registration, API-key configuration/restrictions, map provider responses, and tile-server errors as separate concerns.
- Do not replace the approved map architecture or provider without reviewing product, platform, licensing, attribution, security, and cost implications.

## 6. Expo native project workflow

- The project uses Expo prebuild / Continuous Native Generation unless an approved architecture decision changes this.
- Generated `apps/mobile/android/` and other generated native directories remain ignored by Git when they are reproducible from committed app configuration and plugins.
- Preserve generated native files locally when useful; do not delete them unnecessarily.
- Do not run `expo prebuild --clean` without a specific diagnosed reason and an explanation of what it will remove.
- Commit native project files only when the project deliberately adopts and documents a native-source workflow.

## 7. Development and verification

- Prefer root-cause fixes and the smallest robust change. Preserve working behavior.
- Keep domain rules and authorization authoritative on the backend. Mobile clients do not connect directly to the database.
- Test native functionality on a real device when the behavior depends on native modules, permissions, location, maps, notifications, or platform services.
- For LAN testing, verify API health and reachability from the device before blaming the mobile client.
- Run the relevant type checks, tests, migrations, builds, security checks, and performance checks required by ENGINEERING_STANDARDS.md.
- Never claim a check passed unless it was actually executed and passed. Clearly report checks that could not be run.

## 8. Collaboration workflow

- Give the project owner one terminal command at a time and wait for its output before prescribing the next command.
- Use commands compatible with the owner's Windows Git Bash environment when giving local terminal instructions.
- Keep commands focused and output manageable.
- Do not ask for information already available in the current repository or conversation.
- Do not repeat completed setup. Inspect and reuse verified configuration.
- Before a substantial change, explain its impact and obtain approval when required by these rules.
- End implementation work with a concise summary of files changed, checks run, results, and remaining work.

## 9. Rule precedence

Applicable law, platform requirements, and current official documentation take precedence. ENGINEERING_STANDARDS.md defines the engineering quality bar. These project rules add stricter AnySkill-specific constraints. Architecture documents define approved system behavior. If a conflict or ambiguity remains, stop and resolve it explicitly; do not silently choose a shortcut.
