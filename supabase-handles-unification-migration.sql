-- ============================================================================
-- Accord Archive — Handles, Comment RLS Fix, Testimonies Unification & Post Views
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. UNIQUE @HANDLE ON PROFILES
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS handle text;

-- Backfill any existing profiles without a handle
DO $$
DECLARE
    rec RECORD;
    base_slug text;
    candidate text;
    suffix_num int;
BEGIN
    FOR rec IN
        SELECT id, full_name, email
        FROM public.profiles
        WHERE handle IS NULL OR trim(handle) = ''
        ORDER BY created_at ASC NULLS LAST, id ASC
    LOOP
        base_slug := regexp_replace(
            lower(coalesce(nullif(trim(rec.full_name), ''), split_part(coalesce(rec.email, ''), '@', 1), 'member')),
            '[^a-z0-9_]+',
            '_',
            'g'
        );
        base_slug := trim(both '_' from base_slug);
        IF length(base_slug) < 3 THEN
            base_slug := base_slug || 'member';
        END IF;
        base_slug := left(base_slug, 24);

        candidate := '@' || base_slug;
        suffix_num := 1;
        WHILE EXISTS (
            SELECT 1 FROM public.profiles p
            WHERE LOWER(p.handle) = LOWER(candidate) AND p.id <> rec.id
        ) LOOP
            candidate := '@' || left(base_slug, 22) || '_' || suffix_num::text;
            suffix_num := suffix_num + 1;
        END LOOP;

        UPDATE public.profiles SET handle = candidate WHERE id = rec.id;
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_handle_lower
    ON public.profiles (LOWER(handle))
    WHERE handle IS NOT NULL;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_handle_format_chk;
ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_handle_format_chk
    CHECK (handle IS NULL OR handle ~ '^@[a-z0-9_]{3,30}$');

-- Handle availability RPC (safe for anon & authenticated)
CREATE OR REPLACE FUNCTION public.is_handle_available(
    candidate text,
    exclude_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
    normalized text;
BEGIN
    normalized := '@' || regexp_replace(lower(trim(coalesce(candidate, ''))), '^@+', '');
    IF normalized !~ '^@[a-z0-9_]{3,30}$' THEN
        RETURN false;
    END IF;
    RETURN NOT EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE LOWER(p.handle) = LOWER(normalized)
          AND (exclude_user_id IS NULL OR p.id <> exclude_user_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_handle_available(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_handle_available(text, uuid) TO anon, authenticated;

-- 2. FIX POST_COMMENTS RLS POLICY
ALTER TABLE public.post_comments
    ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
    pol RECORD;
BEGIN
    FOR pol IN
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'post_comments'
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.post_comments', pol.policyname);
    END LOOP;
END $$;

CREATE POLICY "Anyone can view post comments"
    ON public.post_comments
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "Authenticated users can insert post comments"
    ON public.post_comments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND (user_id IS NULL OR user_id = auth.uid())
        AND (author_id IS NULL OR author_id = auth.uid())
    );

CREATE POLICY "Users can delete own post comments"
    ON public.post_comments
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id OR auth.uid() = author_id);

-- 3. UNIFY LEGACY TESTIMONIES INTO FEED_POSTS
ALTER TABLE public.feed_posts
    ADD COLUMN IF NOT EXISTS legacy_testimony_id bigint;

CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_posts_legacy_testimony_id
    ON public.feed_posts (legacy_testimony_id)
    WHERE legacy_testimony_id IS NOT NULL;

DO $$
DECLARE
    has_likes_count boolean;
    has_amens_count boolean;
    has_user_id boolean;
    likes_expr text;
    author_id_expr text;
    author_role_expr text;
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'testimonies'
    ) THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'testimonies' AND column_name = 'likes_count'
        ) INTO has_likes_count;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'testimonies' AND column_name = 'amens_count'
        ) INTO has_amens_count;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'testimonies' AND column_name = 'user_id'
        ) INTO has_user_id;

        likes_expr := CASE
            WHEN has_likes_count THEN 'coalesce(t.likes_count, 0)'
            WHEN has_amens_count THEN 'coalesce(t.amens_count, 0)'
            ELSE '0'
        END;

        author_id_expr := CASE
            WHEN has_user_id THEN 'CASE WHEN t.user_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.user_id) THEN t.user_id ELSE NULL END'
            ELSE 'NULL::uuid'
        END;

        author_role_expr := CASE
            WHEN has_user_id THEN $r$coalesce((SELECT CASE WHEN p.account_type = 'ministry_minister' OR (p.upgrade_status = 'approved' AND p.upgrade_status IS DISTINCT FROM 'revoked') THEN 'ministry_minister' ELSE coalesce(p.account_type, 'normal_user') END FROM public.profiles p WHERE p.id = t.user_id), 'guest')$r$
            ELSE $r$'guest'$r$
        END;

        EXECUTE format($sql$
            INSERT INTO public.feed_posts (
                post_type,
                title,
                body,
                author_name,
                author_id,
                author_role,
                is_anonymous,
                likes_count,
                reposts_count,
                is_approved,
                created_at,
                legacy_testimony_id
            )
            SELECT
                'testimony',
                t.title,
                t.body,
                coalesce(nullif(trim(t.author_name), ''), 'Anonymous'),
                %s,
                %s,
                (t.author_name IS NULL OR trim(t.author_name) = '' OR lower(trim(t.author_name)) = 'anonymous'),
                %s,
                0,
                coalesce(t.is_approved, true),
                coalesce(t.created_at, now()),
                t.id
            FROM public.testimonies t
            WHERE NOT EXISTS (
                SELECT 1 FROM public.feed_posts fp WHERE fp.legacy_testimony_id = t.id
            )
        $sql$, author_id_expr, author_role_expr, likes_expr);
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'testimony_comments'
    ) THEN
        ALTER TABLE public.post_comments
            ADD COLUMN IF NOT EXISTS legacy_testimony_comment_id bigint;

        CREATE UNIQUE INDEX IF NOT EXISTS idx_post_comments_legacy_testimony_comment_id
            ON public.post_comments (legacy_testimony_comment_id)
            WHERE legacy_testimony_comment_id IS NOT NULL;

        INSERT INTO public.post_comments (
            post_id,
            author_name,
            comment_text,
            created_at,
            legacy_testimony_comment_id
        )
        SELECT
            fp.id,
            coalesce(nullif(trim(tc.author_name), ''), 'Member'),
            tc.comment_text,
            coalesce(tc.created_at, now()),
            tc.id
        FROM public.testimony_comments tc
        JOIN public.feed_posts fp ON fp.legacy_testimony_id = tc.testimony_id
        WHERE NOT EXISTS (
            SELECT 1 FROM public.post_comments pc WHERE pc.legacy_testimony_comment_id = tc.id
        );
    END IF;
END $$;

-- 4. POST VIEWS TRACKING (For unseen-first feed ordering)
CREATE TABLE IF NOT EXISTS public.post_views (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
    viewed_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_post_views_user_id ON public.post_views(user_id);
CREATE INDEX IF NOT EXISTS idx_post_views_post_id ON public.post_views(post_id);

ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own post views" ON public.post_views;
CREATE POLICY "Users can view own post views"
    ON public.post_views
    FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own post views" ON public.post_views;
CREATE POLICY "Users can insert own post views"
    ON public.post_views
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own post views" ON public.post_views;
CREATE POLICY "Users can update own post views"
    ON public.post_views
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
