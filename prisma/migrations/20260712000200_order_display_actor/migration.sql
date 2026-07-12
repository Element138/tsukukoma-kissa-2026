ALTER TYPE "ActorType" ADD VALUE IF NOT EXISTS 'ORDER_DISPLAY';

DROP POLICY IF EXISTS "realtime_event_ops_select" ON "RealtimeEvent";

CREATE POLICY "realtime_event_ops_select"
  ON "RealtimeEvent"
  FOR SELECT
  TO authenticated
  USING (
    (
      "channel" = 'orders'
      AND (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') IN ('POS', 'KITCHEN', 'WAITER', 'MENU_DISPLAY', 'ORDER_DISPLAY', 'ADMIN')
    )
    OR (
      "channel" = 'menus'
      AND (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') IN ('POS', 'KITCHEN', 'MENU_DISPLAY', 'ADMIN')
    )
    OR (
      "channel" = 'counter'
      AND (current_setting('request.jwt.claims', true)::jsonb ->> 'actor_type') IN ('WAITER', 'ADMIN')
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
