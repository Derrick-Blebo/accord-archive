-- ============================================================================
-- Accord Archive — Auto-Publish Verification Sample Posts on Approval
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. Track when an applicant's verification samples were published to feed_posts
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS verification_samples_published_at timestamptz;

-- Reset published marker whenever a user submits/resubmits a pending application
CREATE OR REPLACE FUNCTION public.reset_verification_samples_published_on_pending()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NEW.upgrade_status = 'pending' AND OLD.upgrade_status IS DISTINCT FROM 'pending' THEN
        NEW.verification_samples_published_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_reset_verification_samples_published ON public.profiles;
CREATE TRIGGER trg_reset_verification_samples_published
    BEFORE UPDATE OF upgrade_status ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.reset_verification_samples_published_on_pending();

-- 2. Publish a verified user's 5 verification_samples into public.feed_posts
CREATE OR REPLACE FUNCTION public.publish_verification_samples_for_user(target_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    prof record;
    sample jsonb;
    s_type text;
    s_body text;
    s_media_url text;
    s_media_title text;
    s_media_thumb text;
    resolved_name text;
    inserted_count integer := 0;
BEGIN
    IF target_user_id IS NULL THEN
        RETURN 0;
    END IF;

    SELECT
        id,
        full_name,
        email,
        account_type,
        upgrade_status,
        verification_samples,
        verification_samples_published_at
    INTO prof
    FROM public.profiles
    WHERE id = target_user_id;

    IF NOT FOUND THEN
        RETURN 0;
    END IF;

    IF NOT (
        (prof.account_type = 'ministry_minister' OR prof.upgrade_status = 'approved')
        AND prof.upgrade_status IS DISTINCT FROM 'revoked'
    ) THEN
        RETURN 0;
    END IF;

    IF prof.verification_samples_published_at IS NOT NULL THEN
        RETURN 0;
    END IF;

    IF prof.verification_samples IS NULL
       OR jsonb_typeof(prof.verification_samples) <> 'array'
       OR jsonb_array_length(prof.verification_samples) = 0 THEN
        RETURN 0;
    END IF;

    resolved_name := coalesce(
        nullif(trim(prof.full_name), ''),
        nullif(split_part(coalesce(prof.email, ''), '@', 1), ''),
        'Verified Ministry'
    );

    FOR sample IN SELECT value FROM jsonb_array_elements(prof.verification_samples) AS value
    LOOP
        s_type := lower(coalesce(trim(sample->>'post_type'), 'text'));
        IF s_type NOT IN ('text', 'video', 'audio') THEN
            s_type := 'text';
        END IF;

        s_body := coalesce(trim(sample->>'body'), '');
        s_media_url := nullif(trim(sample->>'media_url'), '');
        s_media_title := nullif(trim(sample->>'title'), '');
        s_media_thumb := nullif(trim(sample->>'media_thumbnail'), '');

        IF s_body = '' AND s_media_url IS NULL THEN
            CONTINUE;
        END IF;

        INSERT INTO public.feed_posts (
            post_type,
            title,
            body,
            media_url,
            media_title,
            media_thumbnail,
            author_id,
            author_name,
            author_role,
            is_anonymous,
            is_approved
        ) VALUES (
            s_type,
            NULL,
            s_body,
            s_media_url,
            CASE WHEN s_type = 'audio' THEN s_media_title ELSE NULL END,
            CASE WHEN s_type = 'audio' THEN s_media_thumb ELSE NULL END,
            prof.id,
            resolved_name,
            'ministry_minister',
            false,
            true
        );

        inserted_count := inserted_count + 1;
    END LOOP;

    UPDATE public.profiles
    SET verification_samples_published_at = now()
    WHERE id = prof.id;

    RETURN inserted_count;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_verification_samples_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.publish_verification_samples_for_user(uuid) TO authenticated;

-- 3. Trigger: automatically publish sample posts whenever an account becomes verified
CREATE OR REPLACE FUNCTION public.on_profile_verification_approved()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    was_verified boolean;
    now_verified boolean;
BEGIN
    was_verified := (OLD.account_type = 'ministry_minister' OR OLD.upgrade_status = 'approved')
                    AND OLD.upgrade_status IS DISTINCT FROM 'revoked';
    now_verified := (NEW.account_type = 'ministry_minister' OR NEW.upgrade_status = 'approved')
                    AND NEW.upgrade_status IS DISTINCT FROM 'revoked';

    IF now_verified AND NOT was_verified THEN
        PERFORM public.publish_verification_samples_for_user(NEW.id);
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_verification_approved ON public.profiles;
CREATE TRIGGER trg_profile_verification_approved
    AFTER UPDATE OF upgrade_status, account_type ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.on_profile_verification_approved();

-- 4. Atomic Superadmin RPC to approve verification, publish samples, and notify the user
CREATE OR REPLACE FUNCTION public.approve_ministry_verification(target_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    published_count integer := 0;
BEGIN
    IF NOT public.is_superadmin() THEN
        RAISE EXCEPTION 'Only Superadmins can approve verification.';
    END IF;

    IF target_user_id IS NULL THEN
        RAISE EXCEPTION 'Target user ID is required.';
    END IF;

    UPDATE public.profiles
    SET
        account_type = 'ministry_minister',
        upgrade_status = 'approved'
    WHERE id = target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found.';
    END IF;

    -- Trigger trg_profile_verification_approved publishes samples; call helper as idempotent fallback
    published_count := public.publish_verification_samples_for_user(target_user_id);

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        target_user_id,
        'verification_approved',
        'Ministry Verification Approved',
        'Your Ministry / Minister account has been verified and your submitted sample posts are now live on the feed.',
        'feed.html'
    );

    RETURN published_count;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_ministry_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_ministry_verification(uuid) TO authenticated;
