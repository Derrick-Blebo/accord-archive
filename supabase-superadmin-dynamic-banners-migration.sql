-- ============================================================================
-- Accord Archive — Superadmin Dynamic Banners & Slot Positions Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. Add dynamic slot_position column to promotions
ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS slot_position text NOT NULL DEFAULT 'dynamic';

ALTER TABLE public.promotions
    DROP CONSTRAINT IF EXISTS promotions_slot_position_check;

ALTER TABLE public.promotions
    ADD CONSTRAINT promotions_slot_position_check
    CHECK (slot_position IN ('dynamic', 'top', 'mid', 'bottom'));

-- 2. Allow admins and owners to delete promotions
DROP POLICY IF EXISTS "Admins and owners can delete promotions" ON public.promotions;
CREATE POLICY "Admins and owners can delete promotions"
    ON public.promotions
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = advertiser_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    );
