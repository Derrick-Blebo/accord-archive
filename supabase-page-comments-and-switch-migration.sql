-- ============================================================================
-- Accord Archive — Page-Attributed Comments for Switched Page Admins
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

ALTER TABLE public.post_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can insert post comments" ON public.post_comments;
CREATE POLICY "Authenticated users can insert post comments"
    ON public.post_comments
    FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() IS NOT NULL
        AND (user_id IS NULL OR user_id = auth.uid())
        AND (
            author_id IS NULL
            OR author_id = auth.uid()
            OR public.has_page_permission(author_id, auth.uid(), 'can_post')
        )
    );

DROP POLICY IF EXISTS "Users can delete own post comments" ON public.post_comments;
CREATE POLICY "Users can delete own post comments"
    ON public.post_comments
    FOR DELETE
    TO authenticated
    USING (
        auth.uid() = user_id
        OR auth.uid() = author_id
        OR public.has_page_permission(author_id, auth.uid(), 'can_edit_delete_posts')
        OR public.is_superadmin()
    );
