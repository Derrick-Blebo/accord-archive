-- ============================================================================
-- Accord Archive — Post Edit/Delete, T&C Acceptance, Moderation Warnings,
-- Centralized Ads & Paid Promotions, Paystack, and Audience Signals Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. PROFILES: T&C ACCEPTANCE, WARNINGS & LOCATION/TARGETING
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS terms_accepted_at timestamptz,
    ADD COLUMN IF NOT EXISTS terms_version text,
    ADD COLUMN IF NOT EXISTS warning_count integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_warning_at timestamptz,
    ADD COLUMN IF NOT EXISTS country text,
    ADD COLUMN IF NOT EXISTS region text,
    ADD COLUMN IF NOT EXISTS city text,
    ADD COLUMN IF NOT EXISTS interests text[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;

-- 2. FEED POSTS: EDIT TIMESTAMP & AUTHOR EDIT/DELETE RLS POLICIES
ALTER TABLE public.feed_posts
    ADD COLUMN IF NOT EXISTS edited_at timestamptz;

DROP POLICY IF EXISTS "Authors and admins can update feed_posts" ON public.feed_posts;
CREATE POLICY "Authors and admins can update feed_posts"
    ON public.feed_posts
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    )
    WITH CHECK (
        auth.uid() = author_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    );

DROP POLICY IF EXISTS "Authors and admins can delete feed_posts" ON public.feed_posts;
CREATE POLICY "Authors and admins can delete feed_posts"
    ON public.feed_posts
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    );

-- 3. POST REPORTS & USER VIOLATION WARNINGS
ALTER TABLE public.post_reports
    ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open',
    ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
    ADD COLUMN IF NOT EXISTS moderator_note text;

CREATE TABLE IF NOT EXISTS public.user_warnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
    post_id uuid,
    post_title text,
    post_excerpt text,
    report_id uuid,
    category text NOT NULL DEFAULT 'Community Guidelines',
    reason text NOT NULL,
    moderator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    acknowledged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_warnings_user ON public.user_warnings(user_id, created_at DESC);

ALTER TABLE public.user_warnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own warnings and admins view all" ON public.user_warnings;
CREATE POLICY "Users can view own warnings and admins view all"
    ON public.user_warnings
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = user_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    );

DROP POLICY IF EXISTS "Users can acknowledge own warnings" ON public.user_warnings;
CREATE POLICY "Users can acknowledge own warnings"
    ON public.user_warnings
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Atomic Admin RPC: Permanently delete flagged post, log violation, increment warning_count, notify author
CREATE OR REPLACE FUNCTION public.admin_takedown_flagged_post(
    target_post_id uuid,
    target_report_id uuid DEFAULT NULL,
    violation_category text DEFAULT 'Community Guidelines',
    moderator_note text DEFAULT 'Your post violated our Terms of Service and Community Guidelines.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    is_admin boolean := false;
    post_rec record;
    clean_category text := coalesce(nullif(trim(violation_category), ''), 'Community Guidelines');
    clean_note text := coalesce(nullif(trim(moderator_note), ''), 'Your post was removed for violating Accord Archive Terms of Service.');
    new_warning_count integer := 0;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    is_admin := caller_email IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com');
    IF NOT is_admin THEN
        SELECT EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.title = '__ACCORD_ROLES_CONFIG__'
              AND b.description ILIKE '%' || caller_email || '%'
        ) INTO is_admin;
    END IF;

    IF NOT is_admin THEN
        RAISE EXCEPTION 'Admin permissions required to take down flagged posts.';
    END IF;

    SELECT id, author_id, title, body
    INTO post_rec
    FROM public.feed_posts
    WHERE id = target_post_id;

    IF post_rec.id IS NULL THEN
        RAISE EXCEPTION 'Target post not found or already deleted.';
    END IF;

    -- Log warning & increment count if the post has an author account
    IF post_rec.author_id IS NOT NULL THEN
        INSERT INTO public.user_warnings (
            user_id, post_id, post_title, post_excerpt, report_id, category, reason, moderator_id
        ) VALUES (
            post_rec.author_id,
            post_rec.id,
            post_rec.title,
            left(coalesce(post_rec.body, ''), 220),
            target_report_id,
            clean_category,
            clean_note,
            auth.uid()
        );

        UPDATE public.profiles
        SET
            warning_count = coalesce(warning_count, 0) + 1,
            last_warning_at = now()
        WHERE id = post_rec.author_id
        RETURNING warning_count INTO new_warning_count;

        INSERT INTO public.notifications (user_id, type, title, message, link_url)
        VALUES (
            post_rec.author_id,
            'content_warning',
            'Post Removed — Policy Warning (#' || coalesce(new_warning_count, 1)::text || ')',
            'Your post "' || coalesce(left(post_rec.title, 60), 'Untitled') || '" was permanently removed for: ' || clean_category || '. ' || clean_note,
            'terms.html'
        );
    END IF;

    -- Mark associated reports as resolved_taken_down
    IF target_report_id IS NOT NULL THEN
        UPDATE public.post_reports
        SET status = 'resolved_taken_down', resolved_at = now(), moderator_note = clean_note
        WHERE id = target_report_id;
    END IF;

    UPDATE public.post_reports
    SET status = 'resolved_taken_down', resolved_at = now(), moderator_note = clean_note
    WHERE post_id = target_post_id AND status = 'open';

    -- Permanently delete the flagged post
    DELETE FROM public.feed_posts WHERE id = target_post_id;

    RETURN jsonb_build_object(
        'deleted_post_id', target_post_id,
        'author_id', post_rec.author_id,
        'warning_count', new_warning_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_takedown_flagged_post(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_takedown_flagged_post(uuid, uuid, text, text) TO authenticated;

-- 4. CENTRALIZED ADS & PAID PROMOTIONS
CREATE TABLE IF NOT EXISTS public.promotions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    advertiser_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    advertiser_name text,
    advertiser_email text,
    promo_type text NOT NULL CHECK (promo_type IN ('banner', 'post', 'book')),
    target_post_id uuid REFERENCES public.feed_posts(id) ON DELETE SET NULL,
    target_book_id bigint REFERENCES public.books(id) ON DELETE SET NULL,
    title text NOT NULL,
    body text,
    desktop_image_url text,
    mobile_image_url text,
    cta_text text NOT NULL DEFAULT 'Learn More',
    cta_url text,
    placements text[] NOT NULL DEFAULT ARRAY['all'],
    target_countries text[] DEFAULT '{}',
    target_regions text[] DEFAULT '{}',
    duration_days integer NOT NULL DEFAULT 7,
    budget_amount numeric(10, 2) NOT NULL DEFAULT 0,
    currency text NOT NULL DEFAULT 'USD',
    payment_provider text NOT NULL DEFAULT 'paystack',
    payment_reference text,
    payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'failed', 'waived')),
    status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'rejected', 'paused', 'expired')),
    admin_notes text,
    reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reviewed_at timestamptz,
    starts_at timestamptz,
    ends_at timestamptz,
    impressions_count integer NOT NULL DEFAULT 0,
    clicks_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promotions_status_dates ON public.promotions(status, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_promotions_advertiser ON public.promotions(advertiser_id, created_at DESC);

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view approved active promotions" ON public.promotions;
CREATE POLICY "Public can view approved active promotions"
    ON public.promotions
    FOR SELECT
    TO anon, authenticated
    USING (
        status = 'approved'
        OR auth.uid() = advertiser_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    );

DROP POLICY IF EXISTS "Authenticated users can submit promotions" ON public.promotions;
CREATE POLICY "Authenticated users can submit promotions"
    ON public.promotions
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = advertiser_id);

