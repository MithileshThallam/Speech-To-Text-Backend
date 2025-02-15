import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { createClient as createDeepgramClient } from '@deepgram/sdk';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

dotenv.config();
const app = express();
app.use(cors())
;app.use(express.json());

// Initialize Deepgram
const deepgram = createDeepgramClient({
    apiKey: process.env.DEEPGRAM_API_KEY,
});

// Initialize Supabase
const supabase = createSupabaseClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Multer Setup for File Uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// ✅ Signup Endpoint (with password hashing)
app.post('/signup', async (req, res) => {
    try {
        const { email, password, name } = req.body;

        const { data: existingUser, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }

        
        const hashedPassword = await bcrypt.hash(password, 10);

        const { data: newUser, error: insertError } = await supabase
            .from('users')
            .insert([{ email, password: hashedPassword, name }]) // Store hashed password
            .single();

        if (insertError) throw insertError;

        res.json({ message: 'Signup successful!', user: newUser });
    } catch (error) {
        res.status(500).json({ error: 'Error during signup', details: error.message });
    }
});

// ✅ Login Endpoint (with password verification)
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        const { data: user, error: userError } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();

        if (!user) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ error: 'Invalid email or password' });
        }

        // ✅ Return user data (without password)
        res.json({ success: true, message: 'Login successful!', user: { id: user.id, email: user.email, name: user.name } });
    } catch (error) {
        res.status(500).json({ error: 'Error during login', details: error.message });
    }
});


// ✅ Upload Audio to Supabase
app.post('/upload', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        console.log("🔄 Uploading file to Supabase...");

        // Upload audio to Supabase Storage
        const { data, error } = await supabase.storage
            .from(process.env.SUPABASE_BUCKET)
            .upload(`audio/${Date.now()}_${req.file.originalname}`, req.file.buffer, {
                contentType: req.file.mimetype,
            });

        if (error) return res.status(500).json({ error: 'Failed to upload to Supabase', details: error.message });

        // Get the public URL
        const { publicUrl } = supabase.storage.from(process.env.SUPABASE_BUCKET).getPublicUrl(data.path);

        console.log("✅ File uploaded successfully:", publicUrl);

        res.json({ message: 'Audio uploaded successfully!', fileURL: publicUrl });
    } catch (error) {
        res.status(500).json({ error: 'Error uploading audio', details: error.message });
    }
});

// ✅ Transcribe Audio and Save Transcription
app.post('/transcribe', upload.single('audio'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { userId } = req.body; // Get userId from the request body

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        // ✅ Validate UUID format (Fix for invalid input syntax error)
        const uuidRegex = /^[0-9a-fA-F-]{36}$/;
        if (!uuidRegex.test(userId)) {
            return res.status(400).json({ error: 'Invalid UUID format for userId' });
        }

        console.log("🔄 Sending file to Deepgram...");

        // ✅ Transcribe audio using Deepgram
        const { result, error } = await deepgram.listen.prerecorded.transcribeFile(
            req.file.buffer,
            {
                model: "nova-3",
                smart_format: true,
                mimetype: req.file.mimetype,
            }
        );

        if (error) {
            console.error("❌ Deepgram Error:", error);
            throw new Error("Failed to transcribe audio.");
        }

        const transcript = result?.results?.channels[0]?.alternatives[0]?.transcript || 'No transcript available';

        console.log("✅ Transcription successful:", transcript);

        // ✅ Save transcription to Supabase
        const { data: savedTranscription, error: saveError } = await supabase
            .from('transcriptions')
            .insert([{ 
                user_id: userId, 
                transcript, 
                file_url: req.file.originalname || "unknown_filename" 
            }])
            .single();

        if (saveError) {
            console.error("❌ Supabase Insert Error:", saveError);
            throw new Error("Failed to save transcription.");
        }

        res.json({ 
            message: 'Transcription successful!', 
            transcript, 
            savedTranscription 
        });

    } catch (error) {
        console.error("❌ Error:", error.message);
        res.status(500).json({ error: 'Error transcribing audio', details: error.message });
    }
});
app.get('/transcriptions/:userId', async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const { data: transcriptions, error } = await supabase
            .from('transcriptions')
            .select("transcript, file_url")  // ✅ Include file_url
            .eq("user_id", userId);

        if (error) {
            console.error("Supabase Error:", error);
            return res.status(500).json({ error: 'Database query failed', details: error.message });
        }

        return res.json({ success: true, transcriptions });
    } catch (error) {
        console.error("Server Error:", error);
        return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
});
app.get('/',(req,res)=>{
    res.json("Server is live and running on port 5500")
})



// Start the Server
const PORT = process.env.PORT || 5500;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
