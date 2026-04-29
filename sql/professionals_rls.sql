-- RLS policies for the professionals table.
-- Run this once in the Supabase SQL editor after enabling RLS on professionals.

CREATE POLICY "professionals_select" ON professionals
  FOR SELECT USING (
    client_id IN (
      SELECT id FROM clients WHERE id = professionals.client_id
    )
  );

CREATE POLICY "professionals_all" ON professionals
  FOR ALL USING (true);
