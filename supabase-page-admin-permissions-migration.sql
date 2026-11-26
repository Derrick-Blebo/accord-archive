-- ============================================================================
-- Accord Archive — Granular Page Admin Permissions & Audited Withdrawals
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. GRANULAR PERMISSIONS ON PAGE_ADMINS
ALTER TABLE public.page_admins
    ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{
        "can_post": true,
        "can_edit_delete_posts": true,
        "can_post_books": false,
        "can_promote": false,
        "can_withdraw_funds": false
    }'::jsonb;

-- Backfill any existing rows that lack explicit keys
UPDATE public.page_admins
SET permissions = jsonb_build_object(
    'can_post', coalesce((permissions->>'can_post')::boolean, true),
    'can_edit_delete_posts', coalesce((permissions->>'can_edit_delete_posts')::boolean, (role = 'admin')),
    'can_post_books', coalesce((permissions->>'can_post_books')::boolean, false),
    'can_promote', coalesce((permissions->>'can_promote')::boolean, false),
    'can_withdraw_funds', coalesce((permissions->>'can_withdraw_funds')::boolean, false)
)
WHERE permissions IS NULL
   OR NOT (permissions ? 'can_post')
   OR NOT (permissions ? 'can_edit_delete_posts')
   OR NOT (permissions ? 'can_post_books')
   OR NOT (permissions ? 'can_promote')
   OR NOT (permissions ? 'can_withdraw_funds');

-- Allow verified page owners (and superadmins) to update admin powers
DROP POLICY IF EXISTS "Verified page owners can update page_admins" ON public.page_admins;
CREATE POLICY "Verified page owners can update page_admins"
    ON public.page_admins
    FOR UPDATE
    TO authenticated
    USING (
        (auth.uid() = page_id AND public.is_verified_account(auth.uid()))
        OR public.is_superadmin()
    )
    WITH CHECK (
        (auth.uid() = page_id AND public.is_verified_account(auth.uid()))
        OR public.is_superadmin()
    );

-- Helper: check if check_user_id is the verified page owner OR holds a specific permission
CREATE OR REPLACE FUNCTION public.has_page_permission(target_page_id uuid, check_user_id uuid, perm text)
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
                  AND coalesce((pa.permissions ->> perm)::boolean, false) = true
            )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.has_page_permission(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_page_permission(uuid, uuid, text) TO anon, authenticated;

-- 2. FEED POSTS RLS: RESPECT GRANULAR PERMISSIONS (can_post, can_edit_delete_posts)
DROP POLICY IF EXISTS "Anyone can insert testimonies; verified and page admins can insert posts" ON public.feed_posts;
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
                OR public.has_page_permission(author_id, auth.uid(), 'can_post')
            )
        )
    );

DROP POLICY IF EXISTS "Authors, page admins and superadmins can update feed_posts" ON public.feed_posts;
CREATE POLICY "Authors, page admins and superadmins can update feed_posts"
    ON public.feed_posts
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR public.has_page_permission(author_id, auth.uid(), 'can_edit_delete_posts')
        OR public.is_superadmin()
    )
    WITH CHECK (
        auth.uid() = author_id
        OR public.has_page_permission(author_id, auth.uid(), 'can_edit_delete_posts')
        OR public.is_superadmin()
    );

DROP POLICY IF EXISTS "Authors, page admins and superadmins can delete feed_posts" ON public.feed_posts;
CREATE POLICY "Authors, page admins and superadmins can delete feed_posts"
    ON public.feed_posts
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = author_id
        OR public.has_page_permission(author_id, auth.uid(), 'can_edit_delete_posts')
        OR public.is_superadmin()
    );

-- 3. BOOKS: ALLOW DELEGATED PAGE ADMINS WITH can_post_books TO INSERT & MANAGE BOOKS
-- Ensure RLS policies on books (if RLS is enabled) permit delegated book publishing & management.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'books' AND c.relrowsecurity = true
    ) THEN
        EXECUTE 'DROP POLICY IF EXISTS "Page admins with can_post_books can insert books" ON public.books';
        EXECUTE 'CREATE POLICY "Page admins with can_post_books can insert books"
            ON public.books
            FOR INSERT
            TO authenticated
            WITH CHECK (
                auth.uid() = author_id
                OR public.has_page_permission(author_id, auth.uid(), ''can_post_books'')
                OR public.is_superadmin()
            )';

        EXECUTE 'DROP POLICY IF EXISTS "Page admins with can_post_books can update books" ON public.books';
        EXECUTE 'CREATE POLICY "Page admins with can_post_books can update books"
            ON public.books
            FOR UPDATE
            TO authenticated
            USING (
                auth.uid() = author_id
                OR public.has_page_permission(author_id, auth.uid(), ''can_post_books'')
                OR public.is_superadmin()
            )
            WITH CHECK (
                auth.uid() = author_id
                OR public.has_page_permission(author_id, auth.uid(), ''can_post_books'')
                OR public.is_superadmin()
            )';
    END IF;
