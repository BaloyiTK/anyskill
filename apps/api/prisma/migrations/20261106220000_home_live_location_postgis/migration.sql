CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE "users"
  ADD COLUMN "home_location_label" VARCHAR(500),
  ADD COLUMN "home_latitude" DOUBLE PRECISION,
  ADD COLUMN "home_longitude" DOUBLE PRECISION;

ALTER TABLE "service_requests"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION;

ALTER TABLE "provider_profiles"
  ADD COLUMN "live_latitude" DOUBLE PRECISION,
  ADD COLUMN "live_longitude" DOUBLE PRECISION,
  ADD COLUMN "live_accuracy_m" DOUBLE PRECISION,
  ADD COLUMN "live_location_updated_at" TIMESTAMP(3),
  ADD COLUMN "max_travel_distance_km" DOUBLE PRECISION NOT NULL DEFAULT 25;

ALTER TABLE "users" ADD CONSTRAINT "users_home_latitude_range" CHECK ("home_latitude" IS NULL OR ("home_latitude" BETWEEN -90 AND 90));
ALTER TABLE "users" ADD CONSTRAINT "users_home_longitude_range" CHECK ("home_longitude" IS NULL OR ("home_longitude" BETWEEN -180 AND 180));
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_latitude_range" CHECK ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90));
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_longitude_range" CHECK ("longitude" IS NULL OR ("longitude" BETWEEN -180 AND 180));
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_live_latitude_range" CHECK ("live_latitude" IS NULL OR ("live_latitude" BETWEEN -90 AND 90));
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_live_longitude_range" CHECK ("live_longitude" IS NULL OR ("live_longitude" BETWEEN -180 AND 180));
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_live_accuracy_nonnegative" CHECK ("live_accuracy_m" IS NULL OR "live_accuracy_m" >= 0);
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_max_travel_distance_range" CHECK ("max_travel_distance_km" BETWEEN 1 AND 200);

CREATE INDEX "provider_profiles_live_location_updated_at_idx" ON "provider_profiles"("live_location_updated_at");
CREATE INDEX "provider_profiles_live_geography_gist_idx" ON "provider_profiles" USING GIST ((ST_SetSRID(ST_MakePoint("live_longitude", "live_latitude"), 4326)::geography)) WHERE "live_latitude" IS NOT NULL AND "live_longitude" IS NOT NULL;
