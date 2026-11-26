-- ============================================================================
-- Accord Archive — Page Banner, Profile Media & Delegated Profile Editing
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. ADD BANNER_URL TO PROFILES
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS banner_url text;

-- 2. ADD can_edit_profile TO PAGE_ADMINS PERMISSIONS
ALTER TABLE public.page_admins
    ALTER COLUMN permissions SET DEFAULT '{
        "can_post": true,
        "can_edit_delete_posts": true,
        "can_post_books": false,
        "can_promote": false,
        "can_withdraw_funds": false,
        "can_edit_profile": false
    }'::jsonb;

UPDATE public.page_admins
SET permissions = jsonb_set(
    coalesce(permissions, '{}'::jsonb),
    '{can_edit_profile}',
    to_jsonb(coalesce((permissions->>'can_edit_profile')::boolean, false)),
    true
)
WHERE permissions IS NULL OR NOT (permissions ? 'can_edit_profile');

-- 3. ALLOW DELEGATED ADMINS WITH can_edit_profile TO UPDATE THE PAGE PROFILE
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users and page profile admins can update profiles" ON public.profiles;
CREATE POLICY "Users and page profile admins can update profiles"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (
        auth.uid() = id
        OR public.has_page_permission(id, auth.uid(), 'can_edit_profile')
        OR public.is_superadmin()
    )
    WITH CHECK (
        auth.uid() = id
        OR public.has_page_permission(id, auth.uid(), 'can_edit_profile')
        OR public.is_superadmin()
    );

-- 4. STORAGE: ENSURE AUTHENTICATED USERS CAN UPLOAD AVATARS & BANNERS TO archive-files
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated users can upload profile media'
    ) THEN
        CREATE POLICY "Authenticated users can upload profile media"
            ON storage.objects
            FOR INSERT
            TO authenticated
            WITH CHECK (
                bucket_id = 'archive-files'
                AND (name LIKE 'avatars/%' OR name LIKE 'banners/%')
            );
    END IF;
END $$;
