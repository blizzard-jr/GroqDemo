import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import FormData from 'form-data';
import formidable from 'formidable';
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

    console.log('Аудиофайл получен:', req.file);
    const audioFilePath = req.file.path;
    
    // Создаем новый FormData вручную
    const formData = new FormData();
    
    // Добавляем файл как поток с readStream
    const fileStream = fs.createReadStream(audioFilePath);
    formData.append('file', fileStream, {
      filename: path.basename(audioFilePath),
      contentType: req.file.mimetype
    });
    
    // Добавляем название модели
    formData.append('model', WHISPER_MODEL_ID);
    
    console.log('Отправляем запрос к Whisper API');
    
    // Отправляем запрос к API
    const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
        // headers добавятся автоматически через form-data
      },
      body: formData
    });
    
    // Получаем и проверяем ответ
    const whisperData = await whisperResponse.json();
    
    if (!whisperResponse.ok) {
      console.error('Whisper API Error:', whisperData);
      return res.status(whisperResponse.status).json({ 
        error: whisperData.error?.message || 'Ошибка при обращении к API Whisper' 
      });
    }
    
    console.log('Получен ответ от Whisper API:', whisperData);
    const transcribedText = whisperData.text;
    
    // Отправляем транскрибированный текст к LLM модели
    const llmResult = await sendToLLM(transcribedText);
    
    if (llmResult.success) {
      res.json({
        transcribedText: transcribedText,
        llmResponse: llmResult.text,
        model: llmResult.model,
        usage: llmResult.usage
      });
    } else {
      res.status(500).json({ error: llmResult.error });
    }
  } catch (error) {
    console.error('Audio Processing Error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка при обработке аудио: ' + error.message });
  }
});

// Альтернативный API route для аудио с использованием formidable
app.post('/api/audio-alt', async (req, res) => {
  try {
    console.log('Получен запрос на /api/audio-alt');
    
    // Создаем форму с помощью formidable
    const form = formidable({
      uploadDir: path.join(__dirname, 'public', 'uploads'),
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024 // 10MB
    });
    
    // Парсим форму
    form.parse(req, async (err, fields, files) => {
      if (err) {
        console.error('Formidable error:', err);
        return res.status(500).json({ error: 'Ошибка при обработке формы: ' + err.message });
      }
      
      const audioFile = files.audio?.[0];
      if (!audioFile) {
        return res.status(400).json({ error: 'Аудиофайл обязателен' });
      }
      
      console.log('Аудиофайл получен:', audioFile.originalFilename);
      
      try {
        // Создаем новый FormData для отправки в Groq API
        const formData = new FormData();
        
        // Добавляем файл
        const fileStream = fs.createReadStream(audioFile.filepath);
        formData.append('file', fileStream, {
          filename: audioFile.originalFilename || 'audio.wav',
          contentType: audioFile.mimetype || 'audio/wav'
        });
        
        // Добавляем модель
        formData.append('model', WHISPER_MODEL_ID);
        
        console.log('Отправляем запрос к Whisper API');
        
        // Отправляем запрос
        const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`
          },
          body: formData
        });
        
        const whisperData = await whisperResponse.json();
        
        if (!whisperResponse.ok) {
          console.error('Whisper API Error:', whisperData);
          return res.status(whisperResponse.status).json({ 
            error: whisperData.error?.message || 'Ошибка при обращении к API Whisper' 
          });
        }
        
        console.log('Получен ответ от Whisper API:', whisperData);
        const transcribedText = whisperData.text;
        
        // Отправляем транскрибированный текст к LLM модели
        const llmResult = await sendToLLM(transcribedText);
        
        if (llmResult.success) {
          res.json({
            transcribedText: transcribedText,
            llmResponse: llmResult.text,
            model: llmResult.model,
            usage: llmResult.usage
          });
        } else {
          res.status(500).json({ error: llmResult.error });
        }
      } catch (error) {
        console.error('Processing Error:', error);
        res.status(500).json({ error: 'Ошибка при обработке аудио: ' + error.message });
      }
    });
  } catch (error) {
    console.error('Audio-Alt Error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера: ' + error.message });
  }
});

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Обработчик ошибок
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
    stack: process.env.NODE_ENV === 'production' ? undefined : err.stack
  });
});

// Создадим директорию для загрузок, если её нет
try {
  fs.ensureDirSync(path.join(__dirname, 'public', 'uploads'));
  console.log('Директория uploads создана или уже существует');
} catch (error) {
  console.error('Ошибка при создании директории uploads:', error);
}

app.listen(PORT, () => {
  console.log(`Сервер запущен на порту ${PORT}`);
}); 