const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Install with: npm install node-fetch@2
require('dotenv').config();

const app = express();

// 1. Middleware
app.use(express.json());
app.use(cors()); // Allows your frontend to communicate with this server

// 2. Health Check (Optional: helps Render keep the service active)
app.get('/', (req, res) => {
    res.send('Joes AI Backend is running.');
});

// 3. Admin Verification Route
// This keeps your admin email hidden from the public frontend code
app.post('/api/check-admin', (req, res) => {
    const { email } = req.body;
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

    if (!email || !ADMIN_EMAIL) {
        return res.json({ isAdmin: false });
    }

    // Case-insensitive comparison
    if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
        res.json({ isAdmin: true });
    } else {
        res.json({ isAdmin: false });
    }
});

// 4. The Groq Proxy Route
app.post('/api/chat', async (req, res) => {
    const { messages, model, temperature, max_tokens } = req.body;
    const GROQ_API_KEY = process.env.GROQ_API_KEY;

    if (!GROQ_API_KEY) {
        console.error("Missing GROQ_API_KEY in environment variables");
        return res.status(500).json({ error: "Server error: API Key not configured." });
    }

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: model || 'llama-3.1-8b-instant',
                messages: messages,
                temperature: temperature || 0.7,
                max_tokens: max_tokens || 1000
            })
        });

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('Proxy Error:', error);
        res.status(500).json({ error: 'Failed to communicate with Groq.' });
    }
});

// 5. Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
