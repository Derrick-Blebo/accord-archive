-- ============================================================================
-- Accord Archive — Audio Post Metadata & Public Profile Audio Streaming Link
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. ADD AUTO-PULLED AUDIO METADATA COLUMNS TO FEED_POSTS
ALTER TABLE public.feed_posts
    ADD COLUMN IF NOT EXISTS media_title text,
    ADD COLUMN IF NOT EXISTS media_thumbnail text;

-- 2. ADD MAIN AUDIO STREAMING PAGE LINK & TYPE TO PROFILES
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS audio_stream_url text,
    ADD COLUMN IF NOT EXISTS audio_stream_type text;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'profiles_audio_stream_type_check'
    ) THEN
        ALTER TABLE public.profiles
            ADD CONSTRAINT profiles_audio_stream_type_check
            CHECK (audio_stream_type IS NULL OR audio_stream_type IN ('sermons', 'music', 'podcast'));
    END IF;
END $$;
