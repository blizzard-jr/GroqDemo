import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import multer from 'multer';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs-extra';
import FormData from 'form-data';
import formidable from 'formidable';
import Busboy from 'busboy';
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

// Функция для отправки запроса к Whisper API
async function sendToWhisper(audioPath, audioMimetype = 'audio/wav') {
  console.log('Вызов функции sendToWhisper с файлом:', audioPath);
  
  try {
    // Создаем форму с помощью FormData
    const form = new FormData();
    
    // Читаем файл в буфер
    const fileBuffer = await fs.readFile(audioPath);
    
    // Добавляем файл в форму
    form.append('file', new Blob([fileBuffer]), {
      filename: path.basename(audioPath),
      contentType: audioMimetype
    });
    
    // Добавляем модель
    form.append('model', WHISPER_MODEL_ID);
    
    // Делаем запрос к API Whisper
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: form
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Whisper API Error:', errorData);
      throw new Error(errorData.error?.message || `Ошибка API: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error in sendToWhisper:', error);
    throw error;
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
      },
      body: formData
    });
    
    // Получаем и проверяем ответ
    const whisperData = await whisperResponse.json();
    
    if (!whisperResponse.ok) {
      console.error('Whisper API Error:', whisperData);
      // Добавим больше информации об ошибке
      console.error('Статус ответа:', whisperResponse.status);
      console.error('Заголовки ответа:', whisperResponse.headers);
      
      // Если ошибка 404 (Not Found), это может быть связано с неправильным URL или моделью
      if (whisperResponse.status === 404) {
        console.error('Ошибка 404: Проверьте правильность URL и доступность модели:', WHISPER_MODEL_ID);
        
        // Проверим, не устарела ли модель или API
        return res.status(500).json({
          error: 'Модель не найдена. Возможно, модель устарела или API изменился. Проверьте актуальность API и названия модели.'
        });
      }
      
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

// API route для отправки аудио запросов на Vercel без использования файловой системы
app.post('/api/audio-alt', async (req, res) => {
  try {
    console.log('Получен запрос на /api/audio-alt');
    
    // Проверяем, что у нас multipart/form-data
    if (!req.headers['content-type']?.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Ожидается multipart/form-data' });
    }
    
    // Создаем парсер для multipart/form-data
    const busboy = Busboy({ headers: req.headers });
    
    // Переменные для хранения данных
    let audioFile = null;
    let modelName = WHISPER_MODEL_ID; // По умолчанию используем модель из конфига
    
    // Обработка полей формы
    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'model') {
        modelName = val;
      }
    });
    
    // Обработка файлов
    busboy.on('file', async (fieldname, file, info) => {
      if (fieldname === 'audio') {
        const { filename, encoding, mimeType } = info;
        console.log(`Получен файл: ${filename}, тип: ${mimeType}`);
        
        // Собираем файл в буфер
        const chunks = [];
        file.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        // Когда файл полностью получен
        file.on('end', () => {
          audioFile = Buffer.concat(chunks);
          console.log(`Файл получен, размер: ${audioFile.length} байт`);
        });
      }
    });
    
    // После полной обработки формы
    busboy.on('finish', async () => {
      try {
        if (!audioFile) {
          return res.status(400).json({ error: 'Аудиофайл не найден в запросе' });
        }
        
        console.log('Отправляем аудио в Whisper API...');
        
        // Создаем новый FormData для отправки в API
        const formData = new FormData();
        formData.append('file', audioFile, {
          filename: 'audio.wav',
          contentType: 'audio/wav'
        });
        formData.append('model', modelName);
        
        const whisperResponse = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${GROQ_API_KEY}`,
            // Headers для form-data добавятся автоматически
          },
          body: formData
        });
        
        const whisperData = await whisperResponse.json();
        
        if (!whisperResponse.ok) {
          console.error('Whisper API Error:', whisperData);
          // Добавим больше информации об ошибке
          console.error('Статус ответа:', whisperResponse.status);
          console.error('Заголовки ответа:', whisperResponse.headers);
          
          // Если ошибка 404 (Not Found), это может быть связано с неправильным URL или моделью
          if (whisperResponse.status === 404) {
            console.error('Ошибка 404: Проверьте правильность URL и доступность модели:', WHISPER_MODEL_ID);
            
            // Проверим, не устарела ли модель или API
            return res.status(500).json({
              error: 'Модель не найдена. Возможно, модель устарела или API изменился. Проверьте актуальность API и названия модели.'
            });
          }
          
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
        console.error('Error processing audio:', error);
        res.status(500).json({ error: 'Ошибка при обработке аудио: ' + error.message });
      }
    });
    
    // Обработка ошибок
    busboy.on('error', (error) => {
      console.error('Busboy error:', error);
      res.status(500).json({ error: 'Ошибка при обработке формы: ' + error.message });
    });
    
    // Запускаем обработку
    req.pipe(busboy);
    
  } catch (error) {
    console.error('Audio-Alt Route Error:', error);
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