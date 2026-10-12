-- Run this against the AnySkill PostgreSQL server to inspect PostGIS availability.
SELECT version();
SELECT name, default_version, installed_version
FROM pg_available_extensions
WHERE name = 'postgis';

-- If installed_version is populated:
-- SELECT PostGIS_Full_Version();
