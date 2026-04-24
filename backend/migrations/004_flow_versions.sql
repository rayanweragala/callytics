ALTER TABLE flow_versions ADD COLUMN IF NOT EXISTS message TEXT;
ALTER TABLE flow_versions ADD COLUMN IF NOT EXISTS snapshot JSONB;
ALTER TABLE flow_versions ADD COLUMN IF NOT EXISTS node_count INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS flow_versions_flow_id_version_number_idx ON flow_versions(flow_id, version_number);