DROP POLICY IF EXISTS "Admins and owners can update promotions" ON public.promotions;
CREATE POLICY "Admins and owners can update promotions"
    ON public.promotions
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = advertiser_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    )
    WITH CHECK (
        auth.uid() = advertiser_id
        OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
    );

CREATE OR REPLACE FUNCTION public.record_promotion_impression(promo_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.promotions
    SET impressions_count = coalesce(impressions_count, 0) + 1
    WHERE id = promo_id AND status = 'approved';
$$;

REVOKE ALL ON FUNCTION public.record_promotion_impression(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_promotion_impression(uuid) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_promotion_click(promo_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.promotions
    SET clicks_count = coalesce(clicks_count, 0) + 1
    WHERE id = promo_id AND status = 'approved';
$$;

REVOKE ALL ON FUNCTION public.record_promotion_click(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_promotion_click(uuid) TO anon, authenticated;

-- 5. BOOK PURCHASES & AUTHOR WITHDRAWALS: PAYSTACK METADATA
ALTER TABLE public.user_purchases
    ADD COLUMN IF NOT EXISTS payment_reference text,
    ADD COLUMN IF NOT EXISTS payment_provider text DEFAULT 'paystack',
    ADD COLUMN IF NOT EXISTS currency text DEFAULT 'USD';

ALTER TABLE public.author_withdrawals
    ADD COLUMN IF NOT EXISTS bank_code text,
    ADD COLUMN IF NOT EXISTS account_number text,
    ADD COLUMN IF NOT EXISTS account_name text,
    ADD COLUMN IF NOT EXISTS paystack_recipient_code text,
    ADD COLUMN IF NOT EXISTS paystack_transfer_code text,
    ADD COLUMN IF NOT EXISTS paystack_transfer_reference text;

-- 6. USER AUDIENCE & LOCATION SIGNALS FOR ADVERTISING
CREATE TABLE IF NOT EXISTS public.user_audience_signals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    session_key text,
    country text,
    region text,
    city text,
    page text,
    device_type text,
    interests text[] DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audience_signals_country ON public.user_audience_signals(country, created_at DESC);

ALTER TABLE public.user_audience_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can insert audience signals" ON public.user_audience_signals;
CREATE POLICY "Anyone can insert audience signals"
    ON public.user_audience_signals
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view audience signals" ON public.user_audience_signals;
CREATE POLICY "Admins can view audience signals"
    ON public.user_audience_signals
    FOR SELECT
    TO authenticated
    USING (
        lower(coalesce(auth.jwt() ->> 'email', '')) IN ('accordmedia1@gmail.com', 'rickblebs1@gmail.com')
        OR auth.uid() = user_id
    );
