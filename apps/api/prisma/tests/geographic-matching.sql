-- Exercises the same PostGIS geography distance/freshness/radius predicates
-- used by MarketplaceService.rankedProviders.
DO $$
DECLARE
  eligible_count INTEGER;
BEGIN
  WITH provider_fixtures(name, latitude, longitude, accuracy_m, updated_at, radius_km) AS (
    VALUES
      ('nearby', -26.2100::double precision, 28.0500::double precision, 18.0::double precision, NOW(), 25.0::double precision),
      ('outside-radius', -26.5000::double precision, 28.0500::double precision, 20.0::double precision, NOW(), 25.0::double precision),
      ('stale', -26.2110::double precision, 28.0510::double precision, 15.0::double precision, NOW() - INTERVAL '11 minutes', 25.0::double precision),
      ('inaccurate', -26.2120::double precision, 28.0520::double precision, 300.0::double precision, NOW(), 25.0::double precision)
  )
  SELECT COUNT(*) INTO eligible_count
  FROM provider_fixtures p
  WHERE p.accuracy_m <= 250
    AND p.updated_at >= NOW() - INTERVAL '10 minutes'
    AND ST_DWithin(
      ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(28.0473, -26.2041), 4326)::geography,
      200000.0
    )
    AND ST_Distance(
      ST_SetSRID(ST_MakePoint(p.longitude, p.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(28.0473, -26.2041), 4326)::geography
    ) <= p.radius_km * 1000.0;

  IF eligible_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one fresh, accurate Provider inside radius; got %', eligible_count;
  END IF;

  IF ST_Distance(
    ST_SetSRID(ST_MakePoint(28.0500, -26.2100), 4326)::geography,
    ST_SetSRID(ST_MakePoint(28.0473, -26.2041), 4326)::geography
  ) > 1000.0 THEN
    RAISE EXCEPTION 'Nearby fixture distance unexpectedly exceeds 1 km';
  END IF;
END $$;

SELECT 'PostGIS geographic matching assertions passed' AS result;
