-- ============================================================================
-- Accord Archive — Playlist Saves & Engagement Analytics Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. Per-user saved playlists (bookmarks)
CREATE TABLE IF NOT EXISTS public.user_playlist_bookmarks (
    id bigserial PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    playlist_id text NOT NULL,
    playlist_title text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, playlist_id)
);

CREATE INDEX IF NOT EXISTS idx_user_playlist_bookmarks_user
    ON public.user_playlist_bookmarks (user_id, created_at DESC);

ALTER TABLE public.user_playlist_bookmarks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_playlist_bookmarks' AND policyname = 'Users can view own saved playlists'
    ) THEN
        CREATE POLICY "Users can view own saved playlists"
            ON public.user_playlist_bookmarks
            FOR SELECT
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_playlist_bookmarks' AND policyname = 'Users can save playlists'
    ) THEN
        CREATE POLICY "Users can save playlists"
            ON public.user_playlist_bookmarks
            FOR INSERT
            TO authenticated
            WITH CHECK (auth.uid() = user_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'user_playlist_bookmarks' AND policyname = 'Users can unsave own playlists'
    ) THEN
        CREATE POLICY "Users can unsave own playlists"
            ON public.user_playlist_bookmarks
            FOR DELETE
            TO authenticated
            USING (auth.uid() = user_id);
    END IF;
END $$;

-- 2. Granular playlist engagement events (saves, unsaves, plays, platform clicks)
CREATE TABLE IF NOT EXISTS public.playlist_events (
    id bigserial PRIMARY KEY,
    playlist_id text NOT NULL,
    playlist_title text NOT NULL DEFAULT '',
    event_type text NOT NULL CHECK (event_type IN ('save', 'unsave', 'play', 'platform_click', 'share_chat', 'share_external')),
    platform text,
    page_source text NOT NULL DEFAULT 'music',
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    session_id text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_playlist_events_playlist_created
    ON public.playlist_events (playlist_id, event_type, created_at DESC);

ALTER TABLE public.playlist_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'playlist_events' AND policyname = 'Anyone can record playlist events'
    ) THEN
        CREATE POLICY "Anyone can record playlist events"
            ON public.playlist_events
            FOR INSERT
            TO anon, authenticated
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'playlist_events' AND policyname = 'Authenticated users can read playlist events'
    ) THEN
        CREATE POLICY "Authenticated users can read playlist events"
            ON public.playlist_events
            FOR SELECT
            TO authenticated
            USING (true);
    END IF;
END $$;

-- 3. Aggregated playlist stats for fast decision-making & admin insights
CREATE TABLE IF NOT EXISTS public.playlist_stats (
    playlist_id text PRIMARY KEY,
    playlist_title text NOT NULL DEFAULT '',
    save_count bigint NOT NULL DEFAULT 0,
    play_count bigint NOT NULL DEFAULT 0,
    platform_click_count bigint NOT NULL DEFAULT 0,
    engagement_count bigint NOT NULL DEFAULT 0,
    last_engaged_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.playlist_stats ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'playlist_stats' AND policyname = 'Public can read playlist stats'
    ) THEN
        CREATE POLICY "Public can read playlist stats"
            ON public.playlist_stats
            FOR SELECT
            TO anon, authenticated
            USING (true);
    END IF;
END $$;

-- 4. Atomic RPC to record playlist save/engagement events
CREATE OR REPLACE FUNCTION public.record_playlist_event(
    p_playlist_id text,
    p_playlist_title text DEFAULT '',
    p_event_type text DEFAULT 'play',
    p_platform text DEFAULT NULL,
    p_page_source text DEFAULT 'music',
    p_session_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_event text := lower(trim(COALESCE(p_event_type, 'play')));
    v_title text := COALESCE(NULLIF(trim(p_playlist_title), ''), p_playlist_id);
BEGIN
    IF p_playlist_id IS NULL OR trim(p_playlist_id) = '' THEN
        RETURN;
    END IF;

    IF v_event NOT IN ('save', 'unsave', 'play', 'platform_click', 'share_chat', 'share_external') THEN
        RETURN;
    END IF;

    INSERT INTO public.playlist_events (
        playlist_id,
        playlist_title,
        event_type,
        platform,
        page_source,
        user_id,
        session_id
    ) VALUES (
        trim(p_playlist_id),
        v_title,
        v_event,
        NULLIF(trim(COALESCE(p_platform, '')), ''),
        COALESCE(NULLIF(trim(p_page_source), ''), 'music'),
        auth.uid(),
        NULLIF(trim(COALESCE(p_session_id, '')), '')
    );

    INSERT INTO public.playlist_stats (
        playlist_id,
        playlist_title,
        save_count,
        play_count,
        platform_click_count,
        engagement_count,
        last_engaged_at,
        updated_at
    ) VALUES (
        trim(p_playlist_id),
        v_title,
        CASE WHEN v_event = 'save' THEN 1 ELSE 0 END,
        CASE WHEN v_event = 'play' THEN 1 ELSE 0 END,
        CASE WHEN v_event = 'platform_click' THEN 1 ELSE 0 END,
        CASE WHEN v_event IN ('play', 'platform_click', 'save', 'share_chat', 'share_external') THEN 1 ELSE 0 END,
        now(),
        now()
    )
    ON CONFLICT (playlist_id) DO UPDATE SET
        playlist_title = COALESCE(NULLIF(EXCLUDED.playlist_title, ''), public.playlist_stats.playlist_title),
        save_count = CASE
            WHEN v_event = 'save' THEN public.playlist_stats.save_count + 1
            WHEN v_event = 'unsave' THEN GREATEST(0, public.playlist_stats.save_count - 1)
            ELSE public.playlist_stats.save_count
        END,
        play_count = public.playlist_stats.play_count + CASE WHEN v_event = 'play' THEN 1 ELSE 0 END,
        platform_click_count = public.playlist_stats.platform_click_count + CASE WHEN v_event = 'platform_click' THEN 1 ELSE 0 END,
        engagement_count = public.playlist_stats.engagement_count + CASE WHEN v_event IN ('play', 'platform_click', 'save', 'share_chat', 'share_external') THEN 1 ELSE 0 END,
        last_engaged_at = now(),
        updated_at = now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_playlist_event(text, text, text, text, text, text) TO anon, authenticated;
