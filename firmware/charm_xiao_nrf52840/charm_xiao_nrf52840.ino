/*
 * 网球记智能饰品 v0.1 —— Seeed XIAO nRF52840
 *
 * 功能：
 *   - BLE 自定义服务（UUID 与小程序 utils/ble-protocol.js 一一对应）
 *   - 手机可下发：灯效模式 / 颜色 / 亮度 / 一次性触发（雷达闪）/ 绑定 token（v0.1 只存 RAM）
 *   - 手机可订阅：状态帧 [0xA5, 电量%, 模式, R, G, B, 亮度, XOR] + 标准电量服务
 *   - 板载按键：短按切灯效（热身→呼吸→心跳→弹跳→彩虹），长按 800ms 关灯
 *   - 帧格式：命令 [CMD, LEN, payload…, XOR]，XOR 为前面全部字节的异或
 *
 * 硬件接线（详见 ../README.md）：
 *   D2  → WS2812 DIN
 *   D3  → 按键（另一端接 GND）
 *   电池电压用板级包的 PIN_VBAT(32) 读取，读之前必须把 VBAT_ENABLE(14) 拉低
 */

#include <bluefruit.h>
#include <Adafruit_NeoPixel.h>

/* ---------- 引脚 ---------- */
#define LED_PIN     2     // D2 → WS2812 DIN
#define BUTTON_PIN  3     // D3 → 按键（另一端接 GND，内部上拉）
#define NUM_PIXELS  4     // 买的灯是几颗就改成几

#ifndef PIN_VBAT
#define PIN_VBAT    32    // P0.31，板级包一般已定义
#endif
#ifndef VBAT_ENABLE
#define VBAT_ENABLE 14    // 拉低后才允许读电池电压
#endif

/* ---------- BLE UUID（改一处要同步改小程序端） ---------- */
#define UUID_SVC    "a5e00001-7a1e-4c6d-9b3f-2e8f5a6b0001"
#define UUID_CMD    "a5e00002-7a1e-4c6d-9b3f-2e8f5a6b0001"
#define UUID_STATUS "a5e00003-7a1e-4c6d-9b3f-2e8f5a6b0001"

/* 命令码 */
#define CMD_SET_MODE   0x01
#define CMD_SET_COLOR  0x02
#define CMD_SET_BRIGHT 0x03
#define CMD_TRIGGER    0x04
#define CMD_BIND       0x10

/* 灯效模式（与小程序 MODES 同号） */
enum {
  MODE_OFF = 0,
  MODE_ON,        // 热身
  MODE_BREATHE,   // 呼吸
  MODE_HEARTBEAT, // 心跳
  MODE_BOUNCE,    // 弹跳
  MODE_RAINBOW,   // 彩虹
  MODE_RADAR      // 雷达（一次性 3 闪，结束回到之前的模式）
};

/* ---------- BLE 对象 ---------- */
BLEService        charmSvc(UUID_SVC);
BLECharacteristic cmdChr(UUID_CMD, BLE_WRITE | BLE_WRITE_WO_RESP, 20);
BLECharacteristic statusChr(UUID_STATUS, BLE_NOTIFY, 8, true);  // 定长 8
BLEDis            dis;
BLEBas            bas;   // 标准电量服务，手表/系统也能读

Adafruit_NeoPixel strip(NUM_PIXELS, LED_PIN, NEO_GRB + NEO_KHZ800);

/* ---------- 运行状态 ---------- */
uint8_t  mode = MODE_BREATHE;
uint8_t  prevMode = MODE_BREATHE;   // 雷达闪完回到这个模式
uint32_t modeStart = 0;
uint8_t  brightness = 90;
uint8_t  colR = 204, colG = 255, colB = 0;   // 默认网球黄绿 #ccff00

uint8_t  bindToken[16] = {0};   // v0.1 只存 RAM；v0.2 写入内部 flash 并做鉴权
bool     bleConnected = false;
uint8_t  batteryPct = 100;
uint32_t lastBatteryMs = 0;

/* 按键消抖 */
bool     btnStable = true;      // true = 松开
uint32_t btnLastMs = 0;
bool     longFired = false;

/* 短按循环的模式顺序 */
const uint8_t CYCLE[] = { MODE_ON, MODE_BREATHE, MODE_HEARTBEAT, MODE_BOUNCE, MODE_RAINBOW };

/* ================================================================ */

