export type GoogleMapsWindow = Window & {
  google?: { maps?: any };
  __anyskillGoogleMapsPromise?: Promise<unknown> | undefined;
};

const GOOGLE_MAPS_SCRIPT_SELECTOR = "script[data-anyskill-google-maps]";

export function loadGoogleMaps(): Promise<any> {
  const browserWindow = window as GoogleMapsWindow;
  if (browserWindow.google?.maps) return Promise.resolve(browserWindow.google);
  if (browserWindow.__anyskillGoogleMapsPromise) return browserWindow.__anyskillGoogleMapsPromise;

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error(
      "Google Maps browser key is missing. Configure EXPO_PUBLIC_GOOGLE_MAPS_API_KEY and restart Expo.",
    ));
  }

  const script = document.querySelector<HTMLScriptElement>(GOOGLE_MAPS_SCRIPT_SELECTOR);
  const promise = new Promise<any>((resolve, reject) => {
    const existingScript = script ?? document.createElement("script");
    const cleanup = () => {
      existingScript.removeEventListener("load", onLoad);
      existingScript.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      if (browserWindow.google?.maps) resolve(browserWindow.google);
      else reject(new Error("Google Maps loaded without its Maps JavaScript API."));
    };
    const onError = () => {
      cleanup();
      reject(new Error("Google Maps could not be loaded. Check the browser key and Maps JavaScript API settings."));
    };

    if (browserWindow.google?.maps) {
      resolve(browserWindow.google);
      return;
    }

    existingScript.addEventListener("load", onLoad, { once: true });
    existingScript.addEventListener("error", onError, { once: true });

    if (!script) {
      existingScript.dataset.anyskillGoogleMaps = "true";
      existingScript.async = true;
      existingScript.defer = true;
      existingScript.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
      document.head.appendChild(existingScript);
    }
  });

  browserWindow.__anyskillGoogleMapsPromise = promise.catch((error: unknown) => {
    // Permit a later retry after a transient network or configuration failure.
    browserWindow.__anyskillGoogleMapsPromise = undefined;
    const failedScript = document.querySelector<HTMLScriptElement>(GOOGLE_MAPS_SCRIPT_SELECTOR);
    failedScript?.remove();
    throw error;
  });
  return browserWindow.__anyskillGoogleMapsPromise;
}
