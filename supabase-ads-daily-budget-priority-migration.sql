-- ============================================================================
-- Accord Archive — Daily Budget Priority, Local Currency & Banner Title Removal
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. Allow optional/empty titles on banner promotions
ALTER TABLE public.promotions
    ALTER COLUMN title DROP NOT NULL;

ALTER TABLE public.promotions
    ALTER COLUMN title SET DEFAULT '';

-- 2. Add daily_budget_usd, local_currency, and local_budget_amount for priority delivery & local pricing
ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS daily_budget_usd numeric(10, 2) NOT NULL DEFAULT 1.00;

ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS local_currency text DEFAULT 'USD';

ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS local_budget_amount numeric(10, 2) DEFAULT 0;

-- Backfill daily_budget_usd for existing paid promotions
UPDATE public.promotions
SET daily_budget_usd = ROUND(
    GREATEST(1.00, COALESCE(budget_amount, 0) / GREATEST(1, COALESCE(duration_days, 1)))::numeric,
    2
)
WHERE COALESCE(budget_amount, 0) > 0;

-- Index for priority ordering of active promotions
CREATE INDEX IF NOT EXISTS idx_promotions_priority_active
    ON public.promotions (status, daily_budget_usd DESC, created_at DESC);
