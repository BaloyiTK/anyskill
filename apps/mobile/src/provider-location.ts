import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { apiRequest } from "./api";

export const PROVIDER_LOCATION_TASK = "ANYSKILL_PROVIDER_LIVE_LOCATION";
const MAX_ACCEPTED_ACCURACY_METRES = 50;
// Expo replaces EXPO_OS at bundle time. Avoid importing Platform from
// react-native here: the web resolver can otherwise target a missing
// react-native-web internal export.
const IS_WEB = process.env.EXPO_OS === "web";

type ProviderLocationTaskData = {
  locations?: Location.LocationObject[];
};

if (!IS_WEB && !TaskManager.isTaskDefined(PROVIDER_LOCATION_TASK)) {
  TaskManager.defineTask<ProviderLocationTaskData>(
    PROVIDER_LOCATION_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      // Only the newest fix matters. Never replay an old queued position as live.
      const position = data.locations[data.locations.length - 1];
      if (!position) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        accuracy == null ||
        !Number.isFinite(accuracy) ||
        accuracy > MAX_ACCEPTED_ACCURACY_METRES
      ) return;

      try {
        await apiRequest("/marketplace/provider-location/live", {
          method: "POST",
          body: JSON.stringify({
            latitude: Number(latitude.toFixed(7)),
            longitude: Number(longitude.toFixed(7)),
            accuracyM: Number(accuracy.toFixed(1)),
          }),
        }, true);
      } catch {
        // A later OS location event retries with a newer fix. Do not falsify
        // freshness by sending a heartbeat or replaying an expired coordinate.
      }
    },
  );
}

export async function getInitialProviderLocation(): Promise<Location.LocationObject> {
  if (IS_WEB) {
    throw new Error("Live Provider location is available in the AnySkill Android and iOS apps.");
  }

  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("Allow location access while using AnySkill before going online.");
  }

  // Android's user-initiated location foreground service can continue while
  // the app is backgrounded with its persistent notification. Avoid asking
  // for the broader ACCESS_BACKGROUND_LOCATION permission on Android.
  if (process.env.EXPO_OS === "ios") {
    const background = await Location.requestBackgroundPermissionsAsync();
    if (!background.granted) {
      throw new Error("Set AnySkill location access to Always so your live location can continue while the app is in the background.");
    }
  }

  const servicesEnabled = await Location.hasServicesEnabledAsync();
  if (!servicesEnabled) {
    throw new Error("Turn on your device's location services before going online.");
  }

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
    mayShowUserSettingsDialog: true,
  });
  const accuracy = position.coords.accuracy;
  if (accuracy == null || !Number.isFinite(accuracy) || accuracy > MAX_ACCEPTED_ACCURACY_METRES) {
    throw new Error("GPS accuracy is not reliable enough yet. Move to an area with a clearer GPS signal and try again.");
  }
  return position;
}

export async function startProviderLocationUpdates(): Promise<void> {
  if (IS_WEB) {
    throw new Error("Live Provider location tracking requires the AnySkill Android or iOS app.");
  }

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(PROVIDER_LOCATION_TASK);
  if (alreadyStarted) return;

  await Location.startLocationUpdatesAsync(PROVIDER_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 3000,
    distanceInterval: 5,
    deferredUpdatesInterval: 0,
    deferredUpdatesDistance: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "AnySkill — You're online",
      notificationBody: "Sharing your live location so nearby service requests can reach you.",
      notificationColor: "#176B55",
      killServiceOnDestroy: false,
    },
  });
}

export async function stopProviderLocationUpdates(): Promise<void> {
  if (IS_WEB) return;

  const started = await Location.hasStartedLocationUpdatesAsync(PROVIDER_LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(PROVIDER_LOCATION_TASK);
}
