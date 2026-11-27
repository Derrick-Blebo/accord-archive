-- Accord Music Hub Migration
-- Ensures authenticated users can upload artist spotlight cover art to archive-files/music-covers/
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'Authenticated users can upload music covers'
    ) THEN
        CREATE POLICY "Authenticated users can upload music covers"
            ON storage.objects
            FOR INSERT
            TO authenticated
            WITH CHECK (
                bucket_id = 'archive-files'
                AND name LIKE 'music-covers/%'
            );
    END IF;
END $$;
