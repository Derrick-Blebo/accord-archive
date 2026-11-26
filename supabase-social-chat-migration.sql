-- ============================================================================
-- Accord Archive — Social Feed, Unified Profiles, Chat & Notifications Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. PROFILES ENHANCEMENTS & PUBLIC VIEWING
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS bio text,
    ADD COLUMN IF NOT EXISTS avatar_url text;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view basic profiles" ON public.profiles;
CREATE POLICY "Public can view basic profiles"
    ON public.profiles
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
    ON public.profiles
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- 2. UNIFIED ACCOUNT FOLLOWS (Generalizes ministry_follows to all accounts)
CREATE TABLE IF NOT EXISTS public.account_follows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    following_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (follower_id, following_id),
    CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_account_follows_follower ON public.account_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_account_follows_following ON public.account_follows(following_id);

-- Backfill from legacy ministry_follows if present
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'ministry_follows'
    ) THEN
        INSERT INTO public.account_follows (follower_id, following_id, created_at)
        SELECT follower_id, ministry_id, coalesce(created_at, now())
        FROM public.ministry_follows
        WHERE follower_id IS NOT NULL AND ministry_id IS NOT NULL AND follower_id <> ministry_id
        ON CONFLICT (follower_id, following_id) DO NOTHING;
    END IF;
END $$;

ALTER TABLE public.account_follows ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view account follows" ON public.account_follows;
CREATE POLICY "Anyone can view account follows"
    ON public.account_follows
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Users can follow accounts" ON public.account_follows;
CREATE POLICY "Users can follow accounts"
    ON public.account_follows
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can unfollow accounts" ON public.account_follows;
CREATE POLICY "Users can unfollow accounts"
    ON public.account_follows
    FOR DELETE
    TO authenticated
    USING (auth.uid() = follower_id);

-- 3. FEED POSTS PERMISSIONS & REPOSTS
ALTER TABLE public.feed_posts
    ADD COLUMN IF NOT EXISTS reposts_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.is_verified_account(check_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = check_user_id
          AND (p.account_type = 'ministry_minister' OR p.upgrade_status = 'approved')
    );
$$;

REVOKE ALL ON FUNCTION public.is_verified_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_verified_account(uuid) TO anon, authenticated;

-- Enforce posting rules:
-- Any user (including guests) can post testimonies; only verified accounts can post video/audio/text.
DROP POLICY IF EXISTS "Anyone can insert testimonies; verified can insert posts" ON public.feed_posts;
CREATE POLICY "Anyone can insert testimonies; verified can insert posts"
    ON public.feed_posts
    FOR INSERT
    TO anon, authenticated
    WITH CHECK (
        post_type = 'testimony'
        OR (
            auth.uid() IS NOT NULL
            AND author_id = auth.uid()
            AND public.is_verified_account(auth.uid())
        )
    );

