import fs from 'fs';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { Blob } from 'fetch-blob';
import { GROQ_API_KEY } from './config.js';

// ID модели Whisper
const WHISPER_MODEL_ID = 'whisper-large-v3-turbo';

// Функция для транскрибции аудио
async function transcribeAudio(audioPath) {
  try {
    // Читаем аудиофайл
    const audioBuffer = fs.readFileSync(audioPath);
    console.log(`Загружен файл: ${audioPath}, размер: ${audioBuffer.length} байт`);
    
    // Создаем форму
    const form = new FormData();
    
    // Добавляем аудиофайл
    form.append('file', audioBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });
    
    // Добавляем модель
    form.append('model', WHISPER_MODEL_ID);
    
    // Отправляем запрос
    console.log('Отправляем запрос к Whisper API...');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: form
    });
    
    // Получаем и выводим результат
    const data = await response.json();
    
    if (response.ok) {
      console.log('Успешно получен ответ:');
      console.log('Текст:', data.text);
      return data;
    } else {
      console.error('Ошибка API:', response.status);
      console.error(data);
      return null;
    }
  } catch (error) {
    console.error('Ошибка при транскрибции:', error);
    return null;
  }
}

// Функция для создания тестового аудиофайла
function createTestAudioFile() {
  // Создаем простой WAV файл (пустой звук)
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36, 4);  // Размер файла - 8
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // Размер блока fmt
  header.writeUInt16LE(1, 20);  // PCM формат
  header.writeUInt16LE(1, 22);  // Mono
  header.writeUInt32LE(44100, 24); // Sample rate
  header.writeUInt32LE(44100 * 2, 28); // Byte rate
  header.writeUInt16LE(2, 32);  // Block align
  header.writeUInt16LE(16, 34); // Bits per sample
  header.write('data', 36);
  header.writeUInt32LE(0, 40);  // Data size
  
  // Записываем в файл
  const testFilePath = './test-audio.wav';
  fs.writeFileSync(testFilePath, header);
  console.log(`Создан тестовый файл: ${testFilePath}`);
  return testFilePath;
}

// Запускаем тест
async function runTest() {
  // Проверяем наличие тестового аудиофайла или создаем его
  const audioPath = './test-audio.wav';
  if (!fs.existsSync(audioPath)) {
    console.log('Тестовый аудиофайл не найден, создаем...');
    createTestAudioFile();
  }
  
  // Транскрибируем аудио
  await transcribeAudio(audioPath);
}

// Запускаем тест
runTest(); 