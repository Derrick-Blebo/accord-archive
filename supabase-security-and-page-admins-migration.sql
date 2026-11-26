-- ============================================================================
-- Accord Archive — Security Hardening, Promotion Ownership & Verified Page Admins
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. VERIFIED PAGE ADMINS TABLE & HELPERS
CREATE TABLE IF NOT EXISTS public.page_admins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    page_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    admin_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    added_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    role text NOT NULL DEFAULT 'admin' CHECK (role IN ('editor', 'admin')),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (page_id, admin_user_id),
    CHECK (page_id <> admin_user_id)
);

CREATE INDEX IF NOT EXISTS idx_page_admins_page_id ON public.page_admins(page_id);
CREATE INDEX IF NOT EXISTS idx_page_admins_admin_user_id ON public.page_admins(admin_user_id);

ALTER TABLE public.page_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Page owners and assigned admins can view page_admins" ON public.page_admins;
CREATE POLICY "Page owners and assigned admins can view page_admins"
    ON public.page_admins
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = page_id
        OR auth.uid() = admin_user_id
        OR public.is_superadmin()
    );

DROP POLICY IF EXISTS "Verified page owners can add page_admins" ON public.page_admins;
CREATE POLICY "Verified page owners can add page_admins"
    ON public.page_admins
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = page_id
        AND public.is_verified_account(auth.uid())
    );

DROP POLICY IF EXISTS "Page owners or admins can remove page_admins" ON public.page_admins;
CREATE POLICY "Page owners or admins can remove page_admins"
    ON public.page_admins
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = page_id
        OR auth.uid() = admin_user_id
        OR public.is_superadmin()
    );

CREATE OR REPLACE FUNCTION public.is_page_admin(target_page_id uuid, check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT (
        target_page_id IS NOT NULL
        AND check_user_id IS NOT NULL
        AND public.is_verified_account(target_page_id)
        AND (
            target_page_id = check_user_id
            OR EXISTS (
                SELECT 1
                FROM public.page_admins pa
                WHERE pa.page_id = target_page_id
                  AND pa.admin_user_id = check_user_id
            )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.is_page_admin(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_page_admin(uuid, uuid) TO anon, authenticated;

-- 2. FEED POSTS RLS: ALLOW VERIFIED PAGE ADMINS TO POST/MANAGE ON BEHALF OF THE PAGE
DROP POLICY IF EXISTS "Anyone can insert testimonies; verified can insert posts" ON public.feed_posts;
CREATE POLICY "Anyone can insert testimonies; verified and page admins can insert posts"
    ON public.feed_posts
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        post_type = 'testimony'
        OR (
            auth.uid() IS NOT NULL
            AND author_id IS NOT NULL
            AND (
                (author_id = auth.uid() AND public.is_verified_account(auth.uid()))
                OR public.is_page_admin(author_id, auth.uid())
            )
        )
    );

DROP POLICY IF EXISTS "Authors and admins can update feed_posts" ON public.feed_posts;
CREATE POLICY "Authors, page admins and superadmins can update feed_posts"
    ON public.feed_posts
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR public.is_page_admin(author_id, auth.uid())
        OR public.is_superadmin()
    )
    WITH CHECK (
        auth.uid() = author_id
        OR public.is_page_admin(author_id, auth.uid())
        OR public.is_superadmin()
    );

DROP POLICY IF EXISTS "Authors and admins can delete feed_posts" ON public.feed_posts;
CREATE POLICY "Authors, page admins and superadmins can delete feed_posts"
    ON public.feed_posts
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR public.is_page_admin(author_id, auth.uid())
        OR public.is_superadmin()
    );

-- 3. PROMOTIONS OWNERSHIP ENFORCEMENT (ONLY OWN BOOKS AND OWN POSTS)
CREATE OR REPLACE FUNCTION public.enforce_promotion_ownership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required to create promotions.';
    END IF;

    IF NEW.advertiser_id IS DISTINCT FROM auth.uid() AND NOT public.is_superadmin() THEN
        RAISE EXCEPTION 'Advertiser ID must match the authenticated user.';
    END IF;

    IF NEW.promo_type = 'book' THEN
        IF NEW.target_book_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = NEW.target_book_id
              AND b.author_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'You can only promote books that you uploaded yourself.';
        END IF;
    ELSIF NEW.promo_type = 'post' THEN
        IF NEW.target_post_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.feed_posts fp
            WHERE fp.id = NEW.target_post_id
              AND fp.author_id = auth.uid()
        ) THEN
            RAISE EXCEPTION 'You can only promote posts that you made yourself.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_promotion_ownership ON public.promotions;
CREATE TRIGGER trg_enforce_promotion_ownership
    BEFORE INSERT ON public.promotions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_promotion_ownership();

-- 4. PREVENT PROFILE PRIVILEGE ESCALATION BY NON-SUPERADMINS
CREATE OR REPLACE FUNCTION public.prevent_profile_privilege_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Superadmins and service-role / postgres calls (auth.uid() IS NULL) may update any field
    IF auth.uid() IS NULL OR public.is_superadmin() THEN
        RETURN NEW;
    END IF;

    -- Prevent normal users from self-approving verification, changing account_type, or clearing warnings
    IF NEW.account_type IS DISTINCT FROM OLD.account_type THEN
        RAISE EXCEPTION 'Only Superadmins can change account_type.';
    END IF;

    IF NEW.upgrade_status IS DISTINCT FROM OLD.upgrade_status THEN
        -- Users may only submit/resubmit a pending verification request
        IF NOT (
            NEW.upgrade_status = 'pending'
            AND coalesce(OLD.upgrade_status, 'none') IN ('none', 'rejected', 'pending')
        ) THEN
            RAISE EXCEPTION 'Only Superadmins can change upgrade_status.';
        END IF;
    END IF;

    IF NEW.warning_count IS DISTINCT FROM OLD.warning_count
       OR NEW.verification_revoked_at IS DISTINCT FROM OLD.verification_revoked_at
       OR NEW.verification_revoked_reason IS DISTINCT FROM OLD.verification_revoked_reason THEN
        RAISE EXCEPTION 'Restricted moderation fields cannot be modified.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_privilege_escalation ON public.profiles;
CREATE TRIGGER trg_prevent_profile_privilege_escalation
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privilege_escalation();
