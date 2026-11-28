-- ============================================================================
-- Accord Archive — Saved Posts (All Post Types) Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_saved_posts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_posts_user_created
    ON public.user_saved_posts (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_saved_posts_post_id
    ON public.user_saved_posts (post_id);

ALTER TABLE public.user_saved_posts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_saved_posts' AND policyname = 'Users can view own saved posts'
    ) THEN
        CREATE POLICY "Users can view own saved posts"
            ON public.user_saved_posts
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_saved_posts' AND policyname = 'Users can save posts'
    ) THEN
        CREATE POLICY "Users can save posts"
            ON public.user_saved_posts
            FOR INSERT
            TO authenticated
            WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_saved_posts' AND policyname = 'Users can unsave own posts'
    ) THEN
        CREATE POLICY "Users can unsave own posts"
            ON public.user_saved_posts
            FOR DELETE
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;
END $$;
