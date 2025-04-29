import Busboy from 'busboy';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Blob } from 'fetch-blob';
import { File, fileFromSync } from 'formdata-node';
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

// Функция для отправки запроса к API Whisper
async function transcribeAudio(audioBuffer, mimeType = 'audio/wav') {
  console.log('Начинаю транскрибцию аудио, размер:', audioBuffer.length);
  
  try {
    // Создаем multipart/form-data запрос вручную
    const form = new FormData();
    
    // Создаем Blob из буфера
    const blob = new Blob([audioBuffer], { type: mimeType });
    
    // Добавляем данные в форму
    form.append('file', blob, 'recording.wav');
    form.append('model', WHISPER_MODEL_ID);
    
    // Получаем заголовки формы
    const formHeaders = form.getHeaders ? form.getHeaders() : {};
    
    // Делаем запрос
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`,
        ...formHeaders
      },
      body: form
    });
    
    if (!response.ok) {
      const data = await response.json();
      console.error('Whisper API Error:', response.status, data);
      throw new Error(data.error?.message || `Error from Whisper API: ${response.status}`);
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Transcription error:', error);
    throw error;
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
    let audioBuffer = null;
    let audioMimeType = 'audio/wav';
    
    // Обработка полей формы
    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'model') {
        // На всякий случай сохраняем, но используем константу из конфига
        console.log('Получена модель:', val);
      }
    });
    
    // Обработка файлов
    busboy.on('file', (fieldname, file, info) => {
      if (fieldname === 'audio') {
        const { filename, encoding, mimeType } = info;
        audioMimeType = mimeType || 'audio/wav';
        console.log(`Получен файл: ${filename}, тип: ${audioMimeType}`);
        
        // Собираем файл в буфер
        const chunks = [];
        let fileSize = 0;
        
        file.on('data', (chunk) => {
          chunks.push(chunk);
          fileSize += chunk.length;
        });
        
        // Когда файл полностью получен
        file.on('end', () => {
          audioBuffer = Buffer.concat(chunks);
          console.log(`Файл получен, размер: ${audioBuffer.length} байт`);
        });
      }
    });
    
    // После полной обработки формы
    busboy.on('finish', async () => {
      try {
        if (!audioBuffer || audioBuffer.length === 0) {
          return res.status(400).json({ error: 'Аудиофайл не найден или пуст' });
        }
        
        console.log('Отправляем аудио в Whisper API...');
        
        try {
          // Отправляем запрос к Whisper API
          const whisperData = await transcribeAudio(audioBuffer, audioMimeType);
          
          console.log('Получен ответ от Whisper API:', whisperData);
          
          // Передаем распознанный текст в LLM
          const llmResult = await sendToLLM(whisperData.text);
          
          if (llmResult.success) {
            res.json({
              transcribedText: whisperData.text,
              llmResponse: llmResult.text,
              model: llmResult.model,
              usage: llmResult.usage
            });
          } else {
            res.status(500).json({ error: llmResult.error });
          }
        } catch (apiError) {
          console.error('API Error:', apiError);
          res.status(500).json({ error: 'Ошибка при взаимодействии с Whisper API: ' + apiError.message });
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