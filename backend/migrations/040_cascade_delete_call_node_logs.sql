-- Alter call_node_logs_flow_id_fkey to ON DELETE CASCADE
ALTER TABLE call_node_logs
  DROP CONSTRAINT IF EXISTS call_node_logs_flow_id_fkey;

ALTER TABLE call_node_logs
  ADD CONSTRAINT call_node_logs_flow_id_fkey
  FOREIGN KEY (flow_id)
  REFERENCES call_flows(id)
  ON DELETE CASCADE;
