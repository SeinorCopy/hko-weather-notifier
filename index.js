const axios = require('axios');
const fs = require('fs');
const crypto = require('crypto');

// 從環境變數讀取 Pushover 設定
const PUSHOVER_USER_KEY = process.env.PUSHOVER_USER_KEY;
const PUSHOVER_API_TOKEN = process.env.PUSHOVER_API_TOKEN;
const STATE_FILE = './last_state.json';

// 計算 MD5 Hash 用於文字比對
function getHash(text) {
  return crypto.createHash('md5').update(text).digest('hex');
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
    
    const swtTips = res.data.swt || [];

    // 如果目前完全沒有特別天氣提示
    if (swtTips.length === 0) {
      console.log('ℹ️ 目前沒有特別天氣提示。');
      // 若之前有紀錄，現在清空了，亦更新紀錄
      if (lastState.swtHash !== '') {
        lastState.swtHash = '';
        fs.writeFileSync(STATE_FILE, JSON.stringify(lastState, null, 2));
      }
      return;
    }

    // 將所有提示內容合併為一段文字
    const currentText = swtTips.map(t => t.desc).join('\n---\n');
    const currentHash = getHash(currentText);

    // 3. 關鍵比對：Hash 一樣代表內容「一字未改」，直接跳過不重複 Send
    if (currentHash === lastState.swtHash) {
      console.log('⚡ 內容無變更，跳過發送。');
      return;
    }

    // 4. 關鍵字比對：預告掛波、預告落波、大雨 / 黃紅黑雨預告
    const hasActionKeyword = /(考慮|將於|會在|預料|評估).*(改發|發出|取消|考慮取消).*([八8九9十10]號|烈風|暴風|颶風)|(大雨|暴雨|黃雨|紅雨|黑雨)/.test(currentText);

    if (hasActionKeyword) {
      await sendPushover(
        '📢 天文台特別天氣提示',
        currentText
      );
    } else {
      console.log('ℹ️ 提示內容不包含關注動作關鍵字，不發送通知。');
    }

    // 5. 更新狀態檔存檔
    lastState.swtHash = currentHash;
    fs.writeFileSync(STATE_FILE, JSON.stringify(lastState, null, 2));

  } catch (error) {
    console.error('❌ 天文台 API 獲取失敗:', error.message);
  }
}

// 執行監控
checkWeather();