END $$;

-- 4. PROMOTIONS OWNERSHIP TRIGGER: ALLOW PAGE ADMINS WITH can_promote
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
              AND (
                  b.author_id = auth.uid()
                  OR public.has_page_permission(b.author_id, auth.uid(), 'can_promote')
              )
        ) THEN
            RAISE EXCEPTION 'You can only promote books uploaded by you or a verified page you manage.';
        END IF;
    ELSIF NEW.promo_type = 'post' THEN
        IF NEW.target_post_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.feed_posts fp
            WHERE fp.id = NEW.target_post_id
              AND (
                  fp.author_id = auth.uid()
                  OR public.has_page_permission(fp.author_id, auth.uid(), 'can_promote')
              )
        ) THEN
            RAISE EXCEPTION 'You can only promote posts made by you or a verified page you manage.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

-- 5. AUTHOR WITHDRAWALS: TRACK SPECIFIC ISSUING ACCOUNT & ENFORCE can_withdraw_funds
ALTER TABLE public.author_withdrawals
    ADD COLUMN IF NOT EXISTS requested_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS requested_by_name text,
    ADD COLUMN IF NOT EXISTS requested_by_email text,
    ADD COLUMN IF NOT EXISTS requested_by_handle text;

-- Backfill legacy withdrawals where requested_by_user_id is null
UPDATE public.author_withdrawals
SET requested_by_user_id = author_id,
    requested_by_name = coalesce(requested_by_name, author_name),
    requested_by_email = coalesce(requested_by_email, author_email)
WHERE requested_by_user_id IS NULL
  AND author_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_withdrawal_issuer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required to request a withdrawal.';
    END IF;

    -- Always record the authenticated issuer unless superadmin explicitly overrides
    IF NOT public.is_superadmin() THEN
        NEW.requested_by_user_id := auth.uid();
    ELSIF NEW.requested_by_user_id IS NULL THEN
        NEW.requested_by_user_id := auth.uid();
    END IF;

    IF NEW.author_id IS NULL THEN
        NEW.author_id := auth.uid();
    END IF;

    IF NEW.author_id <> auth.uid()
       AND NOT public.has_page_permission(NEW.author_id, auth.uid(), 'can_withdraw_funds')
       AND NOT public.is_superadmin() THEN
        RAISE EXCEPTION 'You do not have permission to withdraw funds for this verified page.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_withdrawal_issuer ON public.author_withdrawals;
CREATE TRIGGER trg_enforce_withdrawal_issuer
    BEFORE INSERT ON public.author_withdrawals
    FOR EACH ROW EXECUTE FUNCTION public.enforce_withdrawal_issuer();

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'author_withdrawals' AND c.relrowsecurity = true
    ) THEN
        EXECUTE 'DROP POLICY IF EXISTS "Authors and withdrawal admins can view withdrawals" ON public.author_withdrawals';
        EXECUTE 'CREATE POLICY "Authors and withdrawal admins can view withdrawals"
            ON public.author_withdrawals
            FOR SELECT
            TO authenticated
            USING (
                auth.uid() = author_id
                OR auth.uid() = requested_by_user_id
                OR public.has_page_permission(author_id, auth.uid(), ''can_withdraw_funds'')
                OR public.has_page_permission(author_id, auth.uid(), ''can_post_books'')
                OR public.is_superadmin()
            )';

        EXECUTE 'DROP POLICY IF EXISTS "Authors and withdrawal admins can insert withdrawals" ON public.author_withdrawals';
        EXECUTE 'CREATE POLICY "Authors and withdrawal admins can insert withdrawals"
            ON public.author_withdrawals
            FOR INSERT
            TO authenticated
            WITH CHECK (
                auth.uid() = author_id
                OR public.has_page_permission(author_id, auth.uid(), ''can_withdraw_funds'')
                OR public.is_superadmin()
            )';
    END IF;
END $$;
