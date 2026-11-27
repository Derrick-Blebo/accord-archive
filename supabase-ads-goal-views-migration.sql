-- ============================================================================
-- Accord Archive — Ad Goal (Views vs Clicks) & Optional Title/Destination URL
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

ALTER TABLE public.promotions
    ALTER COLUMN title DROP NOT NULL;

ALTER TABLE public.promotions
    ALTER COLUMN title SET DEFAULT '';

ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS ad_goal text NOT NULL DEFAULT 'clicks'
    CHECK (ad_goal IN ('views', 'clicks'));
