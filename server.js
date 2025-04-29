import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import FormData from 'form-data';
import { GROQ_API_KEY, MODEL_ID, WHISPER_MODEL_ID } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка хранилища для multer (загрузка файлов)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, 'public', 'uploads'));
  },
  filename: function (req, file, cb) {
    // Создаем уникальное имя файла
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'audio-' + uniqueSuffix + ext);
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Ограничение размера файла (10МБ)
  fileFilter: (req, file, cb) => {
    // Проверяем тип файла
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Только аудиофайлы разрешены!'), false);
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Функция для отправки запроса к LLM модели
async function sendToLLM(prompt) {
  try {
    const response = await fetch(`https://api.groq.com/openai/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 1000
      })
    });

    const data = await response.json();
    
    if (response.ok) {
      return {
        success: true,
        text: data.choices[0].message.content,
        model: data.model,
        usage: data.usage
      };
    } else {
      return {
        success: false,
        error: data.error?.message || 'Ошибка при обращении к API Groq'
      };
    }
  } catch (error) {
    console.error('LLM Error:', error);
    return {
      success: false,
      error: 'Внутренняя ошибка сервера при обработке запроса LLM'
    };
  }
}

// API route для отправки текстовых запросов к Groq
app.post('/api/chat', async (req, res) => {
  try {
    const { prompt } = req.body;
    
    if (!prompt) {
      return res.status(400).json({ error: 'Текст запроса обязателен' });
    }

    const result = await sendToLLM(prompt);
    
    if (result.success) {
      res.json({ 
        text: result.text,
        model: result.model,
        usage: result.usage
      });
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});

// API route для отправки аудио запросов
app.post('/api/audio', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Аудиофайл обязателен' });
    }

    const audioFilePath = req.file.path;
    const audioFileUrl = `${req.protocol}://${req.get('host')}/uploads/${path.basename(audioFilePath)}`;
    
    // Отправляем запрос к модели Whisper для транскрипции
    const formData = new FormData();
    formData.append('file', fs.createReadStream(audioFilePath));
    formData.append('model', WHISPER_MODEL_ID);
    
    // Получаем заголовки из FormData
    const formHeaders = formData.getHeaders ? formData.getHeaders() : {};
    
    const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        ...formHeaders
      },
      body: formData
    });
    
    const whisperData = await whisperResponse.json();
    
    if (!whisperResponse.ok) {
      return res.status(whisperResponse.status).json({ 
        error: whisperData.error?.message || 'Ошибка при обращении к API Whisper' 
      });
    }
    
    const transcribedText = whisperData.text;
    
    // Отправляем транскрибированный текст к LLM модели
    const llmResult = await sendToLLM(transcribedText);
    
    if (llmResult.success) {
      res.json({
        transcribedText: transcribedText,
        llmResponse: llmResult.text,
        audioUrl: audioFileUrl,
        model: llmResult.model,
        usage: llmResult.usage
      });
    } else {
      res.status(500).json({ error: llmResult.error });
    }
  } catch (error) {
    console.error('Audio Processing Error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка при обработке аудио' });
  }
});

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
}); 