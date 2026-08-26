const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

// 從環境變數讀取 Pushover 設定
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const STATE_FILE = './last_state.json';

// 🎯 設定你想監控/篩選嘅關鍵字清單 (留空 [] 代表全部發送，唔做過濾)
const KEYWORDS = ['八號', '黑', '紅', '黃', '發出', '改發', '暴雨', '未來', '烈風', '暴風', '考慮', '錄得'];

// 寫入 last_state.json 工具函數
function saveState(stateData) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(stateData, null, 2));
  } catch (e) {
    console.error('❌ 無法寫入狀態檔:', e.message);
  }
}

// 發送 Pushover 通知
async function sendPushover(title, message) {
  try {
    await axios.post('https://api.pushover.net/1/messages.json', {
      token: PUSHOVER_API_TOKEN,
      user: PUSHOVER_USER_KEY,
      title: title,
      message: message,
      priority: 0 // 普通通知
    });
    console.log('✅ Pushover 通知發送成功');
  } catch (err) {
    console.error('❌ Pushover 發送失敗:', err.message);
  }
}

async function checkWeather() {
  // 1. 讀取上次狀態紀錄
  let lastState = { swtHash: '' };
  if (fs.existsSync(STATE_FILE)) {
    try {
      lastState = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      console.log('無法解析舊狀態檔，重新建立紀錄');
    }
  }

  // 2. Call 天文台特別天氣提示 API
  try {
    const res = await axios.get('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=swt&lang=tc'); // HKO API
    //const res = await axios.get('https://raw.githubusercontent.com/SeinorCopy/hko-weather-notifier/refs/heads/main/mock_hko.json'); // UAT Mock
    
    const swtList = res.data.swt || [];

    if (swtList.length === 0) {
      console.log('ℹ️ 目前沒有特別天氣提示。');
      if (lastState.swtHash !== '') {
        lastState.swtHash = '';
        saveState(lastState);
      }
      return;
    }
    
    const nowStr = new Date().toLocaleTimeString('zh-HK', { 
      timeZone: 'Asia/Hong_Kong', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });

    if (!lastState.sentNoticeKeys || !Array.isArray(lastState.sentNoticeKeys)) {
      lastState.sentNoticeKeys = [];
    }

    let hasNewSend = false;

    // 逐條提示 (Msg) 分開獨立處理
    for (const item of swtList) {
      const issueTime = item.issueTime || item.updateTime || ''; 
      const desc = item.desc || '';

      // 🔍 關鍵字過濾：如果設定了 KEYWORDS，內文必須包含至少一個關鍵字
      if (KEYWORDS.length > 0) {
        const isMatch = KEYWORDS.some(kw => desc.includes(kw));
        if (!isMatch) {
          console.log(`🔍 [${issueTime}] 內容不包含指定的關鍵字，跳過。`);
          continue; // 不符合關鍵字，直接跳過這條提示
        }
      }

      // 建立這條 Msg 的唯一識別碼
      const noticeKey = `${issueTime}_${desc}`;

      // 檢查這條 Msg 是否已經發送過
      if (!lastState.sentNoticeKeys.includes(noticeKey)) {
        
        let displayTime = nowStr;
        if (issueTime && issueTime.includes('T')) {
          displayTime = issueTime.substring(11, 16);
        } else if (issueTime) {
          displayTime = issueTime;
        }
        
        // 單獨發送這一條 Msg
        await sendPushover(
          `📢 天文台特別天氣提示 (${displayTime})`, 
          desc
        );

        console.log(`✅ 已發送新提示 [${displayTime}]: ${desc.substring(0, 15)}...`);

        // 標記為已發送
        lastState.sentNoticeKeys.push(noticeKey);
        hasNewSend = true;
      } else {
        console.log(`⚡ [${issueTime}] 該條提示已發送過，跳過。`);
      }
    }

    // 保留最新 20 條 Key
    if (lastState.sentNoticeKeys.length > 20) {
      lastState.sentNoticeKeys = lastState.sentNoticeKeys.slice(-20);
    }

    if (hasNewSend) {
      saveState(lastState);
    }

  } catch (error) {
    console.error('❌ 抓取 API 失敗:', error.message);
  }
}

// 執行監控
checkWeather();

