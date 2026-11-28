-- ============================================================================
-- Accord Archive — Canonical Calling Categories & Ad Category Targeting
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. NORMALIZE EXISTING PROFILES.MINISTRY_ROLE VALUES TO CANONICAL CATEGORIES
UPDATE public.profiles
SET ministry_role = 'Church / Ministry'
WHERE ministry_role IN ('Church / Local Assembly', 'Christian Ministry / Fellowship');

UPDATE public.profiles
SET ministry_role = 'Preacher'
WHERE ministry_role IN ('Pastor / Ordained Minister', 'Evangelist / Missionary');

UPDATE public.profiles
SET ministry_role = 'Christian Creative'
WHERE ministry_role IN ('Christian Educator / Author');

CREATE INDEX IF NOT EXISTS idx_profiles_ministry_role
    ON public.profiles (ministry_role);

-- 2. ADD TARGET_CATEGORIES TO PROMOTIONS FOR CATEGORY-TARGETED ADVERTISING
ALTER TABLE public.promotions
    ADD COLUMN IF NOT EXISTS target_categories text[] DEFAULT '{}';
