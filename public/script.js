document.addEventListener('DOMContentLoaded', () => {
  // DOM элементы для текстового интерфейса
  const promptForm = document.getElementById('promptForm');
  const promptInput = document.getElementById('prompt');
  const submitButton = document.getElementById('submitButton');
  
  // DOM элементы для аудио интерфейса
  const recordButton = document.getElementById('recordButton');
  const recordingStatus = document.getElementById('recordingStatus');
  const recordingTime = document.getElementById('recordingTime');
  const audioPreview = document.getElementById('audioPreview');
  const audioPlayback = document.getElementById('audioPlayback');
  const sendAudioButton = document.getElementById('sendAudioButton');
  
  // DOM элементы для отображения результатов
  const loadingIndicator = document.getElementById('loadingIndicator');
  const responseContainer = document.getElementById('responseContainer');
  const responseText = document.getElementById('responseText');
  const transcribedContainer = document.getElementById('transcribedContainer');
  const transcribedText = document.getElementById('transcribedText');
  const modelInfo = document.getElementById('modelInfo');
  const usageInfo = document.getElementById('usageInfo');
  const errorContainer = document.getElementById('errorContainer');
  const errorText = document.getElementById('errorText');
  
  // DOM элементы для табов
  const textTabBtn = document.getElementById('textTabBtn');
  const audioTabBtn = document.getElementById('audioTabBtn');
  const textTabContent = document.getElementById('textTabContent');
  const audioTabContent = document.getElementById('audioTabContent');
  
  // Переменные для работы с аудио
  let mediaRecorder;
  let audioChunks = [];
  let audioBlob;
  let isRecording = false;
  let recordingInterval;
  let recordingStartTime;
  
  // Переключение табов
  textTabBtn.addEventListener('click', () => {
    textTabBtn.classList.add('tab-active', 'text-blue-600');
    textTabBtn.classList.remove('text-gray-500');
    audioTabBtn.classList.remove('tab-active', 'text-blue-600');
    audioTabBtn.classList.add('text-gray-500');
    
    textTabContent.classList.remove('hidden');
    audioTabContent.classList.add('hidden');
  });
  
  audioTabBtn.addEventListener('click', () => {
    audioTabBtn.classList.add('tab-active', 'text-blue-600');
    audioTabBtn.classList.remove('text-gray-500');
    textTabBtn.classList.remove('tab-active', 'text-blue-600');
    textTabBtn.classList.add('text-gray-500');
    
    textTabContent.classList.add('hidden');
    audioTabContent.classList.remove('hidden');
  });
  
  // Обработка текстового запроса
  promptForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const prompt = promptInput.value.trim();
    if (!prompt) return;
    
    await sendTextRequest(prompt);
  });
  
  // Функция отправки текстового запроса
  async function sendTextRequest(prompt) {
    // Показываем индикатор загрузки
    submitButton.disabled = true;
    loadingIndicator.classList.remove('hidden');
    responseContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    transcribedContainer.classList.add('hidden');
    
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Показываем результат
        responseText.textContent = data.text;
        modelInfo.textContent = `Модель: ${data.model}`;
        
        if (data.usage) {
          usageInfo.textContent = `Использовано токенов: ${data.usage.total_tokens} ` +
            `(Ввод: ${data.usage.prompt_tokens}, Вывод: ${data.usage.completion_tokens})`;
        }
        
        responseContainer.classList.remove('hidden');
      } else {
        // Показываем ошибку
        errorText.textContent = data.error || 'Произошла неизвестная ошибка';
        errorContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error:', error);
      errorText.textContent = 'Не удалось подключиться к серверу';
      errorContainer.classList.remove('hidden');
    } finally {
      // Скрываем индикатор загрузки
      loadingIndicator.classList.add('hidden');
      submitButton.disabled = false;
    }
  }
  
  // Запись аудио
  recordButton.addEventListener('click', toggleRecording);
  
  // Функция переключения состояния записи
  function toggleRecording() {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
  
  // Начать запись
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);
        audioPlayback.src = audioUrl;
        audioPreview.classList.remove('hidden');
        sendAudioButton.classList.remove('hidden');
      };
      
      // Очищаем предыдущие записи
      audioChunks = [];
      audioPreview.classList.add('hidden');
      sendAudioButton.classList.add('hidden');
      
      // Запускаем запись
      mediaRecorder.start();
      isRecording = true;
      
      // Показываем статус записи
      recordingStatus.classList.remove('hidden');
      recordButton.classList.add('bg-red-600', 'hover:bg-red-700');
      recordButton.classList.remove('bg-blue-600', 'hover:bg-blue-700');
      
      // Начинаем отсчет времени
      recordingStartTime = Date.now();
      recordingInterval = setInterval(updateRecordingTime, 1000);
    } catch (error) {
      console.error('Error starting recording:', error);
      errorText.textContent = 'Не удалось получить доступ к микрофону';
      errorContainer.classList.remove('hidden');
    }
  }
  
  // Остановить запись
  function stopRecording() {
    if (mediaRecorder && isRecording) {
      mediaRecorder.stop();
      
      // Останавливаем все дорожки
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      
      isRecording = false;
      
      // Обновляем UI
      recordingStatus.classList.add('hidden');
      recordButton.classList.remove('bg-red-600', 'hover:bg-red-700');
      recordButton.classList.add('bg-blue-600', 'hover:bg-blue-700');
      
      // Останавливаем отсчет времени
      clearInterval(recordingInterval);
    }
  }
  
  // Обновить время записи
  function updateRecordingTime() {
    const elapsedTimeInSeconds = Math.floor((Date.now() - recordingStartTime) / 1000);
    const minutes = Math.floor(elapsedTimeInSeconds / 60).toString().padStart(2, '0');
    const seconds = (elapsedTimeInSeconds % 60).toString().padStart(2, '0');
    recordingTime.textContent = `${minutes}:${seconds}`;
  }
  
  // Отправка аудиозаписи
  sendAudioButton.addEventListener('click', sendAudioRequest);
  
  // Функция отправки аудиозаписи
  async function sendAudioRequest() {
    if (!audioBlob) {
      return;
    }
    
    // Показываем индикатор загрузки
    sendAudioButton.disabled = true;
    loadingIndicator.classList.remove('hidden');
    responseContainer.classList.add('hidden');
    errorContainer.classList.add('hidden');
    
    try {
      // Создаем FormData для отправки файла
      const formData = new FormData();
      // Добавляем аудио файл
      formData.append('audio', audioBlob, 'recording.wav');
      // Добавляем модель
      formData.append('model', 'whisper-large-v3-turbo');
      
      // Используем новый API-роут для аудио
      const response = await fetch('/api/audio', {
        method: 'POST',
        body: formData,
      });
      
      const data = await response.json();
      
      if (response.ok) {
        // Показываем результат
        responseText.textContent = data.llmResponse;
        transcribedText.textContent = data.transcribedText;
        
        modelInfo.textContent = `Модель: ${data.model}`;
        
        if (data.usage) {
          usageInfo.textContent = `Использовано токенов: ${data.usage.total_tokens} ` +
            `(Ввод: ${data.usage.prompt_tokens}, Вывод: ${data.usage.completion_tokens})`;
        }
        
        responseContainer.classList.remove('hidden');
        transcribedContainer.classList.remove('hidden');
      } else {
        // Показываем ошибку
        errorText.textContent = data.error || 'Произошла неизвестная ошибка';
        errorContainer.classList.remove('hidden');
      }
    } catch (error) {
      console.error('Error:', error);
      errorText.textContent = 'Не удалось подключиться к серверу';
      errorContainer.classList.remove('hidden');
    } finally {
      // Скрываем индикатор загрузки
      loadingIndicator.classList.add('hidden');
      sendAudioButton.disabled = false;
    }
  }
}); 