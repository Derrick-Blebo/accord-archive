import { Storage } from 'megajs';
import formidable from 'formidable';
import fs from 'fs';

export const config = {
    api: {
        bodyParser: false,
    },
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const form = formidable({ keepExtensions: true });

    form.parse(req, async (err, fields, files) => {
        if (err) {
            console.error("Form parsing error:", err);
            return res.status(500).json({ error: 'Error parsing file upload' });
        }

        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file detected' });
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

            const originalName = uploadedFile.originalFilename || 'document.pdf';
            const lastDotIndex = originalName.lastIndexOf('.');
            const nameWithoutExt = lastDotIndex !== -1 ? originalName.substring(0, lastDotIndex) : originalName;
            const fileExtension = lastDotIndex !== -1 ? originalName.substring(lastDotIndex) : '.pdf';
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
        }
    });
}