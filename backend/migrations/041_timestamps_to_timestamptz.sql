-- Convert every "timestamp without time zone" column in the public schema to timestamptz.
--
-- Writers insert UTC instants (NOW() or ::timestamptz casts). Into a naive column those are
-- stored as wall-clock values in the database server's TimeZone setting, and node-postgres then
-- parses them as process-local time, which shifts values by the UTC offset whenever the
-- application TZ differs from the database TimeZone. timestamptz stores the instant itself.
--
-- Existing values are interpreted in the database's current TimeZone setting, because that is
-- the zone NOW() and the casts used when they were written.
--
-- Idempotent: columns that are already timestamptz are not selected.
-- Views are not supported: Postgres refuses to alter a column a view depends on. None are
-- created by these migrations; drop and recreate custom views around this migration.
--
-- The migration runner splits statements on a semicolon at the end of a line, so no line of
-- this DO block may end with one.
DO $$
DECLARE col RECORD; BEGIN
  FOR col IN
    SELECT c.table_name, c.column_name
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND t.table_type = 'BASE TABLE'
      AND c.data_type = 'timestamp without time zone'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE current_setting(''TimeZone'')',
      col.table_name, col.column_name, col.column_name
    ); END LOOP; END
$$