CREATE TABLE IF NOT EXISTS public.post_reposts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id uuid NOT NULL REFERENCES public.feed_posts(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    quote_text text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_reposts_post_id ON public.post_reposts(post_id);
CREATE INDEX IF NOT EXISTS idx_post_reposts_user_id ON public.post_reposts(user_id);
CREATE INDEX IF NOT EXISTS idx_post_reposts_created_at ON public.post_reposts(created_at DESC);

ALTER TABLE public.post_reposts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view reposts" ON public.post_reposts;
CREATE POLICY "Anyone can view reposts"
    ON public.post_reposts
    FOR SELECT
    TO anon, authenticated
    USING (true);

DROP POLICY IF EXISTS "Authenticated users can repost" ON public.post_reposts;
CREATE POLICY "Authenticated users can repost"
    ON public.post_reposts
    FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own reposts" ON public.post_reposts;
CREATE POLICY "Users can delete own reposts"
    ON public.post_reposts
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.sync_post_reposts_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE public.feed_posts
        SET reposts_count = coalesce(reposts_count, 0) + 1
        WHERE id = NEW.post_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE public.feed_posts
        SET reposts_count = GREATEST(0, coalesce(reposts_count, 0) - 1)
        WHERE id = OLD.post_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_post_reposts_count ON public.post_reposts;
CREATE TRIGGER trg_sync_post_reposts_count
    AFTER INSERT OR DELETE ON public.post_reposts
    FOR EACH ROW EXECUTE FUNCTION public.sync_post_reposts_count();

-- 4. CHAT SYSTEM (1-on-1 DMs & Group Chats + Rich Content Sharing)
CREATE TABLE IF NOT EXISTS public.conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    is_group boolean NOT NULL DEFAULT false,
    title text,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    last_message_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.conversation_members (
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    last_read_at timestamptz NOT NULL DEFAULT now(),
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_members_user ON public.conversation_members(user_id);

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    message_type text NOT NULL DEFAULT 'text'
        CHECK (message_type IN ('text', 'shared_post', 'shared_book', 'shared_testimony', 'shared_profile')),
    body text,
    attachment_meta jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conv_created ON public.chat_messages(conversation_id, created_at ASC);

CREATE OR REPLACE FUNCTION public.is_conversation_member(conv_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.conversation_members cm
        WHERE cm.conversation_id = conv_id
          AND cm.user_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.is_conversation_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(uuid) TO authenticated;

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can view their conversations" ON public.conversations;
CREATE POLICY "Members can view their conversations"
    ON public.conversations
    FOR SELECT
    TO authenticated
    USING (public.is_conversation_member(id));

DROP POLICY IF EXISTS "Members can update group conversation details" ON public.conversations;
CREATE POLICY "Members can update group conversation details"
    ON public.conversations
    FOR UPDATE
    TO authenticated
    USING (public.is_conversation_member(id))
    WITH CHECK (public.is_conversation_member(id));

DROP POLICY IF EXISTS "Members can view conversation members" ON public.conversation_members;
CREATE POLICY "Members can view conversation members"
    ON public.conversation_members
    FOR SELECT
    TO authenticated
    USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "Members can add new members to group" ON public.conversation_members;
CREATE POLICY "Members can add new members to group"
    ON public.conversation_members
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "Members can update own read timestamp" ON public.conversation_members;
CREATE POLICY "Members can update own read timestamp"
    ON public.conversation_members
    FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members can leave conversation" ON public.conversation_members;
CREATE POLICY "Members can leave conversation"
    ON public.conversation_members
    FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Members can view chat messages" ON public.chat_messages;
CREATE POLICY "Members can view chat messages"
    ON public.chat_messages
    FOR SELECT
    TO authenticated
    USING (public.is_conversation_member(conversation_id));

DROP POLICY IF EXISTS "Members can send chat messages" ON public.chat_messages;
CREATE POLICY "Members can send chat messages"
    ON public.chat_messages
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = sender_id
        AND public.is_conversation_member(conversation_id)
    );

-- Atomic 1-on-1 DM finder/creator
CREATE OR REPLACE FUNCTION public.get_or_create_dm(target_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid := auth.uid();
    existing_conv_id uuid;
    new_conv_id uuid;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;
    IF target_user_id IS NULL OR target_user_id = caller_id THEN
        RAISE EXCEPTION 'Invalid target user';
    END IF;

    SELECT c.id INTO existing_conv_id
    FROM public.conversations c
    JOIN public.conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = caller_id
    JOIN public.conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = target_user_id
    WHERE c.is_group = false
    LIMIT 1;

    IF existing_conv_id IS NOT NULL THEN
        RETURN existing_conv_id;
    END IF;

    INSERT INTO public.conversations (is_group, created_by)
    VALUES (false, caller_id)
    RETURNING id INTO new_conv_id;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES
        (new_conv_id, caller_id, 'admin'),
        (new_conv_id, target_user_id, 'member');

    RETURN new_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_dm(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm(uuid) TO authenticated;

-- Atomic Group Chat creator
CREATE OR REPLACE FUNCTION public.create_group_chat(group_title text, member_ids uuid[])
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    caller_id uuid := auth.uid();
    new_conv_id uuid;
    m_id uuid;
BEGIN
    IF caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    INSERT INTO public.conversations (is_group, title, created_by)
    VALUES (true, coalesce(nullif(trim(group_title), ''), 'Fellowship Group'), caller_id)
    RETURNING id INTO new_conv_id;

    INSERT INTO public.conversation_members (conversation_id, user_id, role)
    VALUES (new_conv_id, caller_id, 'admin')
    ON CONFLICT DO NOTHING;

    IF member_ids IS NOT NULL THEN
        FOREACH m_id IN ARRAY member_ids LOOP
            IF m_id IS NOT NULL AND m_id <> caller_id THEN
                INSERT INTO public.conversation_members (conversation_id, user_id, role)
                VALUES (new_conv_id, m_id, 'member')
                ON CONFLICT DO NOTHING;
            END IF;
        END LOOP;
    END IF;

    RETURN new_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_group_chat(text, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_group_chat(text, uuid[]) TO authenticated;

-- 5. AUTOMATIC NOTIFICATION TRIGGERS
CREATE OR REPLACE FUNCTION public.notify_on_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    follower_name text;
BEGIN
    SELECT coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1), 'Someone')
    INTO follower_name
    FROM public.profiles WHERE id = NEW.follower_id;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        NEW.following_id,
        'new_follow',
        'New Follower',
        follower_name || ' started following you.',
        'user.html?id=' || NEW.follower_id::text
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_follow ON public.account_follows;
CREATE TRIGGER trg_notify_on_follow
    AFTER INSERT ON public.account_follows
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_follow();

CREATE OR REPLACE FUNCTION public.notify_on_repost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    reposter_name text;
    post_author uuid;
    post_title text;
BEGIN
    SELECT author_id, title INTO post_author, post_title
    FROM public.feed_posts WHERE id = NEW.post_id;

    IF post_author IS NULL OR post_author = NEW.user_id THEN
        RETURN NEW;
    END IF;

    SELECT coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1), 'Someone')
    INTO reposter_name
    FROM public.profiles WHERE id = NEW.user_id;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        post_author,
        'post_repost',
        'Post Reposted',
        reposter_name || ' reposted "' || coalesce(left(post_title, 50), 'your post') || '".',
        'post.html?id=' || NEW.post_id::text
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_repost ON public.post_reposts;
CREATE TRIGGER trg_notify_on_repost
    AFTER INSERT ON public.post_reposts
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_repost();

CREATE OR REPLACE FUNCTION public.notify_on_post_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    liker_id uuid;
    liker_name text;
    post_author uuid;
    post_title text;
BEGIN
    IF NEW.voter_key NOT LIKE 'user_%' THEN
        RETURN NEW;
    END IF;

    BEGIN
        liker_id := substring(NEW.voter_key FROM 6)::uuid;
    EXCEPTION WHEN OTHERS THEN
        RETURN NEW;
    END;

    SELECT author_id, title INTO post_author, post_title
    FROM public.feed_posts WHERE id = NEW.post_id;

    IF post_author IS NULL OR post_author = liker_id THEN
        RETURN NEW;
    END IF;

    SELECT coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1), 'Someone')
    INTO liker_name
    FROM public.profiles WHERE id = liker_id;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        post_author,
        'post_like',
        'New Like',
        liker_name || ' liked "' || coalesce(left(post_title, 50), 'your post') || '".',
        'post.html?id=' || NEW.post_id::text
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_post_like ON public.post_likes;
CREATE TRIGGER trg_notify_on_post_like
    AFTER INSERT ON public.post_likes
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_post_like();

