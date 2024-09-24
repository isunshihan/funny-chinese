require('dotenv').config(); // 如果使用环境变量管理敏感信息
const express = require('express');
const bodyParser = require('body-parser');
const { Readable } = require('stream');
const fetch = global.fetch;
const cors = require('cors'); // 引入cors模块
const readline = require('readline');
const https = require('https');

// 配置常量和凭证
const BaseUrl = 'https://api.coze.com';
const apiKey = process.env.COZE_API_KEY || 'your_api_key';
const botId = process.env.COZE_BOT_ID || 'your_bot_id';
const userId = '1234567890';

const app = express();
app.use(express.json());
app.use(cors()); // 使用cors中间件
app.use(bodyParser.json());

/**
 * 主函数，执行创建会话和发送消息的流程
 */
async function go() {
    try {
        const conversationId = await createConversation();
        if (conversationId) {
            await createMessage(conversationId, 'What day is it today');
        } else {
            console.error('创建会话失败。');
        }
    } catch (error) {
        console.error(`执行go函数时出错: ${error.message}`);
    }
}

/**
 * 创建一个新的会话
 * @returns {Promise<string|null>} 会话ID或null
 */
async function createConversation() {
    const url = `${BaseUrl}/v1/conversation/create`;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP错误! 状态: ${response.status}, 信息: ${errorText}`);
        }

        const json = await response.json();
        const conversationId = json?.data?.id;

        if (conversationId) {
            console.log(`会话创建成功。会话ID: ${conversationId}`);
            return conversationId;
        } else {
            throw new Error('响应中未找到会话ID。');
        }
    } catch (error) {
        console.error(`创建会话请求失败: ${error.message}`);
        return null;
    }
}

/**
 * 发送消息到指定会话（流式响应）
 * @param {string} conversationId - 会话ID
 * @param {string} content - 消息内容
 * @param {string} [role='user'] - 消息角色
 * @param {string} [contentType='text'] - 消息类型
 * @returns {Promise<string>} 汇总后的消息内容
 */
async function createMessage(conversationId, content, role = 'user', contentType = 'text') {
    const url = `${BaseUrl}/v3/chat?conversation_id=${conversationId}`;

    const payload = {
        bot_id: botId,
        user_id: userId,
        stream: true,
        auto_save_history: true,
        additional_messages: [
            {
                role: role,
                content: content,
                content_type: contentType
            }
        ]
    };

    return new Promise((resolve, reject) => {
        const data = JSON.stringify(payload);

        const options = {
            hostname: 'api.coze.com',
            port: 443,
            path: `/v3/chat?conversation_id=${conversationId}`,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(data)
            }
        };

        const request = https.request(options, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`请求失败，状态码: ${response.statusCode}`));
                return;
            }

            let currentEvent = '';
            const messageChunks = [];

            const rl = readline.createInterface({
                input: response,
                crlfDelay: Infinity
            });

            rl.on('line', (line) => {
                if (line.startsWith('event:')) {
                    currentEvent = line.replace('event:', '').trim();
                } else if (line.startsWith('data:')) {
                    const dataStr = line.replace('data:', '').trim();

                    if (currentEvent === 'conversation.message.delta') {
                        try {
                            const jsonData = JSON.parse(dataStr);
                            if (jsonData.content) {
                                messageChunks.push(jsonData.content);
                            }
                        } catch (err) {
                            console.error('解析数据时出错:', err.message);
                        }
                    }
                }
            });

            rl.on('close', () => {
                console.log('消息处理完成。');
                const completeMessage = messageChunks.join('');
                resolve(completeMessage);
            });
        });

        request.on('error', (error) => {
            console.error('请求时出错:', error);
            reject(error);
        });

        request.write(data);
        request.end();
    });
}

app.post('/chat', async (req, res) => {
    try {
        console.log('Received request:', req.body);

        const { message } = req.body;
        if (!message) {
            console.log('Message is empty');
            return res.status(400).json({ error: '消息不能为空' });
        }

        console.log('Creating conversation...');
        const conversationId = await createConversation();
        if (!conversationId) {
            console.log('Failed to create conversation');
            return res.status(500).json({ error: '创建会话失败' });
        }

        console.log('Creating message...');
        const response = await createMessage(conversationId, message);
        console.log('Message created successfully');

        res.json({ response });
    } catch (error) {
        console.error(`处理请求时出错: ${error.message}`);
        res.status(500).json({ error: '内部服务器错误' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器运行在端口 ${PORT}`);
});
