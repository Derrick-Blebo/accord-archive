-- ============================================================================
-- Accord Archive — Protected / Non-Downloadable & Encrypted Books Migration
-- Run this idempotent script in Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- 1. BOOKS & SUBMISSIONS COLUMNS
ALTER TABLE public.books
    ADD COLUMN IF NOT EXISTS is_downloadable boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS encrypted_url text,
    ADD COLUMN IF NOT EXISTS master_file_path text;

ALTER TABLE public.user_book_submissions
    ADD COLUMN IF NOT EXISTS is_downloadable boolean NOT NULL DEFAULT true,
    ADD COLUMN IF NOT EXISTS encrypted_url text,
    ADD COLUMN IF NOT EXISTS master_file_path text;

-- 2. BOOK ENCRYPTION KEYS TABLE
CREATE TABLE IF NOT EXISTS public.book_encryption_keys (
    book_id bigint PRIMARY KEY REFERENCES public.books(id) ON DELETE CASCADE,
    key_b64 text NOT NULL,
    algorithm text NOT NULL DEFAULT 'AES-GCM-256',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.book_encryption_keys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "book_encryption_keys_select" ON public.book_encryption_keys;
CREATE POLICY "book_encryption_keys_select"
    ON public.book_encryption_keys
    FOR SELECT
    USING (
        public.is_library_admin()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_encryption_keys.book_id
              AND (
                  b.author_id = auth.uid()
                  OR public.has_page_permission(b.author_id, auth.uid(), 'books')
                  OR (
                      b.is_visible = true
                      AND b.status = 'published'
                      AND (
                          b.is_for_sale = false
                          OR EXISTS (
                              SELECT 1 FROM public.user_purchases p
                              WHERE p.user_id = auth.uid()
                                AND p.book_id = b.id
                          )
                      )
                  )
              )
        )
    );

DROP POLICY IF EXISTS "book_encryption_keys_insert" ON public.book_encryption_keys;
CREATE POLICY "book_encryption_keys_insert"
    ON public.book_encryption_keys
    FOR INSERT
    TO authenticated
    WITH CHECK (
        public.is_library_admin()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_encryption_keys.book_id
              AND (
                  b.author_id = auth.uid()
                  OR public.has_page_permission(b.author_id, auth.uid(), 'books')
              )
        )
    );

DROP POLICY IF EXISTS "book_encryption_keys_update" ON public.book_encryption_keys;
CREATE POLICY "book_encryption_keys_update"
    ON public.book_encryption_keys
    FOR UPDATE
    TO authenticated
    USING (
        public.is_library_admin()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_encryption_keys.book_id
              AND (
                  b.author_id = auth.uid()
                  OR public.has_page_permission(b.author_id, auth.uid(), 'books')
              )
        )
    )
    WITH CHECK (
        public.is_library_admin()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_encryption_keys.book_id
              AND (
                  b.author_id = auth.uid()
                  OR public.has_page_permission(b.author_id, auth.uid(), 'books')
              )
        )
    );

DROP POLICY IF EXISTS "book_encryption_keys_delete" ON public.book_encryption_keys;
CREATE POLICY "book_encryption_keys_delete"
    ON public.book_encryption_keys
    FOR DELETE
    TO authenticated
    USING (
        public.is_library_admin()
        OR public.is_superadmin()
        OR EXISTS (
            SELECT 1 FROM public.books b
            WHERE b.id = book_encryption_keys.book_id
              AND (
                  b.author_id = auth.uid()
                  OR public.has_page_permission(b.author_id, auth.uid(), 'books')
              )
        )
    );

-- 3. PRIVATE MASTER STORAGE BUCKET (Company Vault for Original Unencrypted PDFs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('books-master', 'books-master', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "books_master_insert_authenticated" ON storage.objects;
CREATE POLICY "books_master_insert_authenticated"
    ON storage.objects
    FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'books-master');

DROP POLICY IF EXISTS "books_master_select_admin_or_owner" ON storage.objects;
CREATE POLICY "books_master_select_admin_or_owner"
    ON storage.objects
    FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'books-master'
        AND (
            public.is_library_admin()
            OR public.is_superadmin()
            OR owner = auth.uid()
        )
    );

DROP POLICY IF EXISTS "books_master_update_admin_or_owner" ON storage.objects;
CREATE POLICY "books_master_update_admin_or_owner"
    ON storage.objects
    FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'books-master'
        AND (
            public.is_library_admin()
            OR public.is_superadmin()
            OR owner = auth.uid()
        )
    );

DROP POLICY IF EXISTS "books_master_delete_admin_or_owner" ON storage.objects;
CREATE POLICY "books_master_delete_admin_or_owner"
    ON storage.objects
    FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'books-master'
        AND (
            public.is_library_admin()
            OR public.is_superadmin()
            OR owner = auth.uid()
        )
    );
