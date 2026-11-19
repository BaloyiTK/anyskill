# Incoming service request validation

Run these checks on a physical Android device and a physical iPhone using an EAS development build. A simulator/emulator is useful for UI checks but is not sufficient to validate push delivery, lock-screen behavior, or OEM notification presentation.

## Setup
- Install the AnySkill development build and sign in as an approved Provider.
- Complete the Provider profile, enable notifications, and set availability to Available.
- Use a separate Skill Seeker account to publish a request that matches the Provider's approved skill and service area.
- Confirm the API created a `RequestMatch` with status `NOTIFIED` before testing the notification.

## Android
1. **Foreground:** Keep AnySkill open on Provider Home. Publish a matching request. Confirm the full-screen in-app request modal opens once and no duplicate heads-up banner obscures it.
2. **Another app open:** Put AnySkill in the background and open another app. Publish a matching request. Confirm the high-importance notification can appear as a heads-up alert and exposes Accept / Decline actions.
3. **Lock screen:** Lock the device and publish a matching request. Confirm the notification is visible according to the device's lock-screen privacy settings. Tap Accept or Decline and confirm Android requires device authentication before the action is submitted.
4. **App terminated:** Force-stop AnySkill, then publish a matching request. Confirm the notification opens AnySkill and the action is processed once after authentication.
5. **Permission/channel disabled:** Disable AnySkill notifications or the incoming-request channel. Confirm the app does not claim notification delivery succeeded; foreground API reconciliation should still discover pending matches when the Provider returns to AnySkill.

## iOS
1. **Foreground:** Keep AnySkill open on Provider Home. Confirm the in-app request modal opens and a duplicate foreground banner is not shown.
2. **Background:** Open another app and publish a matching request. Confirm the banner/notification displays the registered Accept / Decline actions.
3. **Lock screen:** Lock the device and publish a matching request. Confirm the notification actions are available according to iOS notification settings and require authentication.
4. **App terminated:** Terminate AnySkill, then publish a matching request. Confirm tapping a notification or action launches AnySkill and the response is submitted once.

## Server-side assertions
- Accept creates exactly one `ProviderResponse` with status `OFFERED` and moves the match to `RESPONDED`.
- Decline creates exactly one `ProviderResponse` with status `DECLINED` and moves the match out of the pending `NOTIFIED` state.
- A second response, a response from a different Provider, or an action after the request is no longer open must be rejected without creating another response.
- A dismissed request must not immediately reopen in the same app session.
- A declined Provider must not be selected again for a later matching wave for the same request.

## Platform expectations
- Android heads-up and lock-screen presentation depend on notification permission, channel settings, Do Not Disturb, OS version, and device manufacturer behavior.
- iOS controls banner and lock-screen presentation. AnySkill cannot force a third-party full-screen overlay over other apps.
- Android `USE_FULL_SCREEN_INTENT` is not enabled because AnySkill service requests are not incoming phone/video calls or alarms.
