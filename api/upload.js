import { Storage } from 'megajs';
import formidable from 'formidable';
import fs from 'fs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mzblgajftvyyosyrawcx.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16YmxnYWpmdHZ5eW9zeXJhd2N4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ0NzYxNTQsImV4cCI6MjExMDA1MjE1NH0.Xs9MeioNfqb5DzxDYP-9ZqfywBeOlUreAY-yKrcBmJM';
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.epub', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp3', '.mp4', '.m4a', '.wav', '.doc', '.docx']);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

export const config = {
    api: {
        bodyParser: false,
    },
};

async function verifyAuthenticatedUser(authHeader) {
    const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return null;
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`
        }
    });
    if (!resp.ok) return null;
    return await resp.json();
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const user = await verifyAuthenticatedUser(req.headers.authorization);
    if (!user?.id) {
        return res.status(401).json({ error: 'Authentication required to upload files.' });
    }

    const form = formidable({
        keepExtensions: true,
        maxFileSize: MAX_UPLOAD_BYTES,
        multiples: false
    });

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error("Form parsing error:", err);
            const status = err.code === 1009 ? 413 : 400;
            return res.status(status).json({ error: err.code === 1009 ? 'File exceeds 50 MB limit.' : 'Error parsing file upload.' });
        }

        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file detected' });
        }

        const originalName = uploadedFile.originalFilename || 'document.pdf';
        const lastDotIndex = originalName.lastIndexOf('.');
        const fileExtension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex).toLowerCase() : '.pdf';
        if (!ALLOWED_EXTENSIONS.has(fileExtension)) {
            try { fs.unlinkSync(uploadedFile.filepath); } catch {}
            return res.status(400).json({ error: 'Unsupported file type.' });
        }

        try {
            // 1. Authenticate with Mega using your environment variables
            const megaStorage = new Storage({
                email: process.env.MEGA_EMAIL,
                password: process.env.MEGA_PASSWORD
            });

            await new Promise((resolve, reject) => {
                megaStorage.on('ready', resolve);
                megaStorage.on('error', reject);
            });

            const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
            const cleanName = nameWithoutExt.replace(/[^a-zA-Z0-9._-]/g, "_");
            const fileName = `${cleanName}_acc${Date.now()}${fileExtension}`;
            const stats = fs.statSync(uploadedFile.filepath);

            // 2. Stream the file directly into Mega
            const fileStream = fs.createReadStream(uploadedFile.filepath);
            const uploadStream = megaStorage.upload({
                name: fileName,
                size: stats.size
            });

            fileStream.pipe(uploadStream);

            const uploadedMegaFile = await new Promise((resolve, reject) => {
                uploadStream.on('complete', resolve);
                uploadStream.on('error', reject);
            });

            // 3. Generate public download link
            const downloadUrl = await uploadedMegaFile.link();

            // 4. Return the direct URL to your admin frontend
            return res.status(200).json({ downloadUrl });

        } catch (error) {
            console.error('Mega Upload Error:', error);
            return res.status(500).json({ error: error.message || 'Upload to Mega failed' });
        } finally {
            try { fs.unlinkSync(uploadedFile.filepath); } catch {}
        }
    });
}