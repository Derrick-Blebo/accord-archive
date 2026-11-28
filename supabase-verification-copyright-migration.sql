-- ============================================================================
-- Accord Archive — Verification, Revocation, & Book Copyright Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. PROFILES: MINISTRY VERIFICATION SAMPLES, SOCIALS & REVOCATION
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS ministry_role text,
    ADD COLUMN IF NOT EXISTS verification_samples jsonb DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS verification_socials jsonb DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS verification_revoked_at timestamptz,
    ADD COLUMN IF NOT EXISTS verification_revoked_reason text;

-- Update is_verified_account to respect revoked status
CREATE OR REPLACE FUNCTION public.is_verified_account(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = check_user_id
          AND (p.account_type = 'ministry_minister' OR p.upgrade_status = 'approved')
          AND p.upgrade_status IS DISTINCT FROM 'revoked'
    );
$$;

REVOKE ALL ON FUNCTION public.is_verified_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_account(uuid) TO anon, authenticated;

-- Atomic Superadmin RPC to revoke verification and hide all posts by that user
CREATE OR REPLACE FUNCTION public.revoke_ministry_verification(
    target_user_id uuid,
    reason text DEFAULT 'Revoked due to suspicious or inappropriate activity.'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    clean_reason text := coalesce(nullif(trim(reason), ''), 'Revoked due to suspicious or inappropriate activity.');
BEGIN
    IF NOT public.is_superadmin() THEN
        RAISE EXCEPTION 'Only Superadmins can revoke verification.';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'Target user ID is required.';
    END IF;

    UPDATE public.profiles
    SET
        account_type = 'normal_user',
        upgrade_status = 'revoked',
        verification_revoked_at = now(),
        verification_revoked_reason = clean_reason
    WHERE id = target_user_id;

    -- Hide all feed posts authored by this account
    UPDATE public.feed_posts
    SET is_approved = false
    WHERE author_id = target_user_id;

    -- Notify the account holder
    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        target_user_id,
        'verification_revoked',
        'Ministry Verification Revoked',
        'Your Ministry / Minister verification was revoked: ' || clean_reason,
        'verify.html'
    );
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_ministry_verification(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_ministry_verification(uuid, text) TO authenticated;

-- Also add a trigger so if a superadmin updates upgrade_status = 'revoked' directly, posts are hidden automatically
CREATE OR REPLACE FUNCTION public.on_profile_verification_revoked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.upgrade_status = 'revoked' AND OLD.upgrade_status IS DISTINCT FROM 'revoked' THEN
        IF NEW.account_type IS DISTINCT FROM 'normal_user' THEN
            UPDATE public.profiles
            SET account_type = 'normal_user'
            WHERE id = NEW.id;
        END IF;

        UPDATE public.feed_posts
        SET is_approved = false
        WHERE author_id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_verification_revoked ON public.profiles;
CREATE TRIGGER trg_profile_verification_revoked
    AFTER UPDATE OF upgrade_status ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.on_profile_verification_revoked();

-- 2. BOOKS & USER BOOK SUBMISSIONS: PUBLISHING RIGHTS & COPYRIGHT STATUS
ALTER TABLE public.books
    ADD COLUMN IF NOT EXISTS rights_basis text,
    ADD COLUMN IF NOT EXISTS rights_statement text,
    ADD COLUMN IF NOT EXISTS rights_proof_url text,
    ADD COLUMN IF NOT EXISTS rights_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS copyright_status text NOT NULL DEFAULT 'clear';

ALTER TABLE public.user_book_submissions
    ADD COLUMN IF NOT EXISTS rights_basis text,
    ADD COLUMN IF NOT EXISTS rights_statement text,
    ADD COLUMN IF NOT EXISTS rights_proof_url text;

-- 3. BOOK COPYRIGHT REPORTS & DISPUTE SETTLEMENT TABLE
CREATE TABLE IF NOT EXISTS public.book_copyright_reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    book_id bigint NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
    reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    reporter_name text NOT NULL,
    reporter_email text NOT NULL,
    claim_type text NOT NULL,
    proof_url text,
    details text NOT NULL,
    status text NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'under_review', 'disputed', 'resolved_takedown', 'resolved_dismissed')),
    author_counter_statement text,
    author_counter_proof_url text,
    author_responded_at timestamptz,
    resolution_notes text,
    resolved_by text,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_book_copyright_reports_book ON public.book_copyright_reports(book_id);
CREATE INDEX IF NOT EXISTS idx_book_copyright_reports_status ON public.book_copyright_reports(status);
CREATE INDEX IF NOT EXISTS idx_book_copyright_reports_created ON public.book_copyright_reports(created_at DESC);

-- Helper to check Library Admin or Superadmin
CREATE OR REPLACE FUNCTION public.is_library_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    roles_raw text;
    roles_json jsonb;
BEGIN
    IF caller_email = '' THEN
        RETURN false;
    END IF;

    IF public.is_superadmin() THEN
        RETURN true;
    END IF;

    SELECT b.description
      INTO roles_raw
      FROM public.books b
     WHERE b.title = '__ACCORD_ROLES_CONFIG__'
     LIMIT 1;

    IF roles_raw IS NOT NULL AND roles_raw <> '' THEN
        BEGIN
            roles_json := roles_raw::jsonb;
            IF jsonb_typeof(roles_json) = 'array' AND EXISTS (
                SELECT 1
                FROM jsonb_array_elements(roles_json) AS elem
                WHERE lower(coalesce(elem ->> 'email', '')) = caller_email
                  AND coalesce(elem ->> 'status', '') = 'active'
                  AND (
                      coalesce((elem ->> 'isMaster')::boolean, false) = true
                      OR coalesce(elem -> 'portals', '[]'::jsonb) ? 'library'
                      OR coalesce(elem -> 'portals', '[]'::jsonb) ? 'superadmin'
                  )
            ) THEN
                RETURN true;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            RETURN false;
        END;
    END IF;

    RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_library_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_library_admin() TO authenticated;

ALTER TABLE public.book_copyright_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit copyright reports" ON public.book_copyright_reports;
CREATE POLICY "Anyone can submit copyright reports"
    ON public.book_copyright_reports
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (true);

DROP POLICY IF EXISTS "Admins can view all copyright reports" ON public.book_copyright_reports;
CREATE POLICY "Admins can view all copyright reports"
    ON public.book_copyright_reports
    FOR SELECT
    TO authenticated
    USING (public.is_library_admin());

DROP POLICY IF EXISTS "Admins can update copyright reports" ON public.book_copyright_reports;
CREATE POLICY "Admins can update copyright reports"
    ON public.book_copyright_reports
    FOR UPDATE
    TO authenticated
    USING (public.is_library_admin())
    WITH CHECK (public.is_library_admin());

DROP POLICY IF EXISTS "Book authors can view reports on own books" ON public.book_copyright_reports;
CREATE POLICY "Book authors can view reports on own books"
    ON public.book_copyright_reports
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_id AND b.author_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Book authors can submit counter-notice on disputed reports" ON public.book_copyright_reports;
CREATE POLICY "Book authors can submit counter-notice on disputed reports"
    ON public.book_copyright_reports
    FOR UPDATE
    TO authenticated
    USING (
        status = 'disputed'
        AND EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_id AND b.author_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_id AND b.author_id = auth.uid()
        )
    );