CREATE OR REPLACE FUNCTION public.notify_on_post_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    post_author uuid;
    post_title text;
    commenter_name text;
BEGIN
    SELECT author_id, title INTO post_author, post_title
    FROM public.feed_posts WHERE id = NEW.post_id;

    IF post_author IS NULL OR (NEW.user_id IS NOT NULL AND post_author = NEW.user_id) THEN
        RETURN NEW;
    END IF;

    commenter_name := coalesce(nullif(trim(NEW.author_name), ''), 'Someone');

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    VALUES (
        post_author,
        'post_comment',
        'New Comment',
        commenter_name || ' commented on "' || coalesce(left(post_title, 50), 'your post') || '".',
        'post.html?id=' || NEW.post_id::text
    );
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_post_comment ON public.post_comments;
CREATE TRIGGER trg_notify_on_post_comment
    AFTER INSERT ON public.post_comments
    FOR EACH ROW EXECUTE FUNCTION public.notify_on_post_comment();

CREATE OR REPLACE FUNCTION public.notify_followers_on_new_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    author_display text;
BEGIN
    IF NEW.is_approved IS DISTINCT FROM true OR NEW.is_anonymous = true OR NEW.author_id IS NULL THEN
        RETURN NEW;
    END IF;

    author_display := coalesce(nullif(trim(NEW.author_name), ''), 'Someone you follow');

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    SELECT
        af.follower_id,
        'new_post',
        'New Post from ' || author_display,
        coalesce(left(NEW.title, 70), 'Check out this new post on the feed.'),
        'post.html?id=' || NEW.id::text
    FROM public.account_follows af
    WHERE af.following_id = NEW.author_id
      AND af.follower_id <> NEW.author_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_followers_on_new_post ON public.feed_posts;
