const fs = require("node:fs");
const path = require("node:path");

function readEnvValue(filePath, name) {
  if (!fs.existsSync(filePath)) return undefined;
  const line = fs.readFileSync(filePath, "utf8").split(/\r?\n/).find((entry) =>
    new RegExp("^\\s*(?:export\\s+)?" + name + "\\s*=").test(entry)
  );
  if (!line) return undefined;
  const value = line.slice(line.indexOf("=") + 1).trim();
  return value.replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
}

module.exports = ({ config }) => {
  const projectRoot = __dirname;
  const key = process.env.GOOGLE_MAPS_API_KEY
    || readEnvValue(path.resolve(projectRoot, "../../.env"), "GOOGLE_MAPS_API_KEY")
    || readEnvValue(path.resolve(projectRoot, ".env"), "GOOGLE_MAPS_API_KEY");

  // For local Android builds, place google-services.json in apps/mobile.
  // EAS can supply the file path through a GOOGLE_SERVICES_JSON file variable.
  const googleServicesPath = process.env.GOOGLE_SERVICES_JSON
    ? path.resolve(projectRoot, process.env.GOOGLE_SERVICES_JSON)
    : path.resolve(projectRoot, "google-services.json");
  const hasGoogleServices = fs.existsSync(googleServicesPath);

  if (!key) {
    console.warn("[AnySkill] GOOGLE_MAPS_API_KEY is missing; Google Maps may show a blank map.");
  }
  if (!hasGoogleServices) {
    console.warn("[AnySkill] Firebase google-services.json is missing. Android push notifications will not initialize.");
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(hasGoogleServices ? { googleServicesFile: googleServicesPath } : {}),
      config: {
        ...config.android?.config,
        googleMaps: {
          ...config.android?.config?.googleMaps,
          ...(key ? { apiKey: key } : {}),
        },
      },
    },
  };
};
