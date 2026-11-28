-- ============================================================================
-- Accord Archive — Verified Account Blog Articles & Spotlight Promotion
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- Allows verified accounts (and their delegated page admins) to submit blog
-- articles categorised under Artistes, Ministries, Pastors, or Events.
-- Admins verify/approve articles in Superadmin before they appear on the blog
-- and public profile Blog tab, and can promote them to Artist or Ministry Spotlight.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.blog_articles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    author_name text NOT NULL,
    author_handle text,
    category text NOT NULL CHECK (category IN ('artiste', 'ministry', 'pastor', 'event')),
    title text NOT NULL,
    genre text DEFAULT 'Gospel',
    article text NOT NULL,
    image_url text,
    link text,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    spotlight_target text NOT NULL DEFAULT 'none' CHECK (spotlight_target IN ('none', 'artist', 'ministry')),
    featured boolean NOT NULL DEFAULT false,
    reviewed_by text,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_blog_articles_status_created
    ON public.blog_articles (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_blog_articles_author_status
    ON public.blog_articles (author_id, status, created_at DESC);

ALTER TABLE public.blog_articles ENABLE ROW LEVEL SECURITY;

-- Anyone (including anon visitors) can read approved blog articles
DROP POLICY IF EXISTS "Public can read approved blog articles" ON public.blog_articles;
CREATE POLICY "Public can read approved blog articles"
    ON public.blog_articles
    FOR SELECT
    USING (status = 'approved');

-- Authors, delegated page admins, and superadmins can view non-approved submissions
DROP POLICY IF EXISTS "Authors and admins can read own or all blog articles" ON public.blog_articles;
CREATE POLICY "Authors and admins can read own or all blog articles"
    ON public.blog_articles
    FOR SELECT
    TO authenticated
    USING (
        author_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM public.page_admins pa
            WHERE pa.page_id = blog_articles.author_id
              AND pa.admin_user_id = auth.uid()
        )
        OR (
            EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_superadmin' AND pronamespace = 'public'::regnamespace)
            AND public.is_superadmin()
        )
    );

-- Verified accounts (or their delegated page admins) can submit pending articles
DROP POLICY IF EXISTS "Verified accounts can submit pending blog articles" ON public.blog_articles;
CREATE POLICY "Verified accounts can submit pending blog articles"
    ON public.blog_articles
    FOR INSERT
    TO authenticated
    WITH CHECK (
        status = 'pending'
        AND EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE p.id = blog_articles.author_id
              AND coalesce(p.upgrade_status, '') <> 'revoked'
              AND (p.account_type = 'ministry_minister' OR p.upgrade_status = 'approved')
        )
        AND (
            author_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM public.page_admins pa
                WHERE pa.page_id = blog_articles.author_id
                  AND pa.admin_user_id = auth.uid()
            )
        )
    );

-- Superadmins can verify, approve, reject, and promote blog articles
DROP POLICY IF EXISTS "Superadmins can update blog articles" ON public.blog_articles;
CREATE POLICY "Superadmins can update blog articles"
    ON public.blog_articles
    FOR UPDATE
    TO authenticated
    USING (public.is_superadmin())
    WITH CHECK (public.is_superadmin());

DROP POLICY IF EXISTS "Superadmins can delete blog articles" ON public.blog_articles;
CREATE POLICY "Superadmins can delete blog articles"
    ON public.blog_articles
    FOR DELETE
    TO authenticated
    USING (public.is_superadmin());
