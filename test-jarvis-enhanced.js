#!/usr/bin/env node

/**
 * Test script for enhanced JARVIS with all 4 context variables
 * This simulates what the OMI app would send with the new variables
 */

const https = require('https');

// Test configuration
const WEBHOOK_URL = 'https://jarvis-app-k4xoe.ondigitalocean.app/webhook';
const SESSION_ID = `test-enhanced-${Date.now()}`;

// Simulate a conversation that triggers JARVIS after 30+ seconds
async function sendWebhookRequest(segments, sessionId) {
    const data = JSON.stringify({
        session_id: sessionId,
        segments: segments
    });

    return new Promise((resolve, reject) => {
        const url = new URL(WEBHOOK_URL);
        const options = {
            hostname: url.hostname,
            port: 443,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const req = https.request(options, (res) => {
            let responseBody = '';
            
            res.on('data', (chunk) => {
                responseBody += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    body: responseBody ? JSON.parse(responseBody) : {}
                });
            });
        });

        req.on('error', reject);
        req.write(data);
        req.end();
    });
}

async function testEnhancedJarvis() {
    console.log('🤖 Testing Enhanced JARVIS with 4 Context Variables\n');
    console.log('Session ID:', SESSION_ID);
    console.log('=' .repeat(60));

    // Step 1: Initial conversation to build context
    console.log('\n📤 Sending initial conversation (building context)...');
    
    const initialSegments = [
        { text: "Hey, I've been working on my AI project", is_user: true, start: 1 },
        { text: "The memory visualization is getting complex", is_user: true, start: 2 },
        { text: "I need to optimize the performance", is_user: true, start: 3 }
    ];
    
    let response = await sendWebhookRequest(initialSegments, SESSION_ID);
    console.log('Response Code:', response.statusCode);
    console.log('Response Body:', JSON.stringify(response.body, null, 2));

    // Step 2: Wait a moment then trigger JARVIS
    console.log('\n⏳ Waiting 2 seconds...\n');
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('📤 Sending JARVIS trigger with context request...');
    
    const jarvisSegments = [
        { text: "Jarvis, can you help me understand the best approach?", is_user: true, start: 35 },
        { text: "I need your expertise on optimization strategies", is_user: true, start: 36 }
    ];
    
    response = await sendWebhookRequest(jarvisSegments, SESSION_ID);
    console.log('Response Code:', response.statusCode);
    console.log('Response Body:', JSON.stringify(response.body, null, 2));

    // Step 3: Check if response includes notification with params
    console.log('\n' + '=' .repeat(60));
    console.log('📊 ANALYSIS:');
    
    if (response.body && response.body.notification) {
        const notification = response.body.notification;
        console.log('\n✅ Notification Generated!');
        
        if (notification.params) {
            console.log('\n📋 Parameters Expected by JARVIS:');
            notification.params.forEach((param, index) => {
                console.log(`  ${index + 1}. ${param}`);
            });
            
            // Check if all 4 variables are present
            const expectedParams = ['user_name', 'user_facts', 'user_conversations', 'user_chat'];
            const hasAllParams = expectedParams.every(param => notification.params.includes(param));
            
            if (hasAllParams) {
                console.log('\n🎉 SUCCESS: All 4 context variables are configured!');
                console.log('   ✓ user_name');
                console.log('   ✓ user_facts');
                console.log('   ✓ user_conversations (NEW)');
                console.log('   ✓ user_chat (NEW)');
            } else {
                console.log('\n⚠️  WARNING: Not all context variables are present');
                const missing = expectedParams.filter(p => !notification.params.includes(p));
                if (missing.length > 0) {
                    console.log('   Missing:', missing.join(', '));
                }
            }
            
            // Show prompt preview (first 200 chars)
            if (notification.prompt) {
                console.log('\n📝 Prompt Preview (first 200 chars):');
                console.log(notification.prompt.substring(0, 200) + '...');
                
                // Check if new context sections are in prompt
                const hasConversationsSection = notification.prompt.includes('{{user_conversations}}');
                const hasChatSection = notification.prompt.includes('{{user_chat}}');
                
                console.log('\n🔍 Prompt Template Check:');
                console.log(`   ${hasConversationsSection ? '✓' : '✗'} Contains {{user_conversations}} placeholder`);
                console.log(`   ${hasChatSection ? '✓' : '✗'} Contains {{user_chat}} placeholder`);
            }
        }
    } else if (response.statusCode === 202) {
        console.log('\n⏳ Response accepted but no notification generated');
        console.log('   (This is normal if conversation < 30 seconds or "jarvis" not mentioned)');
    } else {
        console.log('\n❌ Unexpected response format');
    }
    
    console.log('\n' + '=' .repeat(60));
    console.log('✅ Test Complete!\n');
}

// Run the test
testEnhancedJarvis().catch(console.error);