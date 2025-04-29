import { GROQ_API_KEY, WHISPER_MODEL_ID, MODEL_ID } from '../config.js';
import fetch from 'node-fetch';
import FormData from 'form-data';
import Busboy from 'busboy';

// Функция для отправки запроса к LLM модели
async function sendToLLM(prompt) {
  try {
    console.log('Отправка запроса к LLM модели:', MODEL_ID);
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

// API route для обработки аудио-запросов на Vercel
export default async function handler(req, res) {
  // Только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешен' });
  }
  
  console.log('Получен запрос на /api/audio-alt');
  
  try {
    // Проверяем, что у нас multipart/form-data
    if (!req.headers['content-type']?.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Ожидается multipart/form-data' });
    }
    
    // Создаем парсер для multipart/form-data
    const busboy = Busboy({ headers: req.headers });
    
    // Переменные для хранения данных
    let audioBuffer = null;
    let audioMimeType = 'audio/wav';
    let modelName = WHISPER_MODEL_ID;
    
    // Обработка полей формы
    busboy.on('field', (fieldname, val) => {
      if (fieldname === 'model') {
        modelName = val;
        console.log('Получено значение модели:', modelName);
      }
    });
    
    // Обработка файлов
    busboy.on('file', (fieldname, file, info) => {
      if (fieldname === 'audio') {
        const { filename, encoding, mimeType } = info;
        console.log(`Получен файл: ${filename}, тип: ${mimeType || 'audio/wav'}`);
        audioMimeType = mimeType || 'audio/wav';
        
        // Собираем файл в буфер
        const chunks = [];
        file.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        // Когда файл полностью получен
        file.on('end', () => {
          audioBuffer = Buffer.concat(chunks);
          console.log(`Файл получен, размер: ${audioBuffer ? audioBuffer.length : 0} байт`);
        });
      }
    });
    
    // После полной обработки формы
    busboy.on('finish', async () => {
      try {
        if (!audioBuffer || audioBuffer.length === 0) {
          return res.status(400).json({ error: 'Аудиофайл не найден в запросе или пуст' });
        }
        
        console.log('Отправляем аудио в Whisper API...');
        
        // Создаем новый FormData для отправки в API
        const formData = new FormData();
        formData.append('file', audioBuffer, {
          filename: 'audio.wav',
          contentType: audioMimeType
        });
        formData.append('model', modelName);
        
        // Полный URL для API запроса
        const apiUrl = 'https://api.groq.com/openai/v1/audio/transcriptions';
        console.log('Отправляем запрос к Whisper API на URL:', apiUrl);
        console.log('Используемая модель:', modelName);
        
        try {
          // Отправляем запрос к Whisper API
          const whisperResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${GROQ_API_KEY}`
            },
            body: formData
          });
          
          console.log('Получен ответ от API. Статус:', whisperResponse.status);
          
          // Получаем ответ в виде текста для диагностики
          const responseText = await whisperResponse.text();
          console.log('Ответ API (первые 200 символов):', responseText.substring(0, 200));
          
          // Пытаемся распарсить JSON
          let whisperData;
          try {
            whisperData = JSON.parse(responseText);
          } catch (e) {
            console.error('Ошибка при парсинге JSON ответа:', e);
            return res.status(500).json({ 
              error: 'Ошибка при парсинге ответа API: ' + e.message,
              rawResponse: responseText.substring(0, 500) // Обрезаем большие ответы
            });
          }
          
          if (!whisperResponse.ok) {
            console.error('Whisper API Error:', whisperData);
            return res.status(whisperResponse.status).json({ 
              error: whisperData.error?.message || 'Ошибка при обращении к API Whisper',
              status: whisperResponse.status,
              details: whisperData
            });
          }
          
          console.log('Получен корректный ответ от Whisper API:', whisperData);
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
          console.error('API Request Error:', error);
          res.status(500).json({ error: 'Ошибка при отправке запроса к API: ' + error.message });
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
} 