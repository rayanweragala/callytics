CREATE TABLE IF NOT EXISTS call_flows (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'draft',
  entry_type VARCHAR(50) DEFAULT 'default',
  entry_value VARCHAR(255),
  current_version_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_versions (
  id SERIAL PRIMARY KEY,
  flow_id INTEGER REFERENCES call_flows(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  is_published BOOLEAN DEFAULT false,
  published_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_nodes (
  id SERIAL PRIMARY KEY,
  flow_version_id INTEGER REFERENCES flow_versions(id) ON DELETE CASCADE,
  node_key VARCHAR(255) NOT NULL,
  type VARCHAR(100) NOT NULL,
  label VARCHAR(255),
  position_x FLOAT DEFAULT 0,
  position_y FLOAT DEFAULT 0,
  config_json JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flow_edges (
  id SERIAL PRIMARY KEY,
  flow_version_id INTEGER REFERENCES flow_versions(id) ON DELETE CASCADE,
  source_node_key VARCHAR(255) NOT NULL,
  target_node_key VARCHAR(255) NOT NULL,
  branch_key VARCHAR(100) DEFAULT 'default',
  condition VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);
