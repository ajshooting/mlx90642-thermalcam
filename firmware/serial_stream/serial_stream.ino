#include <Wire.h>

constexpr uint8_t MLX_ADDR = 0x66;

constexpr int SDA_PIN = 6;  // XIAO ESP32-C3 D4
constexpr int SCL_PIN = 7;  // XIAO ESP32-C3 D5

constexpr uint16_t FLAGS_ADDR = 0x3C14;
constexpr uint16_t TO_ADDR    = 0x342C;
constexpr uint16_t TA_ADDR    = 0x3A2C;

constexpr int WIDTH  = 32;
constexpr int HEIGHT = 24;
constexpr int PIXELS = WIDTH * HEIGHT;

int16_t temperatures[PIXELS];

bool readWords(uint16_t address, uint16_t *dst, size_t words) {
  constexpr size_t WORDS_PER_CHUNK = 16;

  size_t done = 0;

  while (done < words) {
    size_t n = min((size_t)WORDS_PER_CHUNK, words - done);
    uint16_t addr = address + done * 2;

    Wire.beginTransmission(MLX_ADDR);
    Wire.write((uint8_t)(addr >> 8));
    Wire.write((uint8_t)(addr & 0xFF));

    if (Wire.endTransmission(false) != 0) {
      return false;
    }

    size_t bytes = n * 2;
    size_t received = Wire.requestFrom(MLX_ADDR, bytes, true);

    if (received != bytes) {
      return false;
    }

    for (size_t i = 0; i < n; i++) {
      uint8_t msb = Wire.read();
      uint8_t lsb = Wire.read();
      dst[done + i] = ((uint16_t)msb << 8) | lsb;
    }

    done += n;
  }

  return true;
}

bool readWord(uint16_t address, uint16_t &value) {
  return readWords(address, &value, 1);
}

bool waitForFrame(uint32_t timeoutMs = 2000) {
  uint32_t start = millis();

  while (millis() - start < timeoutMs) {
    uint16_t flags;

    if (!readWord(FLAGS_ADDR, flags)) {
      return false;
    }

    // READY flag = bit 8
    if (flags & 0x0100) {
      return true;
    }

    delay(2);
  }

  return false;
}

void setup() {
  Serial.begin(460800);
  delay(1500);

  Wire.begin(SDA_PIN, SCL_PIN);
  Wire.setClock(400000);

  Serial.println("MLX90642 stream start");
}

void loop() {
  if (!waitForFrame()) {
    Serial.println("ERROR,FRAME_NOT_READY");
    delay(100);
    return;
  }

  if (!readWords(
        TO_ADDR,
        reinterpret_cast<uint16_t *>(temperatures),
        PIXELS)) {
    Serial.println("ERROR,READ_IMAGE");
    delay(100);
    return;
  }

  uint16_t taRawUnsigned;
  if (!readWord(TA_ADDR, taRawUnsigned)) {
    Serial.println("ERROR,READ_TA");
    delay(100);
    return;
  }

  int16_t taRaw = (int16_t)taRawUnsigned;
  float ta = taRaw / 100.0f;

  // 1行CSV:
  // FRAME,<Ta>,<p0>,<p1>,...,<p767>
  Serial.print("FRAME,");
  Serial.print(ta, 2);

  for (int i = 0; i < PIXELS; i++) {
    float t = temperatures[i] / 50.0f;
    Serial.print(",");
    Serial.print(t, 2);
  }

  Serial.println();

  delay(30);
}