CREATE TRIGGER trg_notify_followers_on_new_post
    AFTER INSERT ON public.feed_posts
    FOR EACH ROW EXECUTE FUNCTION public.notify_followers_on_new_post();

CREATE OR REPLACE FUNCTION public.on_chat_message_inserted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    sender_name text;
    preview_text text;
BEGIN
    UPDATE public.conversations
    SET last_message_at = NEW.created_at
    WHERE id = NEW.conversation_id;

    UPDATE public.conversation_members
    SET last_read_at = NEW.created_at
    WHERE conversation_id = NEW.conversation_id
      AND user_id = NEW.sender_id;

    SELECT coalesce(nullif(trim(full_name), ''), split_part(email, '@', 1), 'Someone')
    INTO sender_name
    FROM public.profiles WHERE id = NEW.sender_id;

    preview_text := CASE NEW.message_type
        WHEN 'shared_book' THEN 'shared a book: ' || coalesce(NEW.attachment_meta ->> 'title', 'Book')
        WHEN 'shared_post' THEN 'shared a post: ' || coalesce(NEW.attachment_meta ->> 'title', 'Post')
        WHEN 'shared_testimony' THEN 'shared a testimony: ' || coalesce(NEW.attachment_meta ->> 'title', 'Testimony')
        WHEN 'shared_profile' THEN 'shared a profile: ' || coalesce(NEW.attachment_meta ->> 'title', 'Account')
        ELSE coalesce(left(NEW.body, 70), 'sent you a message')
    END;

    INSERT INTO public.notifications (user_id, type, title, message, link_url)
    SELECT
        cm.user_id,
        'new_message',
        'Message from ' || sender_name,
        preview_text,
        'messages.html?c=' || NEW.conversation_id::text
    FROM public.conversation_members cm
    WHERE cm.conversation_id = NEW.conversation_id
      AND cm.user_id <> NEW.sender_id;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_chat_message_inserted ON public.chat_messages;
CREATE TRIGGER trg_on_chat_message_inserted
    AFTER INSERT ON public.chat_messages
    FOR EACH ROW EXECUTE FUNCTION public.on_chat_message_inserted();

-- 6. ENABLE SUPABASE REALTIME
DO $$
DECLARE
    tbl text;
BEGIN
    FOREACH tbl IN ARRAY ARRAY['notifications', 'chat_messages', 'conversation_members', 'conversations'] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = tbl
        ) THEN
            EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', tbl);
        END IF;
    END LOOP;
END $$;
