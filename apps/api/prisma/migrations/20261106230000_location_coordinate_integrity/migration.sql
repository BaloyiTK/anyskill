ALTER TABLE "users"
  ADD CONSTRAINT "users_home_coordinates_pair"
  CHECK (("home_latitude" IS NULL) = ("home_longitude" IS NULL));

ALTER TABLE "service_requests"
  ADD CONSTRAINT "service_requests_coordinates_pair"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  ADD CONSTRAINT "service_requests_onsite_requires_coordinates"
  CHECK ("delivery_mode" <> 'ONSITE' OR ("latitude" IS NOT NULL AND "longitude" IS NOT NULL));

ALTER TABLE "provider_profiles"
  ADD CONSTRAINT "provider_profiles_live_coordinates_complete"
  CHECK (
    ("live_latitude" IS NULL AND "live_longitude" IS NULL AND "live_accuracy_m" IS NULL AND "live_location_updated_at" IS NULL)
    OR
    ("live_latitude" IS NOT NULL AND "live_longitude" IS NOT NULL AND "live_accuracy_m" IS NOT NULL AND "live_location_updated_at" IS NOT NULL AND "live_accuracy_m" <= 250)
  );