void setup() {
  strip.begin();
  strip.show();   // 上电先熄灯

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(VBAT_ENABLE, OUTPUT);
  digitalWrite(VBAT_ENABLE, LOW);   // 打开电池电压读取通路（不拉低有损坏 P0.31 的风险）

  Bluefruit.begin();
  /* 每个饰品建议烧写前改成不同编号，扫码时好区分 */
  Bluefruit.setName("Tennis Charm 01");

  charmSvc.begin();

  cmdChr.setPermission(SECMODE_OPEN, SECMODE_OPEN);   // v0.2 再收紧成加密 + 绑定校验
  cmdChr.setWriteCallback(cmdWriteCb);
  cmdChr.begin();

  statusChr.setPermission(SECMODE_OPEN, SECMODE_OPEN);
  statusChr.begin();

  dis.begin();
  dis.setManufacturer("Tennis Log");
  dis.setModel("Charm v0.1");

  bas.begin();
  bas.update(batteryPct);

  /* 广播里带服务 UUID：小程序按它过滤扫描；已连接的饰品不广播，
     所以手机扫到的都是别人的饰品（雷达互闪 v0.1 的前提） */
  Bluefruit.Advertising.addFlags(BLE_GAP_ADV_FLAGS_LE_ONLY_GENERAL_DISC_MODE);
  Bluefruit.Advertising.addTxPower();
  Bluefruit.Advertising.addService(charmSvc);
  Bluefruit.ScanResponse.addName();

  Bluefruit.Advertising.restartOnDisconnect(true);
  Bluefruit.Advertising.setInterval(160, 244);   // 单位 0.625ms
  Bluefruit.Advertising.start(0);                // 0 = 一直广播

  Bluefruit.setConnectCallback(connectCb);
  Bluefruit.setDisconnectCallback(disconnectCb);

  modeStart = millis();
}

void loop() {
  pollButton();
  pollBattery();

  /* 雷达一次性灯效结束，回到原模式 */
  if (mode == MODE_RADAR && millis() - modeStart > 1600) {
    mode = prevMode;
    modeStart = millis();
  }

  renderFrame();
  delay(5);
}

/* ---------- BLE 回调 ---------- */

void connectCb(uint16_t conn_hdl) {
  (void)conn_hdl;
  bleConnected = true;
  sendStatus();
}

void disconnectCb(uint16_t conn_hdl, uint8_t reason) {
  (void)conn_hdl; (void)reason;
  bleConnected = false;
}

/* Seeed nRF52 板级包的写回调是 4 参数版本 */
void cmdWriteCb(uint16_t conn_hdl, BLECharacteristic* chr, uint8_t* data, uint16_t len) {
  (void)conn_hdl; (void)chr;
  applyFrame(data, len);
}

/* ---------- 命令帧处理：[CMD, LEN, payload…, XOR] ---------- */

uint8_t xorBytes(uint8_t const* d, uint16_t len) {
  uint8_t x = 0;
  for (uint16_t i = 0; i < len; i++) x ^= d[i];
  return x;
}

void applyFrame(uint8_t const* d, uint16_t len) {
  if (len < 3) return;
  if (d[1] != len - 3) return;                     // 长度声明不符
  if (xorBytes(d, len - 1) != d[len - 1]) return;  // 异或校验不符

  uint8_t cmd = d[0];
  uint8_t const* p = d + 2;
  uint8_t plen = d[1];

  switch (cmd) {
    case CMD_SET_MODE:
      if (plen >= 1) setMode(p[0]);
      break;
    case CMD_SET_COLOR:
      if (plen >= 3) { colR = p[0]; colG = p[1]; colB = p[2]; }
      break;
    case CMD_SET_BRIGHT:
      if (plen >= 1) brightness = p[0];
      break;
    case CMD_TRIGGER:
      if (plen >= 1 && p[0] == MODE_RADAR) triggerRadar();
      break;
    case CMD_BIND:
      if (plen == 16) {
        for (uint8_t i = 0; i < 16; i++) bindToken[i] = p[i];
      }
      break;
    default:
      return;   // 未知命令：连状态都不回，省电
  }
  sendStatus();
}

void setMode(uint8_t m) {
  if (m > MODE_RAINBOW) return;
  if (m == MODE_RADAR) { triggerRadar(); return; }
  mode = m;
  modeStart = millis();
}

void triggerRadar() {
  if (mode != MODE_RADAR) prevMode = mode;
  mode = MODE_RADAR;
  modeStart = millis();
}

/* ---------- 状态上报 ---------- */

void sendStatus() {
  uint8_t b[8] = { 0xA5, batteryPct, mode, colR, colG, colB, brightness, 0 };
  b[7] = xorBytes(b, 7);
  if (bleConnected) {
    statusChr.notify(b, 8);
  }
  bas.update(batteryPct);
}

/* ---------- 电池：官方 adc_vbat 示例的读法（分压补偿 ×2.0） ---------- */

void pollBattery() {
  if (millis() - lastBatteryMs < 60000) return;
  lastBatteryMs = millis();

  analogReference(AR_INTERNAL_3_0);   // 3.0V 基准
  analogReadResolution(12);           // 0..4095
  delay(1);                           // 等 ADC 稳定
  float raw = analogRead(PIN_VBAT);
  analogReference(AR_DEFAULT);        // 用完改回默认，免得影响别的模拟用法
  analogReadResolution(10);

  float mv = raw * 2.0F * (3000.0F / 4096.0F);   // 1/2 分压补偿
  float pct = (mv - 3500.0F) / 700.0F * 100.0F;  // 3.5V→0%，4.2V→100%
  batteryPct = (uint8_t)constrain(pct, 0, 100);

  if (bleConnected) {
    bas.update(batteryPct);
    sendStatus();
  }
}

