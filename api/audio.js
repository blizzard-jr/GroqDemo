import Busboy from 'busboy';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { GROQ_API_KEY, MODEL_ID, WHISPER_MODEL_ID } from '../config.js';

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

// API route для обработки аудио запросов
export default async function handler(req, res) {
  // Только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешен' });
  }

  console.log('Получен запрос на /api/audio');
  
  // Проверяем, что у нас multipart/form-data
  if (!req.headers['content-type']?.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'Ожидается multipart/form-data' });
  }
  
  try {
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
    console.error('Audio Route Error:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера: ' + error.message });
  }
} 