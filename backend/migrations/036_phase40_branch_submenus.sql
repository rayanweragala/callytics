ALTER TABLE call_flows
  ADD COLUMN IF NOT EXISTS parent_branch_key VARCHAR(16);

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_flows_parent_node_branch_unique
  ON call_flows(parent_flow_id, parent_node_key, parent_branch_key)
  WHERE parent_flow_id IS NOT NULL
    AND parent_node_key IS NOT NULL
    AND parent_branch_key IS NOT NULL;
