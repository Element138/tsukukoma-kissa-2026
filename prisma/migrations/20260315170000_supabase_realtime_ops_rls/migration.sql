-- Supabase Realtime hard switch for ops channels:
-- - publish RealtimeEvent to supabase_realtime publication
-- - enforce strict row-level access based on JWT claims

ALTER TABLE "RealtimeEvent" ENABLE ROW LEVEL SECURITY;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE "RealtimeEvent" TO authenticated;

DROP POLICY IF EXISTS "realtime_event_ops_select" ON "RealtimeEvent";

CREATE POLICY "realtime_event_ops_select"
  ON "RealtimeEvent"
  FOR SELECT
  TO authenticated
  USING (
    (
      "channel" = 'orders'
      AND (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') IN ('POS', 'KITCHEN', 'WAITER', 'MENU_DISPLAY', 'ADMIN')
    )
    OR (
      "channel" = 'menus'
      AND (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') IN ('POS', 'KITCHEN', 'MENU_DISPLAY', 'ADMIN')
    )
    OR (
      "channel" = 'waiter'
      AND (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') IN ('WAITER', 'ADMIN')
    )
    OR (
      LEFT("channel", 8) = 'kitchen:'
      AND (
        (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') = 'ADMIN'
        OR (
          (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') = 'KITCHEN'
          AND "channel" = ('kitchen:' || COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'actor_id', ''))
        )
      )
    )
  );

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public."RealtimeEvent";
  END IF;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
END $$;
