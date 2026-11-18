import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { apiRequest } from "./api";

export const PROVIDER_LOCATION_TASK = "ANYSKILL_PROVIDER_LIVE_LOCATION";
const MAX_ACCEPTED_ACCURACY_METRES = 50;

type ProviderLocationTaskData = {
  locations?: Location.LocationObject[];
};

if (!TaskManager.isTaskDefined(PROVIDER_LOCATION_TASK)) {
  TaskManager.defineTask<ProviderLocationTaskData>(
    PROVIDER_LOCATION_TASK,
    async ({ data, error }) => {
      if (error || !data?.locations?.length) return;
      // Only the newest fix matters. Never replay an old queued position as live.
      const position = data.locations[data.locations.length - 1];
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
          body: JSON.stringify({ latitude, longitude, accuracyM: accuracy }),
        }, true);
      } catch {
        // A later OS location event retries with a newer fix. Do not falsify
        // freshness by sending a heartbeat or replaying an expired coordinate.
      }
    },
  );
}

export async function getInitialProviderLocation(): Promise<Location.LocationObject> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    throw new Error("Allow location access while using AnySkill before going online.");
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (!background.granted) {
    throw new Error("Allow background location for AnySkill so your live location can continue while the app is in the background.");
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
  const started = await Location.hasStartedLocationUpdatesAsync(PROVIDER_LOCATION_TASK);
  if (started) await Location.stopLocationUpdatesAsync(PROVIDER_LOCATION_TASK);
}
