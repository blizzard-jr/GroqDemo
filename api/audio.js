import { GROQ_API_KEY, MODEL_ID, WHISPER_MODEL_ID } from '../config.js';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Blob } from 'fetch-blob';

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
      console.error('LLM API Error:', data);
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

// Функция для транскрибации аудио с помощью Whisper API
async function transcribeAudio(audioBuffer, audioMimeType = 'audio/wav') {
  try {
    console.log('Транскрибация аудио, размер:', audioBuffer.length, 'байт');
    console.log('Используемая модель для транскрибации:', WHISPER_MODEL_ID);
    
    // Создаем FormData для отправки файла
    const formData = new FormData();
    
    // Добавляем аудио файл
    const audioBlob = new Blob([audioBuffer], { type: audioMimeType });
    formData.append('file', audioBlob, 'audio.wav');
    
    // Указываем модель
    formData.append('model', WHISPER_MODEL_ID);
    
    // Указываем формат ответа (json)
    formData.append('response_format', 'json');
    
    // Задаем температуру (0 для наиболее определенного результата)
    formData.append('temperature', '0');
    
    // Отправляем запрос к Whisper API
    console.log('Отправляем запрос к Whisper API...');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: formData
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Whisper API ответил с ошибкой:', response.status, errorText);
      throw new Error(`Ошибка API Whisper: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Получен ответ от Whisper API:', data);
    
    return data;
  } catch (error) {
    console.error('Ошибка при транскрибации:', error);
    throw error;
  }
}

// API route для обработки аудио-запросов
export default async function handler(req, res) {
  // Только POST запросы
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Метод не разрешен' });
  }
  
  console.log('Получен запрос на /api/audio');
  
  try {
    // Проверяем, что у нас multipart/form-data
    if (!req.headers['content-type']?.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'Ожидается multipart/form-data' });
    }
    
    // Получаем данные из запроса
    const chunks = [];
    let audioMimeType = 'audio/wav';
    
    // Собираем все куски данных
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    
    // Объединяем в один буфер
    const buffer = Buffer.concat(chunks);
    
    // Ищем границу multipart/form-data
    const boundary = req.headers['content-type'].match(/boundary=(?:"([^"]+)"|([^;]+))/i)[1] || 'boundary';
    
    // Ищем содержимое файла в multipart/form-data
    const fileDataMatch = buffer.toString().match(new RegExp(`Content-Type: (audio\\/[^\r\n]+)[\r\n]+[\r\n]+(.*?)--${boundary}`, 's'));
    
    if (!fileDataMatch) {
      console.error('Не удалось найти аудио файл в запросе');
      return res.status(400).json({ error: 'Аудио файл не найден в запросе' });
    }
    
    // Извлекаем MIME тип и данные файла
    audioMimeType = fileDataMatch[1] || 'audio/wav';
    
    // Определяем позицию начала аудио данных
    const contentTypePos = buffer.indexOf(Buffer.from(`Content-Type: ${audioMimeType}`));
    const dataStartPos = buffer.indexOf(Buffer.from('\r\n\r\n'), contentTypePos) + 4;
    const dataEndPos = buffer.lastIndexOf(Buffer.from(`--${boundary}--`)) - 2;
    
    // Извлекаем аудио данные
    const audioBuffer = buffer.slice(dataStartPos, dataEndPos);
    
    if (!audioBuffer || audioBuffer.length === 0) {
      console.error('Аудио буфер пуст');
      return res.status(400).json({ error: 'Аудио данные не найдены или пусты' });
    }
    
    console.log('Получены аудио данные, размер:', audioBuffer.length, 'байт, тип:', audioMimeType);
    
    try {
      // Отправляем аудио на транскрибацию
      const whisperData = await transcribeAudio(audioBuffer, audioMimeType);
      
      if (!whisperData || !whisperData.text) {
        console.error('Некорректный ответ от Whisper API:', whisperData);
        return res.status(500).json({ error: 'Некорректный ответ от сервиса транскрибации' });
      }
      
      // Отправляем транскрибированный текст к LLM модели
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
    } catch (error) {
      console.error('Ошибка при обработке аудио:', error);
      res.status(500).json({ 
        error: 'Ошибка при обработке аудио: ' + error.message,
        details: error.stack
      });
    }
  } catch (error) {
    console.error('Общая ошибка API аудио:', error);
    res.status(500).json({ 
      error: 'Внутренняя ошибка сервера: ' + error.message,
      details: error.stack
    });
  }
} 