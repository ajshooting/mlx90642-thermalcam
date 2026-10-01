#include <WiFi.h>
#include <Wire.h>
#include <esp_http_server.h>

#include "frame_protocol.h"
#include "web_ui.h"

// Change these before uploading if you want a different Wi-Fi name/password.
constexpr char AP_SSID[] = "ThermalCam";
constexpr char AP_PASSWORD[] = "thermalcam";
static_assert(sizeof(AP_PASSWORD) > 8, "Wi-Fi password must be at least 8 characters");

constexpr uint8_t MLX_ADDR = 0x66;
constexpr int SDA_PIN = 6;  // XIAO ESP32-C3 D4
constexpr int SCL_PIN = 7;  // XIAO ESP32-C3 D5
constexpr uint16_t FLAGS_ADDR = 0x3C14;
constexpr uint16_t TO_ADDR = 0x342C;
constexpr uint16_t CONFIG_ADDR = 0x11F4;
constexpr uint16_t READY_MASK = 0x0100;
constexpr uint16_t BUSY_MASK = 0x0001;
constexpr uint32_t STALE_MS = 3000;
constexpr size_t MAX_CLIENTS = 6;

httpd_handle_t server = nullptr;
portMUX_TYPE frameMux = portMUX_INITIALIZER_UNLOCKED;
thermal::FramePacket latestFrame;
const char *sensorState = "waiting";
bool hasFrame = false;
bool broadcastPending = false;

bool readWords(uint16_t address, uint16_t *destination, size_t words) {
  constexpr size_t WORDS_PER_CHUNK = 16;
  for (size_t done = 0; done < words;) {
    const size_t count = min(WORDS_PER_CHUNK, words - done);
    const uint16_t current = address + done * 2;
    Wire.beginTransmission(MLX_ADDR);
    Wire.write(static_cast<uint8_t>(current >> 8));
    Wire.write(static_cast<uint8_t>(current));
    if (Wire.endTransmission(false) != 0) return false;
    const size_t bytes = count * 2;
    if (Wire.requestFrom(MLX_ADDR, bytes, true) != bytes) return false;
    for (size_t i = 0; i < count; ++i) {
      const uint8_t msb = Wire.read();
      const uint8_t lsb = Wire.read();
      destination[done + i] = (static_cast<uint16_t>(msb) << 8) | lsb;
    }
    done += count;
  }
  return true;
}

void setSensorState(const char *state) {
  portENTER_CRITICAL(&frameMux);
  const bool changed = sensorState != state;
  sensorState = state;
  portEXIT_CRITICAL(&frameMux);
  if (changed) Serial.printf("Sensor: %s\n", state);
}

// Runs in the HTTP server task. Only the newest frame is kept; slow clients
// cannot create an unbounded queue or delay the sensor's I2C loop.
void broadcastLatest(void *) {
  thermal::FramePacket packet;
  const char *state;
  bool valid;
  portENTER_CRITICAL(&frameMux);
  packet = latestFrame;
  state = sensorState;
  valid = hasFrame;
  portEXIT_CRITICAL(&frameMux);

  char status[112];
  snprintf(status, sizeof(status),
           "{\"type\":\"status\",\"sensor\":\"%s\",\"hasFrame\":%s,\"demo\":false}",
           state, valid ? "true" : "false");
  httpd_ws_frame_t message = {};
  message.type = HTTPD_WS_TYPE_TEXT;
  message.payload = reinterpret_cast<uint8_t *>(status);
  message.len = strlen(status);
  httpd_ws_frame_t image = {};
  image.type = HTTPD_WS_TYPE_BINARY;
  image.payload = reinterpret_cast<uint8_t *>(&packet);
  image.len = sizeof(packet);

  int clients[MAX_CLIENTS];
  size_t count = MAX_CLIENTS;
  if (httpd_get_client_list(server, &count, clients) == ESP_OK) {
    for (size_t i = 0; i < count; ++i) {
      const int client = clients[i];
      if (httpd_ws_get_fd_info(server, client) != HTTPD_WS_CLIENT_WEBSOCKET) continue;
      esp_err_t result = httpd_ws_send_frame_async(server, client, &message);
      if (result == ESP_OK && valid && strcmp(state, "ok") == 0 &&
          millis() - packet.capturedAtMs <= STALE_MS) {
        result = httpd_ws_send_frame_async(server, client, &image);
      }
      if (result != ESP_OK) httpd_sess_trigger_close(server, client);
    }
  }
  portENTER_CRITICAL(&frameMux);
  broadcastPending = false;
  portEXIT_CRITICAL(&frameMux);
}

void queueBroadcast() {
  if (server == nullptr) return;
  portENTER_CRITICAL(&frameMux);
  const bool queued = broadcastPending;
  broadcastPending = true;
  portEXIT_CRITICAL(&frameMux);
  if (queued) return;
  if (httpd_queue_work(server, broadcastLatest, nullptr) != ESP_OK) {
    portENTER_CRITICAL(&frameMux);
    broadcastPending = false;
    portEXIT_CRITICAL(&frameMux);
  }
}

esp_err_t handleIndex(httpd_req_t *request) {
  httpd_resp_set_type(request, "text/html; charset=utf-8");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  httpd_resp_set_hdr(request, "X-Content-Type-Options", "nosniff");
  return httpd_resp_send(request, WEB_UI, sizeof(WEB_UI) - 1);
}