/* ---------- 按键：短按切灯效，长按关灯 ---------- */

void pollButton() {
  bool pressed = (digitalRead(BUTTON_PIN) == LOW);
  uint32_t now = millis();

  if (pressed != btnStable && now - btnLastMs > 30) {   // 30ms 消抖
    btnStable = pressed;
    btnLastMs = now;
    if (pressed) {
      longFired = false;
    } else if (!longFired) {
      cycleMode();
    }
  }

  if (btnStable && !longFired && now - btnLastMs > 800) {
    longFired = true;
    setMode(MODE_OFF);
    sendStatus();
  }
}

void cycleMode() {
  uint8_t cur = (mode == MODE_RADAR) ? prevMode : mode;
  uint8_t n = sizeof(CYCLE);
  for (uint8_t i = 0; i < n; i++) {
    if (CYCLE[i] == cur) {
      setMode(CYCLE[(i + 1) % n]);
      sendStatus();
      return;
    }
  }
  setMode(CYCLE[0]);   // 当前是关灯，短按进第一个模式
  sendStatus();
}

/* ---------- 灯效引擎（全部非阻塞，millis() 驱动） ---------- */

void renderFrame() {
  uint32_t t = millis() - modeStart;

  switch (mode) {
    case MODE_OFF:
      strip.clear();
      break;
    case MODE_ON:
      fillScaled(colR, colG, colB, 255);
      break;
    case MODE_BREATHE:
      fillScaled(colR, colG, colB, breatheCurve(t));
      break;
    case MODE_HEARTBEAT:
      fillScaled(colR, colG, colB, heartbeatCurve(t));
      break;
    case MODE_BOUNCE:
      fillScaled(colR, colG, colB, bounceCurve(t));
      break;
    case MODE_RAINBOW: {
      uint16_t hue = (t * 60) % 65536;   // 约 1 秒转一圈
      for (uint8_t i = 0; i < NUM_PIXELS; i++) {
        strip.setPixelColor(i, dimColor(strip.ColorHSV((uint16_t)(hue + i * (65536 / NUM_PIXELS)))));
      }
      break;
    }
    case MODE_RADAR:
      if ((t / 200) % 2 == 0 && t < 1200) fillScaled(colR, colG, colB, 255);
      else strip.clear();
      break;
    default:
      strip.clear();
  }
  strip.show();
}

/* 呼吸：约 2.4 秒一个周期，0~255 */
uint8_t breatheCurve(uint32_t t) {
  float s = sinf(2.0F * PI * (t % 2400) / 2400.0F);   // -1..1
  return (uint8_t)(110 + 110 * s);                     // 0..220
}

/* 心跳：1.5 秒两跳（强-弱），像场边等球时的心率 */
uint8_t heartbeatCurve(uint32_t t) {
  uint32_t e = t % 1500;
  if (e < 220)  return (uint8_t)(255 * (1.0F - e / 220.0F));   // 第一跳衰减
  if (e < 300)  return 0;
  if (e < 500)  return (uint8_t)(180 * (1.0F - (e - 300) / 200.0F)); // 第二跳弱一点
  return 0;
}

/* 弹跳：1.8 秒内三次起跳，一跳比一跳矮，像颗被拍起来的球 */
uint8_t bounceCurve(uint32_t t) {
  uint32_t e = t % 1800;
  float f = e / 1800.0F;
  float amp = 1.0F;
  for (uint8_t k = 0; k < 3; k++) {
    float seg = 1.0F / (k + 1);          // 每段时长递减
    if (f < seg) {
      float p = f / seg;                  // 段内进度 0..1
      return (uint8_t)(255 * amp * 4 * p * (1 - p));
    }
    f -= seg;
    amp *= 0.55F;
  }
  return 0;
}

/* 按当前颜色 + 亮度 + 曲线值点亮全部灯 */
void fillScaled(uint8_t r, uint8_t g, uint8_t b, uint8_t f) {
  uint16_t br = brightness;
  uint16_t rr = (uint16_t)r * f * br / 65025;   // 255*255=65025，先乘后除防溢出
  uint16_t gg = (uint16_t)g * f * br / 65025;
  uint16_t bb = (uint16_t)b * f * br / 65025;
  uint32_t c = ((uint32_t)rr << 16) | ((uint32_t)gg << 8) | bb;
  for (uint8_t i = 0; i < NUM_PIXELS; i++) strip.setPixelColor(i, c);
}

/* 彩虹模式也尊重全局亮度 */
uint32_t dimColor(uint32_t c) {
  uint8_t r = (uint8_t)(c >> 16), g = (uint8_t)(c >> 8), b = (uint8_t)c;
  uint16_t br = brightness;
  r = (uint16_t)r * br / 255;
  g = (uint16_t)g * br / 255;
  b = (uint16_t)b * br / 255;
  return ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
}
