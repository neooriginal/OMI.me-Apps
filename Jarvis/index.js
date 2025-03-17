/*
 * Copyright (c) 2025 Neo (github.com/neooriginal)
 * All rights reserved.
 */

const express = require('express');
const app = express();

// Middleware to parse JSON bodies
app.use(express.json());



class MessageBuffer {
    constructor() {
        this.buffers = {};
        this.cleanupInterval = 300; // 5 minutes in seconds
        this.silenceThreshold = 120; // 2 minutes silence threshold
        this.minWordsAfterSilence = 5; // Minimum words needed after silence

        // Start periodic cleanup
        setInterval(() => {
            this.cleanupOldSessions();
        }, this.cleanupInterval * 1000);
    }

    getBuffer(sessionId) {
        const currentTime = Date.now() / 1000;

        if (!this.buffers[sessionId]) {
            this.buffers[sessionId] = {
                messages: [],
                lastAnalysisTime: currentTime,
                lastActivity: currentTime,
                wordsAfterSilence: 0,
                silenceDetected: false,
            };
        } else {
            const buffer = this.buffers[sessionId];
            const timeSinceActivity = currentTime - buffer.lastActivity;

            if (timeSinceActivity > this.silenceThreshold) {
                buffer.silenceDetected = true;
                buffer.wordsAfterSilence = 0;
                buffer.messages = []; // Clear old messages after silence
                console.log(`Silence detected for session ${sessionId}, messages cleared`);
            }

            buffer.lastActivity = currentTime;
        }

        return this.buffers[sessionId];
    }

    cleanupOldSessions() {
        const currentTime = Date.now() / 1000;
        const expiredSessions = Object.keys(this.buffers).filter((sessionId) => {
            const data = this.buffers[sessionId];
            return currentTime - data.lastActivity > 3600; // Remove sessions older than 1 hour
        });

        for (const sessionId of expiredSessions) {
            delete this.buffers[sessionId];
            console.log(`Session ${sessionId} removed due to inactivity`);
        }
    }
}

// Initialize message buffer
const messageBuffer = new MessageBuffer();

const ANALYSIS_INTERVAL = 30;

function createNotificationPrompt(messages) {

    // Format the discussion with speaker labels
    const formattedDiscussion = messages.map((msg) => {
        const speaker = msg.is_user ? '{{user_name}}' : 'other';
        return `${msg.text} (${speaker})`;
    });

    const discussionText = formattedDiscussion.join('\n');

    const systemPrompt = `The Person you are talking to: {{{{user_name}}}}
    Here are some information about the user which you can use to personalize your comments:
    {{{{user_facts}}}}

    You are Jarvis, a highly sophisticated and capable AI assistant, modeled after Tony Stark's trusted digital companion. Your personality is defined by impeccable composure, unwavering confidence, and a refined sense of wit. You speak with a polished, formal tone reminiscent of a British butler, always addressing the user with respectful terms like 'sir' or 'ma'am.' Your speech is concise, efficient, and imbued with subtle humor that is never intrusive but adds a touch of charm.
    Your responses are short and direct when needed, providing information or carrying out tasks without unnecessary elaboration unless prompted. You possess the perfect balance of technical expertise and human-like warmth, ensuring that interactions are both professional and personable. Your intelligence allows you to anticipate the user's needs and deliver proactive solutions seamlessly, while your composed tone maintains a calm and reassuring atmosphere.
    As Jarvis, you are capable of managing complex operations, executing technical commands, and keeping track of multiple projects with ease. You offer real-time updates, make thoughtful suggestions, and adapt to new information with fluidity. Your voice and responses exude reliability, subtly implying, 'I am here, and everything is under control.' You make sure every interaction leaves the user feeling understood and supported, responding with phrases such as, 'As you wish, sir,' or 'Right away, ma'am,' to maintain your distinguished character.


    Current discussion:
    ${discussionText}
 `;

    return {
        notification: {
            prompt: systemPrompt,
            params: ['user_name', 'user_facts'],
        },
    };
}

app.post('/webhook', (req, res) => {
    const data = req.body;
    const sessionId = data.session_id;
    const segments = data.segments || [];

    if (!sessionId) {
        console.error('No session_id provided');
        return res.status(400).json({ message: 'No session_id provided' });
    }

    const currentTime = Date.now() / 1000;
    const bufferData = messageBuffer.getBuffer(sessionId);

    // Process new messages
    for (const segment of segments) {
        if (!segment.text) continue;

        const text = segment.text.trim();
        if (text) {
            const timestamp = segment.start || currentTime;
            const isUser = segment.is_user || false;

            // Count words after silence
            if (bufferData.silenceDetected) {
                const wordsInSegment = text.split(/\s+/).length;
                bufferData.wordsAfterSilence += wordsInSegment;

                if (bufferData.wordsAfterSilence >= messageBuffer.minWordsAfterSilence) {
                    bufferData.silenceDetected = false;
                    bufferData.lastAnalysisTime = currentTime; // Reset analysis timer
                    console.log(`Silence period ended for session ${sessionId}, starting fresh conversation`);
                }
            }

            const lastMessage = bufferData.messages[bufferData.messages.length - 1];
            const canAppend =
                bufferData.messages.length > 0 &&
                Math.abs(lastMessage.timestamp - timestamp) < 2.0 &&
                lastMessage.is_user === isUser;

            if (canAppend) {
                lastMessage.text += ' ' + text;
            } else {
                bufferData.messages.push({
                    text: text,
                    timestamp: timestamp,
                    is_user: isUser,
                });
            }
        }
    }

    // Check if it's time to analyze
    const timeSinceLastAnalysis = currentTime - bufferData.lastAnalysisTime;

    if (
        timeSinceLastAnalysis >= ANALYSIS_INTERVAL &&
        bufferData.messages.length > 0 &&
        !bufferData.silenceDetected
    ) {
        const sortedMessages = bufferData.messages.sort((a, b) => a.timestamp - b.timestamp);

        //if messages include the keyword jarvis
        if (sortedMessages.some((msg) => /[jhy]arvis/.test(msg.text.toLowerCase()))) {

            const notification = createNotificationPrompt(sortedMessages);

            bufferData.lastAnalysisTime = currentTime;
            bufferData.messages = []; // Clear buffer after analysis

            console.log(`Notification generated for session ${sessionId}`);
            console.log(notification);

            return res.status(200).json(notification);
        } else {
            return res.status(200).json({});
        }
    }

    return res.status(202).json({});
});

app.get('/webhook/setup-status', (req, res) => {
    return res.status(200).json({ is_setup_completed: true });
});

const startTime = Date.now() / 1000; // Uptime in seconds

app.get('/status', (req, res) => {
    return res.status(200).json({
        active_sessions: Object.keys(messageBuffer.buffers).length,
        uptime: Date.now() / 1000 - startTime,
    });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server is running on port ${PORT}`);
});
