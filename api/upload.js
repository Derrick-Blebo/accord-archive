import { google } from 'googleapis';
import formidable from 'formidable';
import fs from 'fs';

// Disable Vercel's default body parser so formidable can process the raw file stream
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

        // Handle Formidable v2 vs v3 payload structures
        const uploadedFile = Array.isArray(files.file) ? files.file[0] : files.file;

        if (!uploadedFile) {
            return res.status(400).json({ error: 'No file detected' });
        }

        try {
            // 1. Authenticate using your Service Account credentials
            const auth = new google.auth.GoogleAuth({
                credentials: {
                    client_email: process.env.GOOGLE_CLIENT_EMAIL,
                    // Vercel environment variables sometimes escape line breaks; this fixes them
                    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
                },
                scopes: ['https://www.googleapis.com/auth/drive.file'],
            });

            const drive = google.drive({ version: 'v3', auth });

            // 2. Upload the file stream to Google Drive
            const response = await drive.files.create({
                requestBody: {
                    name: uploadedFile.originalFilename || uploadedFile.name || 'Accord_Archive_Document.pdf',
                    parents: [process.env.GOOGLE_DRIVE_FOLDER_ID], 
                },
                media: {
                    mimeType: uploadedFile.mimetype,
                    body: fs.createReadStream(uploadedFile.filepath),
                },
                fields: 'id, webContentLink',
            });

            const fileId = response.data.id;

            // 3. Set Drive permissions so anyone with the link can download the file
            await drive.permissions.create({
                fileId: fileId,
                requestBody: { role: 'reader', type: 'anyone' },
            });

            // 4. Return the direct download link back to your frontend
            return res.status(200).json({ downloadUrl: response.data.webContentLink });

        } catch (error) {
            console.error('Drive Upload Error:', error);
            return res.status(500).json({ error: 'Upload to Google Drive failed' });
        }
    });
}