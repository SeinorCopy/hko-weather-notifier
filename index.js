const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

// 從環境變數讀取 Pushover 設定
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const STATE_FILE = './last_state.json';

// 計算 MD5 Hash 用於文字比對 (備用)
function getHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
}

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
      priority: 0 // 固定 0：普通通知，跟隨手機靜音設定，絕不硬出聲
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
    const res = await axios.get('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=swt&lang=tc'); //HKO API
    //const res = await axios.get('https://raw.githubusercontent.com/SeinorCopy/hko-weather-notifier/refs/heads/main/mock_hko.json'); //UAT
    
    const swtList = res.data.swt || [];

    // 如果目前完全沒有特別天氣提示
    if (swtList.length === 0) {
      console.log('ℹ️ 目前沒有特別天氣提示。');
      // 若之前有紀錄，現在清空了，亦更新紀錄
      if (lastState.swtHash !== '') {
        lastState.swtHash = '';
        saveState(lastState);
      }
      return;
    }
    
    // 取得香港當前時間字串 (用於 Log 或標題)
    const nowStr = new Date().toLocaleTimeString('zh-HK', { 
      timeZone: 'Asia/Hong_Kong', 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: false 
    });

    // 1. 初始化 last_state 中的已發送清單 (避免歷史資料格式不對)
    if (!lastState.sentNoticeKeys || !Array.isArray(lastState.sentNoticeKeys)) {
      lastState.sentNoticeKeys = [];
    }

    if (swtList.length > 0) {
      let hasNewSend = false;

      // 2. 逐條提示 (Msg) 分開獨立處理
      for (const item of swtList) {
        // 天文台提示的發佈時間 (兼顧 issueTime 與 updateTime)
        const issueTime = item.issueTime || item.updateTime || ''; 
        const desc = item.desc;
        
        // 建立這條 Msg 的唯一識別碼 (例如: "18:00_未來一兩小時...")
        const noticeKey = `${issueTime}_${desc}`;

        // 3. 檢查這條 Msg 是否已經發送過
        if (!lastState.sentNoticeKeys.includes(noticeKey)) {
          
          // 提取出顯示用的時間 (若有 ISO 時間就截取 HH:mm，沒有就用當前時間)
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

          // 4. 將這條 Msg 標記為已發送
          lastState.sentNoticeKeys.push(noticeKey);
          hasNewSend = true;
        } else {
          console.log(`⚡ [${issueTime}] 該條提示已發送過，跳過。`);
        }
      }

      // 5. 自動清理舊紀錄 (只保留最新 20 條 Key，防止 last_state.json 無限變大)
      if (lastState.sentNoticeKeys.length > 20) {
        lastState.sentNoticeKeys = lastState.sentNoticeKeys.slice(-20);
      }

      // 如果有發送新通知，更新 last_state.json
      if (hasNewSend) {
        saveState(lastState);
      }
    } else {
      console.log('ℹ️ 目前沒有特別天氣提示。');
    }

  } catch (error) {
    console.error('❌ 抓取 API 失敗:', error.message);
  }
}

// 執行監控
checkWeather();