esp_err_t handleStatus(httpd_req_t *request) {
  const char *state;
  bool valid;
  uint32_t sequence;
  portENTER_CRITICAL(&frameMux);
  state = sensorState;
  valid = hasFrame;
  sequence = latestFrame.sequence;
  portEXIT_CRITICAL(&frameMux);
  char body[160];
  snprintf(body, sizeof(body),
           "{\"sensor\":\"%s\",\"hasFrame\":%s,\"sequence\":%lu,\"uptimeMs\":%lu}",
           state, valid ? "true" : "false", static_cast<unsigned long>(sequence),
           static_cast<unsigned long>(millis()));
  httpd_resp_set_type(request, "application/json");
  httpd_resp_set_hdr(request, "Cache-Control", "no-store");
  return httpd_resp_sendstr(request, body);
}

esp_err_t handleWebSocket(httpd_req_t *request) {
  if (request->method == HTTP_GET) return ESP_OK;  // Opening handshake.
  // No commands are required. Bound incoming payloads and let HTTPD handle
  // ping/pong/close control frames automatically.
  httpd_ws_frame_t frame = {};
  esp_err_t result = httpd_ws_recv_frame(request, &frame, 0);
  if (result != ESP_OK || frame.len > 64) return ESP_FAIL;
  uint8_t payload[64];
  frame.payload = payload;
  return httpd_ws_recv_frame(request, &frame, sizeof(payload));
}

bool startServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.stack_size = 8192;
  config.max_open_sockets = MAX_CLIENTS;
  config.lru_purge_enable = true;
  config.send_wait_timeout = 1;
  config.recv_wait_timeout = 1;
  if (httpd_start(&server, &config) != ESP_OK) return false;
  httpd_uri_t index = {};
  index.uri = "/";
  index.method = HTTP_GET;
  index.handler = handleIndex;
  httpd_uri_t status = {};
  status.uri = "/api/status";
  status.method = HTTP_GET;
  status.handler = handleStatus;
  httpd_uri_t websocket = {};
  websocket.uri = "/ws";
  websocket.method = HTTP_GET;
  websocket.handler = handleWebSocket;
  websocket.is_websocket = true;
  if (httpd_register_uri_handler(server, &index) != ESP_OK ||
      httpd_register_uri_handler(server, &status) != ESP_OK ||
      httpd_register_uri_handler(server, &websocket) != ESP_OK) {
    httpd_stop(server);
    server = nullptr;
    return false;
  }
  return true;
}

bool pollSensor() {
  static bool configChecked = false;
  static uint32_t nextPollAt = 0;
  static uint32_t lastFrameAt = 0;
  static uint32_t sequence = 0;
  const uint32_t now = millis();
  if (static_cast<int32_t>(now - nextPollAt) < 0) return false;
  nextPollAt = now + 4;
  if (!configChecked) {
    uint16_t config;
    if (!readWords(CONFIG_ADDR, &config, 1)) {
      setSensorState("read_error");
      nextPollAt = now + 250;
      return false;
    }
    // Read the existing continuous-temperature configuration; never write
    // sensor EEPROM just to start the viewer.
    if (config & (0x0100 | 0x0800)) {
      setSensorState("config_error");
      nextPollAt = now + 1000;
      return false;
    }
    configChecked = true;
  }
  uint16_t flags;
  if (!readWords(FLAGS_ADDR, &flags, 1)) {
    configChecked = false;
    setSensorState("read_error");
    nextPollAt = now + 250;
    return false;
  }
  if (!(flags & READY_MASK) || (flags & BUSY_MASK)) {
    if (now - lastFrameAt > STALE_MS) setSensorState("waiting");
    return false;
  }
  // Ta immediately follows the 768 To words in sensor RAM.
  uint16_t raw[thermal::PIXELS + 1];
  if (!readWords(TO_ADDR, raw, thermal::PIXELS + 1) ||
      !readWords(FLAGS_ADDR, &flags, 1)) {
    configChecked = false;
    setSensorState("read_error");
    nextPollAt = now + 250;
    return false;
  }
  // Reading 0x342C cleared READY. If processing or the next frame has already
  // started, discard this read rather than publish overlapping frame data.
  if (flags & (READY_MASK | BUSY_MASK)) return false;
  thermal::FramePacket packet;
  packet.sequence = ++sequence;
  packet.capturedAtMs = millis();
  packet.taCentiC = static_cast<int16_t>(raw[thermal::PIXELS]);
  for (size_t i = 0; i < thermal::PIXELS; ++i) {
    packet.pixels[i] = static_cast<int16_t>(raw[i]);
  }
  portENTER_CRITICAL(&frameMux);
  latestFrame = packet;
  hasFrame = true;
  portEXIT_CRITICAL(&frameMux);
  lastFrameAt = packet.capturedAtMs;
  setSensorState("ok");
  return true;
}

void setup() {
  Serial.begin(115200);
  // Do not wait for Serial: the iPhone supplies power without opening USB CDC.
  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);
  Wire.setTimeOut(50);
  WiFi.mode(WIFI_AP);
  const IPAddress ip(192, 168, 4, 1);
  if (!WiFi.softAPConfig(ip, ip, IPAddress(255, 255, 255, 0)) ||
      !WiFi.softAP(AP_SSID, AP_PASSWORD, 1, false, 3) || !startServer()) {
    Serial.println("ERROR,SERVER_START_FAILED");
    return;
  }
  Serial.printf("Wi-Fi: %s\nOpen http://192.168.4.1\n", AP_SSID);
}

void loop() {
  static uint32_t lastBroadcastAt = 0;
  const bool fresh = pollSensor();
  if (fresh || millis() - lastBroadcastAt >= 1000) {
    queueBroadcast();
    lastBroadcastAt = millis();
  }
  delay(2);
}
