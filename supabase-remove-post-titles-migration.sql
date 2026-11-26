-- Remove titles from feed_posts and standardize on body-only posts
-- Run in Supabase SQL Editor to clear existing post titles and allow NULL titles.

ALTER TABLE public.feed_posts
    ALTER COLUMN title DROP NOT NULL;

UPDATE public.feed_posts
SET title = NULL
WHERE title IS NOT NULL;

-- Update notification triggers so they reference post body excerpt instead of title
CREATE OR REPLACE FUNCTION public.notify_on_repost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    post_author uuid;
    post_body text;
    reposter_name text;
BEGIN
    SELECT author_id, body INTO post_author, post_body
    FROM public.feed_posts WHERE id = NEW.post_id;

    IF post_author IS NULL OR post_author = NEW.user_id THEN
        RETURN NEW;
    END IF;

    SELECT coalesce(nullif(trim(full_name), ''), 'Someone') INTO reposter_name
    FROM public.profiles WHERE id = NEW.user_id;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        post_author,
        'repost',
        'Your post was reposted',
        reposter_name || ' reposted "' || coalesce(nullif(left(trim(post_body), 50), ''), 'your post') || '".',
        'post.html?id=' || NEW.post_id::text
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    post_author uuid;
    post_body text;
    liker_id uuid;
    liker_name text;
BEGIN
    SELECT author_id, body INTO post_author, post_body
    FROM public.feed_posts WHERE id = NEW.post_id;

    IF post_author IS NULL THEN
        RETURN NEW;
    END IF;

    liker_id := auth.uid();
    IF liker_id IS NOT NULL AND liker_id = post_author THEN
        RETURN NEW;
    END IF;

    IF liker_id IS NOT NULL THEN
        SELECT coalesce(nullif(trim(full_name), ''), 'Someone') INTO liker_name
        FROM public.profiles WHERE id = liker_id;
    ELSE
        liker_name := 'Someone';
    END IF;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        post_author,
        'like',
        'New like on your post',
        liker_name || ' liked "' || coalesce(nullif(left(trim(post_body), 50), ''), 'your post') || '".',
        'post.html?id=' || NEW.post_id::text
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    post_author uuid;
    post_body text;
    commenter_name text;
BEGIN
    SELECT author_id, body INTO post_author, post_body
    FROM public.feed_posts WHERE id = NEW.post_id;

    IF post_author IS NULL OR (NEW.user_id IS NOT NULL AND NEW.user_id = post_author) THEN
        RETURN NEW;
    END IF;

    commenter_name := coalesce(nullif(trim(NEW.author_name), ''), 'Someone');

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        post_author,
        'comment',
        'New comment on your post',
        commenter_name || ' commented on "' || coalesce(nullif(left(trim(post_body), 50), ''), 'your post') || '".',
        'post.html?id=' || NEW.post_id::text
    );
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_ministry_followers_on_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    author_display text;
BEGIN
    IF NEW.author_id IS NULL OR NEW.is_anonymous = true OR NEW.is_approved = false THEN
        RETURN NEW;
    END IF;

    IF NOT public.is_verified_ministry(NEW.author_id) THEN
        RETURN NEW;
    END IF;

    SELECT coalesce(nullif(trim(full_name), ''), nullif(trim(NEW.author_name), ''), 'A verified ministry')
    INTO author_display
    FROM public.profiles
    WHERE id = NEW.author_id;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    SELECT
        af.follower_id,
        'new_post',
        author_display || ' shared a new ' || NEW.post_type,
        coalesce(nullif(left(trim(NEW.body), 70), ''), 'Check out this new post on the feed.'),
        'post.html?id=' || NEW.id::text
    FROM public.account_follows af
    WHERE af.following_id = NEW.author_id
      AND af.follower_id <> NEW.author_id;

    RETURN NEW;
END;
$$;
